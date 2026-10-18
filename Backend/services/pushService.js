import webpush from 'web-push'
import dotenv from 'dotenv'
import PushSubscription from '../models/PushSubscription.js'

dotenv.config()

const SEND_TIMEOUT_MS = 10_000
const MAX_COLLECTED_ERRORS = 20

const vapidConfigured = Boolean(
    process.env.VAPID_SUBJECT &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
)

if (vapidConfigured) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    )
}

function emptyResult(message) {
    return {
        success: false,
        total: 0,
        sent: 0,
        failed: 0,
        removed: 0,
        message
    }
}

class PushService {
    async sendToUser(userId, title, body, icon = '/icons/icon-192.png', data = {}) {
        this.ensureConfigured()
        const subscriptions = await PushSubscription.findAll({
            where: { user_id: userId }
        })

        if (subscriptions.length === 0) {
            console.log(`⚠️ Нет подписок для пользователя ${userId}`)
            return emptyResult('No subscriptions')
        }

        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToAll(title, body, icon = '/icons/icon-192.png', data = {}) {
        this.ensureConfigured()
        const subscriptions = await PushSubscription.findAll()

        if (subscriptions.length === 0) {
            console.log('⚠️ Нет подписок в системе')
            return emptyResult('No subscriptions')
        }

        console.log(`📤 Рассылка на ${subscriptions.length} подписок`)
        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToFiltered(whereCondition, title, body, icon = '/icons/icon-192.png', data = {}) {
        this.ensureConfigured()
        const subscriptions = await PushSubscription.findAll({
            where: whereCondition
        })

        if (subscriptions.length === 0) {
            console.log('⚠️ Подписок по фильтру нет')
            return emptyResult('No subscriptions')
        }

        console.log(`📤 Рассылка на ${subscriptions.length} подписок`)
        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToSubscriptions(subscriptions, title, body, icon, data) {
        const payload = JSON.stringify({
            title,
            body,
            icon,
            badge: '/icons/icon-192.png',
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
                        timeout: SEND_TIMEOUT_MS,
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8'
                        }
                    }
                )

                sent++
                console.log(`✅ ${sent}/${subscriptions.length} — ${sub.endpoint.slice(0, 50)}...`)
            } catch (error) {
                failed++
                console.error(`❌ Ошибка push: ${error.message}`)
                if (errors.length < MAX_COLLECTED_ERRORS) {
                    errors.push({ endpoint: sub.endpoint, error: error.message })
                }

                if (error.statusCode === 410 || error.statusCode === 404) {
                    await sub.destroy()
                    removed++
                    console.log('🗑️ Удалена устаревшая подписка')
                }
            }
        }

        console.log(`\n📊 Итого: ${sent} отправлено, ${failed} ошибок, ${removed} удалено\n`)

        return {
            success: sent > 0,
            total: subscriptions.length,
            sent,
            failed,
            removed,
            errors: errors.length > 0 ? errors : undefined
        }
    }

    ensureConfigured() {
        if (!vapidConfigured) {
            throw new Error('Push notifications are not configured')
        }
    }
}

export default new PushService()
