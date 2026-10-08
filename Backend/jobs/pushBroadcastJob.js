import cron from 'node-cron'
import { Op } from 'sequelize'
import PushBroadcast from '../models/PushBroadcast.js'
import pushBroadcastService from '../services/pushBroadcastService.js'

const STALE_SENDING_MS = 10 * 60 * 1000

async function logStaleSending(now) {
    try {
        const cutoff = new Date(now.getTime() - STALE_SENDING_MS)
        const stale = await PushBroadcast.findAll({
            where: {
                status: 'sending',
                created_at: { [Op.lt]: cutoff }
            },
            attributes: ['id', 'created_at']
        })

        for (const broadcast of stale) {
            console.warn(
                `⚠️ Push-рассылка #${broadcast.id} зависла в статусе 'sending' с ` +
                `${new Date(broadcast.created_at).toISOString()} — пропускаем`
            )
        }
    } catch (error) {
        console.error('❌ Ошибка проверки зависших push-рассылок:', error)
    }
}

export async function processDueBroadcasts({ now = new Date() } = {}) {
    const summary = { picked: 0, sent: 0, failed: 0 }

    await logStaleSending(now)

    const dueBroadcasts = await pushBroadcastService.listPendingDue({ now })
    summary.picked = dueBroadcasts.length

    for (const candidate of dueBroadcasts) {
        try {
            const [captured] = await PushBroadcast.update(
                { status: 'sending' },
                { where: { id: candidate.id, status: 'pending' } }
            )

            if (captured !== 1) continue

            const { result } = await pushBroadcastService.sendBroadcast(candidate.id, { now })

            if (result && result.sent > 0) {
                summary.sent++
            } else {
                summary.failed++
            }
        } catch (error) {
            summary.failed++
            console.error(`❌ Ошибка отправки push-рассылки #${candidate.id}:`, error)

            try {
                await PushBroadcast.update(
                    { status: 'failed' },
                    { where: { id: candidate.id, status: 'sending' } }
                )
            } catch (updateError) {
                console.error(`❌ Не удалось пометить рассылку #${candidate.id} как failed:`, updateError)
            }
        }
    }

    return summary
}

export function startPushBroadcastJob() {
    const task = cron.schedule('* * * * *', async () => {
        try {
            const summary = await processDueBroadcasts()
            if (summary.picked > 0) {
                console.log(
                    `📢 Push-рассылки: ${summary.picked} к отправке, ` +
                    `${summary.sent} отправлено, ${summary.failed} с ошибкой`
                )
            }
        } catch (error) {
            console.error('❌ Ошибка планировщика push-рассылок:', error)
        }
    })

    console.log('📢 PushBroadcastJob запущен (каждую минуту)')
    return task
}
