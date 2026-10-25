import { Op, QueryTypes } from 'sequelize'
import sequelize from '../db.js'
import Notification from '../models/Notification.js'
import { hasNotificationClicks } from '../utils/adminSchema.js'
import {
    buildUnreadByCategory,
    categoryWhere,
    parseNotificationCategory
} from '../utils/notificationCategories.js'

const LIST_ATTRIBUTES = [
    'id',
    'plant_id',
    'type',
    'title',
    'body',
    'url',
    'payload',
    'scheduled_for',
    'read_at',
    'created_at'
]

const CLICK_UPDATE_SQL = `
    UPDATE notifications
    SET clicked_at = COALESCE(clicked_at, now()),
        read_at = COALESCE(read_at, now()),
        click_count = click_count + 1
    WHERE id = $1 AND user_id = $2
    RETURNING id
`

const LEGACY_CLICK_UPDATE_SQL = `
    UPDATE notifications
    SET read_at = COALESCE(read_at, now())
    WHERE id = $1 AND user_id = $2
    RETURNING id
`
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_OFFSET = 1_000_000
const DEFAULT_STATUS = 'all'
const STATUS_FILTERS = {
    all: () => ({}),
    unread: () => ({ read_at: null }),
    read: () => ({ read_at: { [Op.ne]: null } })
}

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

function parseStatus(value) {
    if (value === undefined) return DEFAULT_STATUS
    if (typeof value !== 'string' || !Object.hasOwn(STATUS_FILTERS, value)) return null
    return value
}

async function countUnread(userId) {
    return Notification.count({
        where: { user_id: userId, read_at: null }
    })
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

            const status = parseStatus(req.query.status)
            if (!status) {
                return res.status(400).json({
                    message: 'Параметр status должен принимать значение all, unread или read'
                })
            }

            const category = parseNotificationCategory(req.query.category)
            if (!category) {
                return res.status(400).json({
                    message: 'Параметр category должен принимать значение all, watering или care'
                })
            }

            const where = {
                user_id: req.user.id,
                ...STATUS_FILTERS[status](),
                ...categoryWhere(category)
            }
            const [result, unreadRows] = await Promise.all([
                Notification.findAndCountAll({
                    where,
                    attributes: LIST_ATTRIBUTES,
                    order: [['created_at', 'DESC'], ['id', 'DESC']],
                    limit: pagination.limit,
                    offset: pagination.offset
                }),
                Notification.count({
                    where: { user_id: req.user.id, read_at: null },
                    group: ['type']
                })
            ])

            const items = result.rows.map(notification => notification.toJSON())
            const nextOffset = pagination.offset + items.length
            const unreadByCategory = buildUnreadByCategory(unreadRows)

            return res.json({
                items,
                total: result.count,
                unreadCount: unreadByCategory.all,
                unreadByCategory,
                category,
                status,
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
            const count = await countUnread(req.user.id)
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
                changed: updatedCount > 0,
                unreadCount: await countUnread(req.user.id)
            })
        } catch (error) {
            console.error('❌ Ошибка отметки уведомления:', error)
            return res.status(500).json({ message: 'Не удалось обновить уведомление' })
        }
    }

    async markClicked(req, res) {
        try {
            const id = parseNotificationId(req.params.id)
            if (!id) {
                return res.status(400).json({ message: 'Некорректный идентификатор уведомления' })
            }

            const clicksTracked = await hasNotificationClicks()
            const rows = await sequelize.query(
                clicksTracked ? CLICK_UPDATE_SQL : LEGACY_CLICK_UPDATE_SQL,
                {
                    bind: [id, req.user.id],
                    type: QueryTypes.SELECT
                }
            )

            if (!rows?.length) {
                return res.status(404).json({ message: 'Уведомление не найдено' })
            }

            return res.json({ ok: true })
        } catch (error) {
            console.error('❌ Ошибка отметки клика по уведомлению:', error)
            return res.status(500).json({ message: 'Не удалось отметить клик по уведомлению' })
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
            return res.json({
                updatedCount,
                unreadCount: await countUnread(req.user.id)
            })
        } catch (error) {
            console.error('❌ Ошибка отметки всех уведомлений:', error)
            return res.status(500).json({ message: 'Не удалось обновить уведомления' })
        }
    }
}

export default new NotificationController()
