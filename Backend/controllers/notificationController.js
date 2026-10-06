import Notification from '../models/Notification.js'

const LIST_ATTRIBUTES = [
    'id',
    'plant_id',
    'type',
    'title',
    'body',
    'url',
    'scheduled_for',
    'read_at',
    'created_at'
]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_OFFSET = 1_000_000

function parsePagination(query) {
    const rawLimit = query.limit
    const rawOffset = query.offset
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit)
    const offset = rawOffset === undefined ? 0 : Number(rawOffset)

    if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_LIMIT ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > MAX_OFFSET
    ) {
        return null
    }
    return { limit, offset }
}

function parseNotificationId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
    const id = Number(value)
    return Number.isSafeInteger(id) ? id : null
}

class NotificationController {
    async list(req, res) {
        try {
            const pagination = parsePagination(req.query)
            if (!pagination) {
                return res.status(400).json({
                    message: 'Параметры limit и offset должны быть целыми числами в допустимом диапазоне'
                })
            }

            const where = { user_id: req.user.id }
            const [result, unreadCount] = await Promise.all([
                Notification.findAndCountAll({
                    where,
                    attributes: LIST_ATTRIBUTES,
                    order: [['created_at', 'DESC'], ['id', 'DESC']],
                    limit: pagination.limit,
                    offset: pagination.offset
                }),
                Notification.count({
                    where: { ...where, read_at: null }
                })
            ])

            const items = result.rows.map(notification => notification.toJSON())
            const nextOffset = pagination.offset + items.length

            return res.json({
                items,
                total: result.count,
                unreadCount,
                limit: pagination.limit,
                offset: pagination.offset,
                nextOffset: nextOffset < result.count ? nextOffset : null
            })
        } catch (error) {
            console.error('❌ Ошибка получения уведомлений:', error)
            return res.status(500).json({ message: 'Не удалось загрузить уведомления' })
        }
    }

    async unreadCount(req, res) {
        try {
            const count = await Notification.count({
                where: { user_id: req.user.id, read_at: null }
            })
            return res.json({ unreadCount: count })
        } catch (error) {
            console.error('❌ Ошибка подсчёта непрочитанных уведомлений:', error)
            return res.status(500).json({ message: 'Не удалось получить количество уведомлений' })
        }
    }

    async markRead(req, res) {
        try {
            const id = parseNotificationId(req.params.id)
            if (!id) {
                return res.status(400).json({ message: 'Некорректный идентификатор уведомления' })
            }

            const [updatedCount] = await Notification.update(
                { read_at: new Date() },
                {
                    where: {
                        id,
                        user_id: req.user.id,
                        read_at: null
                    }
                }
            )
            const notification = await Notification.findOne({
                where: { id, user_id: req.user.id },
                attributes: LIST_ATTRIBUTES
            })
            if (!notification) {
                return res.status(404).json({ message: 'Уведомление не найдено' })
            }

            return res.json({
                item: notification.toJSON(),
                changed: updatedCount > 0
            })
        } catch (error) {
            console.error('❌ Ошибка отметки уведомления:', error)
            return res.status(500).json({ message: 'Не удалось обновить уведомление' })
        }
    }

    async markAllRead(req, res) {
        try {
            const [updatedCount] = await Notification.update(
                { read_at: new Date() },
                {
                    where: {
                        user_id: req.user.id,
                        read_at: null
                    }
                }
            )
            return res.json({ updatedCount })
        } catch (error) {
            console.error('❌ Ошибка отметки всех уведомлений:', error)
            return res.status(500).json({ message: 'Не удалось обновить уведомления' })
        }
    }
}

export default new NotificationController()
