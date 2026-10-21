import cron from 'node-cron'
import MailBroadcast from '../models/MailBroadcast.js'
import mailBroadcastService, {
    MAIL_BROADCAST_LOCK,
    MAIL_BROADCAST_LOCK_TTL_MS,
    readMailBroadcastSettings
} from '../services/mailBroadcastService.js'
import { withDistributedLock } from '../utils/distributedLock.js'

const DUE_LIMIT = 20
const ACTIVE_LIMIT = 20

export async function processDueBroadcasts({ now = new Date() } = {}) {
    const summary = { picked: 0, sent: 0, failed: 0, continued: 0 }
    const { batchSize } = readMailBroadcastSettings()

    summary.failed += (await mailBroadcastService.failStaleSending({ now })).length

    const due = await mailBroadcastService.listPendingDue({ now, limit: DUE_LIMIT })
    const active = await mailBroadcastService.listUnfinishedSending({ limit: ACTIVE_LIMIT })

    const queue = []
    for (const candidate of due) {
        const [captured] = await MailBroadcast.update(
            { status: 'sending' },
            { where: { id: candidate.id, status: 'pending' } }
        )
        if (captured !== 1) continue
        queue.push(candidate.id)
    }
    for (const candidate of active) {
        if (!queue.includes(candidate.id)) queue.push(candidate.id)
    }

    for (const id of queue) {
        try {
            const { result } = await mailBroadcastService.sendBroadcast(id, { now, batchSize })
            if (!result) continue

            summary.picked++
            if (!result.done) summary.continued++
            else if (result.sent > 0) summary.sent++
            else summary.failed++
        } catch (error) {
            summary.failed++
            console.error(`❌ Ошибка отправки рассылки писем #${id}:`, error)
        }
    }

    return summary
}

export function startMailBroadcastJob() {
    const task = cron.schedule('* * * * *', async () => {
        try {
            const outcome = await withDistributedLock(
                MAIL_BROADCAST_LOCK,
                { ttlMs: MAIL_BROADCAST_LOCK_TTL_MS },
                () => processDueBroadcasts()
            )

            if (!outcome.ran) return

            const summary = outcome.result
            if (summary.picked > 0) {
                console.log(
                    `✉️ Рассылки писем: ${summary.picked} в работе, ` +
                    `${summary.sent} завершено, ${summary.continued} продолжается, ` +
                    `${summary.failed} с ошибкой`
                )
            }
        } catch (error) {
            console.error('❌ Ошибка планировщика рассылок писем:', error)
        }
    })

    console.log('✉️ MailBroadcastJob запущен (каждую минуту, распределённый лок Redis)')
    return task
}
