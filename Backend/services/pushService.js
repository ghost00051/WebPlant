import webpush from 'web-push'
import dotenv from 'dotenv'
import PushSubscription from '../models/PushSubscription.js'
import { Op } from 'sequelize'

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

        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToAll(title, body, icon = '/icon-192.png', data = {}) {
        const subscriptions = await PushSubscription.findAll()
        
        if (subscriptions.length === 0) {
            console.log('⚠️ Нет подписок в системе')
            return { success: false, message: 'No subscriptions' }
        }
        
        console.log(`📤 Рассылка на ${subscriptions.length} подписок`)
        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToFiltered(whereCondition, title, body, icon = '/icon-192.png', data = {}) {
        const subscriptions = await PushSubscription.findAll({
            where: whereCondition
        })

        console.log(`📤 Рассылка на ${subscriptions.length} подписок`)
        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToSubscriptions(subscriptions, title, body, icon, data) {
        const payload = JSON.stringify({
            title,
            body,
            icon,
            badge: '/badge-72.png',
            data
        })

        let sent = 0
        let failed = 0
        let removed = 0
        const errors = []

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
                    payload,
                    {
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8'
                        }
                    }
                )
                
                sent++
                console.log(`✅ ${sent}/${subscriptions.length} — ${sub.endpoint.slice(0, 50)}...`)
            } catch (error) {
                failed++
                console.error(`❌ Ошибка: ${error.message}`)
                errors.push({ endpoint: sub.endpoint, error: error.message })
                
                if (error.statusCode === 410 || error.statusCode === 404) {
                    await sub.destroy()
                    removed++
                    console.log(`🗑️ Удалена устаревшая подписка`)
                }
            }
        }

        console.log(`\n📊 Итого: ${sent} отправлено, ${failed} ошибок, ${removed} удалено\n`)

        return {
            success: true,
            total: subscriptions.length,
            sent,
            failed,
            removed,
            errors: errors.length > 0 ? errors : undefined
        }
    }
}

export default new PushService()