import { Op } from 'sequelize'
import PushBroadcast from '../models/PushBroadcast.js'
import PushSubscription from '../models/PushSubscription.js'
import User from '../models/userModels.js'
import pushBroadcastService from '../services/pushBroadcastService.js'
import { getPushStatus } from '../services/pushService.js'
import {
    IDEMPOTENCY_TTL_MS,
    formatBroadcastMoment,
    normalizeIdempotencyKey
} from '../utils/broadcastIdempotency.js'
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
    'started_at',
    'sent_at',
    'sent_count',
    'failed_count',
    'removed_count',
    'total_subscriptions',
    'last_processed_id',
    'chunk_size',
    'created_at',
    'updated_at'
]

function toPlain(row) {
    if (!row) return null
    if (typeof row.get === 'function') return row.get({ plain: true })
    return { ...row }
}

function isUniqueViolation(error) {
    return error?.name === 'SequelizeUniqueConstraintError' ||
        error?.parent?.code === '23505'
}

function buildDeduplicatedResponse(existing) {
    return {
        broadcast: toPlain(existing),
        recipientsCount: existing.total_subscriptions,
        sentResult: null,
        queued: existing.status === 'pending' || existing.status === 'sending',
        deduplicated: true,
        existingStatus: existing.status
    }
}

function isIdempotencyKeyExpired(existing, now = new Date()) {
    if (!existing?.created_at) return false
    const createdAt = new Date(existing.created_at).getTime()
    if (!Number.isFinite(createdAt)) return false
    return now.getTime() - createdAt > IDEMPOTENCY_TTL_MS
}

function isIdempotencyKeyBlocking(existing, now = new Date()) {
    if (!existing) return false
    if (existing.status === 'pending' || existing.status === 'sending') return true
    return !isIdempotencyKeyExpired(existing, now)
}

async function releaseExpiredIdempotencyKey(existing) {
    if (!existing?.id || !existing.idempotency_key) return false
    try {
        const [updated] = await PushBroadcast.update(
            { idempotency_key: null },
            { where: { id: existing.id, idempotency_key: existing.idempotency_key } }
        )
        if (updated === 1) {
            existing.idempotency_key = null
            return true
        }
    } catch (error) {
        console.warn(
            `⚠️ push-рассылка: не удалось освободить устаревший Idempotency-Key: ` +
            `${error?.message || error}`
        )
    }
    return false
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
            const [total, users, guests, invalidated, usersTotal] = await Promise.all([
                PushSubscription.count(),
                PushSubscription.count({ distinct: true, col: 'user_id' }),
                PushSubscription.count({ where: { user_id: null } }),
                PushSubscription.count({ where: { invalidated_at: { [Op.ne]: null } } }),
                User.count()
            ])

            const recentRows = await PushBroadcast.findAll({
                attributes: OVERVIEW_ATTRIBUTES,
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                limit: 5
            })

            const pushStatus = getPushStatus()
            return res.json({
                pushConfigured: pushStatus.valid,
                pushStatus,
                subscriptions: { total, users, guests, invalidated },
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

            const pushStatus = getPushStatus()
            if (!pushStatus.valid) {
                return res.status(503).json({
                    message: 'Push-уведомления не настроены на сервере',
                    detail: pushStatus.error
                })
            }

            const adminId = req.user?.id ?? null
            const rawIdempotencyKey = req.get?.('Idempotency-Key')
            const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
            if (rawIdempotencyKey && !idempotencyKey) {
                console.warn('⚠️ push-рассылка: некорректный Idempotency-Key проигнорирован')
            }

            if (idempotencyKey) {
                const existing = await pushBroadcastService.findByIdempotencyKey(idempotencyKey)
                if (existing && isIdempotencyKeyBlocking(existing)) {
                    return res.status(200).json(buildDeduplicatedResponse(existing))
                }
                if (existing) {
                    await releaseExpiredIdempotencyKey(existing)
                }
            }

            const duplicate = await pushBroadcastService.findRecentDuplicate({
                title: validation.value.title,
                body: validation.value.body,
                url: validation.value.url,
                targetMode: validation.value.targetMode,
                includeGuests: validation.value.includeGuests,
                adminId
            })
            if (duplicate) {
                const moment = formatBroadcastMoment(duplicate.created_at)
                return res.status(409).json({
                    message: `Такая рассылка уже создана${moment ? ` ${moment}` : ''} (№${duplicate.id}). ` +
                        'Повторная отправка заблокирована, чтобы уведомления не пришли дважды.',
                    broadcast: toPlain(duplicate),
                    duplicated: true
                })
            }

            const createOnce = () => pushBroadcastService.createBroadcast({
                adminId,
                payload,
                deferDelivery: true,
                idempotencyKey
            })

            let created
            try {
                created = await createOnce()
            } catch (error) {

                if (isUniqueViolation(error) && idempotencyKey) {
                    const existing = await pushBroadcastService.findByIdempotencyKey(idempotencyKey)
                    if (existing && isIdempotencyKeyBlocking(existing)) {
                        return res.status(200).json(buildDeduplicatedResponse(existing))
                    }
                    if (existing && await releaseExpiredIdempotencyKey(existing)) {
                        created = await createOnce()
                    } else {
                        throw error
                    }
                } else if (error?.statusCode === 400) {
                    return res.status(400).json({ message: error.message })
                } else {
                    throw error
                }
            }

            const { broadcast, recipients } = created
            return res.status(201).json({
                broadcast: toPlain(broadcast),
                recipientsCount: recipients.length > 0 ? recipients.length : broadcast.total_subscriptions,
                sentResult: null,
                queued: true
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

    async retryBroadcast(req, res) {
        try {
            const { id } = req.params
            if (!isValidBroadcastId(id)) {
                return res.status(400).json({ message: 'Некорректный идентификатор рассылки' })
            }

            const pushStatus = getPushStatus()
            if (!pushStatus.valid) {
                return res.status(503).json({
                    message: 'Push-уведомления не настроены на сервере',
                    detail: pushStatus.error
                })
            }

            const result = await pushBroadcastService.retryBroadcast(Number(id))
            if (!result.broadcast) {
                return res.status(404).json({ message: 'Рассылка не найдена' })
            }
            if (!result.retried) {
                return res.status(409).json({
                    message: 'Повторить можно только рассылку со статусом failed',
                    status: result.broadcast.status
                })
            }

            return res.json({
                retried: true,
                broadcast: toPlain(result.broadcast),
                queued: true
            })
        } catch (error) {
            console.error('❌ Ошибка повторной отправки рассылки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new AdminPushController()
