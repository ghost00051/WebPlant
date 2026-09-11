import webpush from 'web-push'
import dotenv from 'dotenv'
import PushSubscription from '../models/PushSubscription.js'

dotenv.config()

webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
)

class PushService {
    async sendToUser(userId, title, body, icon = '/icon-192.png', data = {}) {
        const subscriptions = await PushSubscription.findAll({
            where: { user_id: userId }
        })

        if (subscriptions.length === 0) {
            console.log(`⚠️ Нет подписок для пользователя ${userId}`)
            return { success: false, message: 'No subscriptions' }
        }

        const payload = JSON.stringify({
            title,
            body,
            icon,
            badge: '/badge-72.png',
            data
        })

        const results = []
        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.p256dh,
                            auth: sub.auth
                        }
                    },
                    payload
                )
                console.log(`✅ Push отправлен: ${sub.endpoint.slice(0, 50)}...`)
                results.push({ endpoint: sub.endpoint, success: true })
            } catch (error) {
                console.error(`❌ Ошибка push:`, error.message)
                if (error.statusCode === 410 || error.statusCode === 404) {
                    await sub.destroy()
                    console.log(`🗑️ Подписка удалена (устарела)`)
                }
                results.push({ endpoint: sub.endpoint, success: false, error: error.message })
            }
        }

        return { success: true, results }
    }

    async sendToAll(title, body, icon, data) {
        const subscriptions = await PushSubscription.findAll()
        const userIds = [...new Set(subscriptions.map(s => s.user_id).filter(Boolean))]
        
        for (const userId of userIds) {
            await this.sendToUser(userId, title, body, icon, data)
        }
    }
}

export default new PushService()