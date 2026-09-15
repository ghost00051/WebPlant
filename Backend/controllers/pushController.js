import PushSubscription from '../models/PushSubscription.js'
import pushService from '../services/pushService.js'
import jwt from 'jsonwebtoken'

class PushController {
    async getVapidPublicKey(req, res) {
        res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
    }

    async subscribe(req, res) {
        try {
            const { subscription } = req.body

            const token = req.cookies.token
            let userId = null

            if (token) {
                try {
                    const decoded = jwt.verify(token, process.env.SECRET_KEY)
                    userId = decoded.id
                    console.log(`✅ Подписка для пользователя ${userId}`)
                } catch (e) {
                    console.log('⚠️ Токен невалиден, сохраняем как гостевую')
                }
            } else {
                console.log('⚠️ Нет токена, сохраняем как гостевую')
            }

            if (!subscription?.endpoint || !subscription?.keys) {
                return res.status(400).json({ message: 'Неверные данные подписки' })
            }

            let existing = await PushSubscription.findOne({
                where: { endpoint: subscription.endpoint }
            })

            if (existing) {
                await existing.update({
                    user_id: userId,
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    user_agent: req.headers['user-agent']
                })
            } else {
                await PushSubscription.create({
                    user_id: userId,
                    endpoint: subscription.endpoint,
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    user_agent: req.headers['user-agent']
                })
            }

            return res.status(201).json({
                message: 'Подписка сохранена',
                user_id: userId
            })
        } catch (error) {
            console.error('❌ Ошибка подписки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async unsubscribe(req, res) {
        try {
            const { endpoint } = req.body
            if (!endpoint) {
                return res.status(400).json({ message: 'endpoint обязателен' })
            }
            await PushSubscription.destroy({ where: { endpoint } })
            return res.json({ message: 'Подписка удалена' })
        } catch (error) {
            console.error('❌ Ошибка отписки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
    
    async sendToUser(req, res) {
        try {
            const { userId, title, body, icon, data } = req.body
            if (!userId || !title || !body) {
                return res.status(400).json({ message: 'userId, title, body обязательны' })
            }
            const result = await pushService.sendToUser(userId, title, body, icon, data)
            return res.json(result)
        } catch (error) {
            console.error('❌ Ошибка отправки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async sendToAll(req, res) {
        try {
            const { title, body, icon, data } = req.body
            if (!title || !body) {
                return res.status(400).json({ message: 'title и body обязательны' })
            }
            
            console.log(`📢 Массовая рассылка: "${title}"`)
            const result = await pushService.sendToAll(title, body, icon, data)
            return res.json(result)
        } catch (error) {
            console.error('❌ Ошибка массовой рассылки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getStats(req, res) {
        try {
            const total = await PushSubscription.count()
            const users = await PushSubscription.count({
                distinct: true,
                col: 'user_id'
            })
            const guests = await PushSubscription.count({
                where: { user_id: null }
            })
            
            return res.json({
                total,
                users,
                guests
            })
        } catch (error) {
            console.error('❌ Ошибка статистики:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new PushController()