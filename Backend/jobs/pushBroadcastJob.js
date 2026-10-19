import cron from 'node-cron'
import PushBroadcast from '../models/PushBroadcast.js'
import pushBroadcastService, { STALE_SENDING_MS } from '../services/pushBroadcastService.js'
import { withDistributedLock } from '../utils/distributedLock.js'

const BROADCAST_LOCK = 'job:push-broadcast'
const BROADCAST_LOCK_TTL_MS = 2 * 60 * 1000

export async function processDueBroadcasts({ now = new Date() } = {}) {
    const summary = { picked: 0, sent: 0, failed: 0, recovered: 0 }

    try {
        const recovered = await pushBroadcastService.recoverStaleSending({ now })
        summary.recovered = recovered.length
    } catch (error) {
        console.error('❌ Ошибка восстановления зависших push-рассылок:', error)
    }

    const dueBroadcasts = await pushBroadcastService.listPendingDue({ now })
    summary.picked = dueBroadcasts.length

    for (const candidate of dueBroadcasts) {
        try {
            const claim = { status: 'sending', updated_at: now }
            if (!candidate.started_at) claim.started_at = now

            const [captured] = await PushBroadcast.update(
                claim,
                { where: { id: candidate.id, status: 'pending' } }
            )

            if (captured !== 1) continue

            const { result } = await pushBroadcastService.sendBroadcast(candidate.id, { now })
            if (!result) continue

            if (result.fatal) {
                summary.failed += 1
            } else {
                summary.sent += 1
            }
        } catch (error) {
            summary.failed += 1
            console.error(`❌ Ошибка отправки push-рассылки #${candidate.id}:`, error)

            const recovery = error?.fatal === true
                ? { status: 'failed', updated_at: new Date() }
                : { status: 'pending', updated_at: new Date() }
            try {
                await PushBroadcast.update(
                    recovery,
                    { where: { id: candidate.id, status: 'sending' } }
                )
            } catch (updateError) {
                console.error(
                    `❌ Не удалось восстановить статус рассылки #${candidate.id} после ошибки:`,
                    updateError
                )
            }
        }
    }

    return summary
}

export function startPushBroadcastJob() {
    const task = cron.schedule('* * * * *', async () => {
        try {
            const outcome = await withDistributedLock(
                BROADCAST_LOCK,
                { ttlMs: BROADCAST_LOCK_TTL_MS },
                () => processDueBroadcasts()
            )

            if (!outcome.ran) return

            const summary = outcome.result
            if (summary.picked > 0 || summary.recovered > 0) {
                console.log(
                    `📢 Push-рассылки: ${summary.picked} к отправке, ` +
                    `${summary.sent} завершено, ${summary.failed} с ошибкой, ` +
                    `${summary.recovered} восстановлено (stale > ${Math.round(STALE_SENDING_MS / 60000)} мин)`
                )
            }
        } catch (error) {
            console.error('❌ Ошибка планировщика push-рассылок:', error)
        }
    })

    console.log('📢 PushBroadcastJob запущен (каждую минуту, распределённый лок Redis)')
    return task
}
