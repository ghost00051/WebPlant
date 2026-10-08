import PushBroadcast from '../models/PushBroadcast.js'
import PushSubscription from '../models/PushSubscription.js'
import User from '../models/userModels.js'
import pushBroadcastService from '../services/pushBroadcastService.js'
import {
    isValidBroadcastId,
    validateBroadcastInput
} from '../utils/pushBroadcastValidation.js'

const MAX_SEARCH_LENGTH = 254
const DEFAULT_RECIPIENTS_LIMIT = 50
const MAX_RECIPIENTS_LIMIT = 200
const MAX_RECIPIENTS_OFFSET = 1_000_000

const OVERVIEW_ATTRIBUTES = [
    'id',
    'title',
    'status',
    'target_mode',
    'scheduled_for',
    'sent_at',
    'sent_count',
    'failed_count',
    'total_subscriptions',
    'created_at'
]

function isPushConfigured() {
    return Boolean(
        process.env.VAPID_SUBJECT &&
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY
    )
}

function toPlain(row) {
    if (!row) return null
    if (typeof row.get === 'function') return row.get({ plain: true })
    return { ...row }
}

function parseBoundedInteger(value, { fallback, min, max }) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
    return parsed
}

function parseSearch(value) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') return null
    if (Array.from(value).length > MAX_SEARCH_LENGTH) return null
    return value.trim()
}

class AdminPushController {
    async getOverview(req, res) {
        try {
            const [total, users, guests, usersTotal] = await Promise.all([
                PushSubscription.count(),
                PushSubscription.count({ distinct: true, col: 'user_id' }),
                PushSubscription.count({ where: { user_id: null } }),
                User.count()
            ])

            const recentRows = await PushBroadcast.findAll({
                attributes: OVERVIEW_ATTRIBUTES,
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                limit: 5
            })

            return res.json({
                pushConfigured: isPushConfigured(),
                subscriptions: { total, users, guests },
                users: { total: usersTotal },
                recent: recentRows.map(toPlain)
            })
        } catch (error) {
            console.error('❌ Ошибка обзора push-рассылок:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async listRecipients(req, res) {
        try {
            const search = parseSearch(req.query.search)
            const limit = parseBoundedInteger(req.query.limit, {
                fallback: DEFAULT_RECIPIENTS_LIMIT,
                min: 1,
                max: MAX_RECIPIENTS_LIMIT
            })
            const offset = parseBoundedInteger(req.query.offset, {
                fallback: 0,
                min: 0,
                max: MAX_RECIPIENTS_OFFSET
            })

            if (search === null || limit === null || offset === null) {
                return res.status(400).json({ message: 'Параметры поиска некорректны' })
            }

            const { items, total } = await pushBroadcastService.listUserSubscriptions(search, {
                limit,
                offset
            })

            return res.json({ items, total })
        } catch (error) {
            console.error('❌ Ошибка списка получателей:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async createBroadcast(req, res) {
        try {
            const payload = req.body || {}
            const validation = validateBroadcastInput(payload)
            if (!validation.ok) {
                return res.status(400).json({ message: validation.message })
            }

            if (!validation.value.scheduledFor && !isPushConfigured()) {
                return res.status(503).json({ message: 'Push-уведомления не настроены на сервере' })
            }

            const { broadcast, recipients, sentResult } = await pushBroadcastService.createBroadcast({
                adminId: req.user?.id ?? null,
                payload
            })

            return res.status(201).json({
                broadcast: toPlain(broadcast),
                recipientsCount: recipients.length,
                sentResult
            })
        } catch (error) {
            if (error?.statusCode === 400) {
                return res.status(400).json({ message: error.message })
            }
            console.error('❌ Ошибка создания рассылки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async cancelBroadcast(req, res) {
        try {
            const { id } = req.params
            if (!isValidBroadcastId(id)) {
                return res.status(400).json({ message: 'Некорректный идентификатор рассылки' })
            }

            const broadcastId = Number(id)
            const broadcast = await PushBroadcast.findByPk(broadcastId)
            if (!broadcast) {
                return res.status(404).json({ message: 'Рассылка не найдена' })
            }
            if (broadcast.status !== 'pending') {
                return res.status(409).json({ message: 'Эту рассылку нельзя отменить' })
            }

            const { canceled } = await pushBroadcastService.cancelBroadcast(broadcastId)
            if (!canceled) {
                return res.status(409).json({ message: 'Эту рассылку нельзя отменить' })
            }

            return res.json({ canceled: true })
        } catch (error) {
            console.error('❌ Ошибка отмены рассылки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new AdminPushController()
