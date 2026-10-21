import PushSubscription from '../models/PushSubscription.js'
import { getPushStatus } from '../services/pushService.js'
import { isValidPushSubscription } from '../utils/pushValidation.js'

function isUniqueViolation(error) {
    return error?.name === 'SequelizeUniqueConstraintError' ||
        error?.parent?.code === '23505'
}

function buildSubscriptionUpdates(subscription, userId, userAgent) {
    return {
        user_id: userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent,

        invalidated_at: null,
        invalid_reason: null,
        failed_attempts: 0,
        last_error: null
    }
}

class PushController {
    async getVapidPublicKey(req, res) {
        const pushStatus = getPushStatus()
        if (!pushStatus.valid) {
            return res.status(503).json({
                message: 'Push notifications are not configured',
                detail: pushStatus.error
            })
        }
        return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
    }

    async subscribe(req, res) {
        try {
            const { subscription } = req.body || {}
            if (!isValidPushSubscription(subscription)) {
                return res.status(400).json({ message: 'Неверные данные подписки' })
            }

            const userId = req.user?.id ?? null
            const updates = buildSubscriptionUpdates(subscription, userId, req.headers['user-agent'])
            const existing = await PushSubscription.findOne({
                where: { endpoint: subscription.endpoint }
            })

            if (existing) {

                if (existing.user_id !== null && existing.user_id !== userId) {
                    return res.status(409).json({
                        message: 'Подписка уже привязана к другому аккаунту'
                    })
                }
                await existing.update(updates)
                return res.status(200).json({
                    message: 'Подписка обновлена',
                    user_id: existing.user_id
                })
            }

            try {
                const created = await PushSubscription.create({
                    endpoint: subscription.endpoint,
                    ...buildSubscriptionUpdates(subscription, userId, req.headers['user-agent'])
                })
                return res.status(201).json({
                    message: 'Подписка сохранена',
                    user_id: created.user_id
                })
            } catch (error) {
                if (!isUniqueViolation(error)) throw error

                const raced = await PushSubscription.findOne({
                    where: { endpoint: subscription.endpoint }
                })
                if (!raced) throw error
                if (raced.user_id !== null && raced.user_id !== userId) {
                    return res.status(409).json({
                        message: 'Подписка уже привязана к другому аккаунту'
                    })
                }
                await raced.update(updates)
                return res.status(200).json({
                    message: 'Подписка обновлена',
                    user_id: raced.user_id
                })
            }
        } catch (error) {
            console.error('❌ Ошибка подписки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async unsubscribe(req, res) {
        try {
            const endpoint = req.body?.endpoint
            if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 2048) {
                return res.status(400).json({ message: 'endpoint обязателен' })
            }

            const userId = req.user?.id ?? null

            const where = userId !== null
                ? { endpoint, user_id: userId }
                : { endpoint, user_id: null }

            const deleted = await PushSubscription.destroy({ where })
            return res.json({
                message: deleted > 0 ? 'Подписка удалена' : 'Подписка не найдена',
                deleted
            })
        } catch (error) {
            console.error('❌ Ошибка отписки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new PushController()
