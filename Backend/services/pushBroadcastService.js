import { Op } from 'sequelize'
import PushBroadcast from '../models/PushBroadcast.js'
import PushBroadcastRecipient from '../models/PushBroadcastRecipient.js'
import PushSubscription from '../models/PushSubscription.js'
import User from '../models/userModels.js'
import pushService from './pushService.js'
import { validateBroadcastInput } from '../utils/pushBroadcastValidation.js'

const DEFAULT_ICON = '/icons/icon-192.png'

const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000
const DEDUPE_STATUSES = ['pending', 'sending', 'sent']
const DEFAULT_CHUNK_SIZE = 200
const MIN_CHUNK_SIZE = 100
const MAX_CHUNK_SIZE = 500
export const STALE_SENDING_MS = 10 * 60 * 1000
const PROGRESS_UPDATE_ATTEMPTS = 3

function dedupeWindowMs() {
    const parsed = Number.parseInt(process.env.PUSH_BROADCAST_DEDUPE_WINDOW_MS, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DEDUPE_WINDOW_MS
}

export function readBroadcastChunkSize(value) {
    const candidates = [value, process.env.PUSH_BROADCAST_CHUNK_SIZE]
    for (const candidate of candidates) {
        const parsed = typeof candidate === 'number'
            ? candidate
            : Number.parseInt(candidate, 10)
        if (Number.isInteger(parsed) && parsed >= MIN_CHUNK_SIZE && parsed <= MAX_CHUNK_SIZE) {
            return parsed
        }
    }
    return DEFAULT_CHUNK_SIZE
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function applyUpdates(target, updates) {
    if (!target) return
    if (typeof target.set === 'function') {
        target.set(updates)
    } else {
        Object.assign(target, updates)
    }
}

export function escapeLikePattern(value) {
    return value.replace(/[\\%_]/g, character => `\\${character}`)
}

class PushBroadcastService {
    buildSubscriptionWhere({ targetMode, userIds = [], includeGuests = false } = {}) {
        if (targetMode === 'users') {
            return { user_id: { [Op.in]: [...userIds] } }
        }
        if (includeGuests) {
            return {}
        }
        return { user_id: { [Op.ne]: null } }
    }

    buildActiveSubscriptionWhere(args) {
        return { ...this.buildSubscriptionWhere(args), invalidated_at: null }
    }

    async createBroadcast({
        adminId = null,
        payload,
        now = new Date(),
        deferDelivery = false,
        idempotencyKey = null
    } = {}) {
        const validation = validateBroadcastInput(payload)
        if (!validation.ok) {
            const error = new Error(validation.message)
            error.statusCode = 400
            throw error
        }

        const value = validation.value
        const scheduledFor = value.scheduledFor ? new Date(value.scheduledFor) : null

        const status = 'pending'
        const subscriptionWhere = this.buildActiveSubscriptionWhere({
            targetMode: value.targetMode,
            userIds: value.userIds,
            includeGuests: value.includeGuests
        })
        const chunkSize = readBroadcastChunkSize()

        let broadcast
        let recipients = []

        await PushBroadcast.sequelize.transaction(async transaction => {
            const totalSubscriptions = await PushSubscription.count({
                where: subscriptionWhere,
                transaction
            })

            broadcast = await PushBroadcast.create({
                title: value.title,
                body: value.body,
                icon: value.icon,
                url: value.url,
                target_mode: value.targetMode,
                include_guests: value.includeGuests,
                status,
                scheduled_for: scheduledFor,
                total_subscriptions: totalSubscriptions,
                created_by: adminId,
                idempotency_key: idempotencyKey || null,
                last_processed_id: 0,
                chunk_size: chunkSize,
                started_at: null,
                updated_at: now
            }, { transaction })

            if (value.targetMode === 'users' && value.userIds.length > 0) {
                recipients = await PushBroadcastRecipient.bulkCreate(
                    value.userIds.map(userId => ({
                        broadcast_id: broadcast.id,
                        user_id: userId,
                        status: 'pending',
                        attempts: 0
                    })),
                    { transaction, returning: true }
                )
            }
        })

        return { broadcast, recipients, sentResult: null }
    }

    async findByIdempotencyKey(idempotencyKey) {
        if (!idempotencyKey) return null
        return PushBroadcast.findOne({ where: { idempotency_key: idempotencyKey } })
    }

    async findRecentDuplicate({
        title,
        body,
        url = '',
        targetMode,
        includeGuests = false,
        adminId = null,
        now = new Date(),
        windowMs = dedupeWindowMs()
    } = {}) {
        if (!title || !body || !targetMode) return null

        const where = {
            title,
            body,
            url: url || null,
            target_mode: targetMode,
            include_guests: Boolean(includeGuests),
            status: { [Op.in]: DEDUPE_STATUSES },
            created_at: { [Op.gte]: new Date(now.getTime() - windowMs) }
        }
        if (adminId) where.created_by = adminId

        return PushBroadcast.findOne({ where, order: [['id', 'DESC']] })
    }

    async persistProgress(broadcastId, updates) {
        let lastError = null
        for (let attempt = 0; attempt < PROGRESS_UPDATE_ATTEMPTS; attempt += 1) {
            try {
                await PushBroadcast.update(updates, { where: { id: broadcastId } })
                return
            } catch (error) {
                lastError = error
                if (attempt < PROGRESS_UPDATE_ATTEMPTS - 1) {
                    await sleep(100 * (2 ** attempt))
                }
            }
        }
        throw lastError
    }

    async applyRecipientProgress(broadcastId, page, chunkResult, now) {
        const outcomes = Array.isArray(chunkResult?.outcomes) ? chunkResult.outcomes : []
        if (outcomes.length === 0) return

        const outcomeBySubscriptionId = new Map()
        for (const outcome of outcomes) {
            if (outcome && outcome.id !== null && outcome.id !== undefined) {
                outcomeBySubscriptionId.set(Number(outcome.id), outcome.kind)
            }
        }

        const perUser = new Map()
        for (const subscription of page) {
            const userId = Number(subscription.user_id)
            if (!Number.isFinite(userId)) continue
            const kind = outcomeBySubscriptionId.get(Number(subscription.id))
            if (!kind) continue
            if (!perUser.has(userId)) perUser.set(userId, [])
            perUser.get(userId).push(kind)
        }

        const sentUsers = []
        const failedUsers = []
        const retryUsers = []
        for (const [userId, kinds] of perUser.entries()) {
            if (kinds.includes('sent')) {
                sentUsers.push(userId)
            } else if (kinds.some(kind => kind === 'invalid' || kind === 'expired' || kind === 'quarantined')) {
                failedUsers.push(userId)
            } else {
                retryUsers.push(userId)
            }
        }

        const attemptsLiteral = () => PushBroadcastRecipient.sequelize.literal('attempts + 1')
        try {
            if (sentUsers.length > 0) {
                await PushBroadcastRecipient.update(
                    { status: 'sent', sent_at: now, last_error: null },
                    { where: { broadcast_id: broadcastId, user_id: { [Op.in]: sentUsers } } }
                )
            }
            if (failedUsers.length > 0) {
                await PushBroadcastRecipient.update(
                    {
                        status: 'failed',
                        attempts: attemptsLiteral(),
                        last_error: 'push_delivery_failed'
                    },
                    { where: { broadcast_id: broadcastId, user_id: { [Op.in]: failedUsers } } }
                )
            }
            if (retryUsers.length > 0) {
                await PushBroadcastRecipient.update(
                    {
                        status: 'pending',
                        attempts: attemptsLiteral(),
                        last_error: 'push_retryable_error'
                    },
                    { where: { broadcast_id: broadcastId, user_id: { [Op.in]: retryUsers } } }
                )
            }
        } catch (error) {
            console.warn(
                `⚠️ push-рассылка #${broadcastId}: не удалось обновить статусы получателей: ` +
                `${error?.message || error}`
            )
        }
    }

    async sendBroadcast(broadcastId, { now = new Date() } = {}) {
        const broadcast = await PushBroadcast.findByPk(broadcastId)
        if (!broadcast || broadcast.status !== 'sending') {
            return { broadcast, result: null }
        }

        try {
            pushService.ensureConfigured()
        } catch (error) {
            const failedAt = new Date()
            const fatalUpdates = { status: 'failed', updated_at: failedAt, sent_at: null }
            try {
                await PushBroadcast.update(fatalUpdates, { where: { id: broadcast.id, status: 'sending' } })
            } catch (updateError) {
                console.error(
                    `❌ push-рассылка #${broadcast.id}: не удалось пометить failed: ` +
                    `${updateError?.message || updateError}`
                )
            }
            applyUpdates(broadcast, fatalUpdates)
            console.error(
                `❌ push-рассылка #${broadcast.id} не отправлена (fatal): ${error.message}`
            )
            return {
                broadcast,
                result: {
                    success: false,
                    fatal: true,
                    total: 0,
                    sent: 0,
                    failed: 0,
                    removed: 0,
                    quarantined: 0,
                    message: error.message
                }
            }
        }

        let userIds = []
        if (broadcast.target_mode === 'users') {
            const recipientRows = await PushBroadcastRecipient.findAll({
                where: { broadcast_id: broadcast.id },
                attributes: ['user_id']
            })
            userIds = recipientRows.map(row => row.user_id)
        }

        const subscriptionWhere = this.buildActiveSubscriptionWhere({
            targetMode: broadcast.target_mode,
            userIds,
            includeGuests: broadcast.include_guests
        })
        const chunkSize = readBroadcastChunkSize(broadcast.chunk_size)

        let cursor = Number.isInteger(broadcast.last_processed_id)
            ? broadcast.last_processed_id
            : 0
        let sent = Number(broadcast.sent_count) || 0
        let failed = Number(broadcast.failed_count) || 0
        let removed = Number(broadcast.removed_count) || 0
        let quarantined = 0
        let processed = 0
        let snapshotTotal = Number(broadcast.total_subscriptions) || 0

        if (cursor === 0) {
            snapshotTotal = await PushSubscription.count({ where: subscriptionWhere })
            await this.persistProgress(broadcast.id, { total_subscriptions: snapshotTotal })
        }

        while (true) {
            const page = await PushSubscription.findAll({
                where: { ...subscriptionWhere, id: { [Op.gt]: cursor } },
                attributes: [
                    'id', 'user_id', 'endpoint', 'p256dh', 'auth',
                    'failed_attempts', 'last_error', 'last_success_at', 'invalidated_at'
                ],
                order: [['id', 'ASC']],
                limit: chunkSize
            })

            if (page.length === 0) break

            const chunkResult = await pushService.sendToSubscriptions(
                page,
                broadcast.title,
                broadcast.body,
                broadcast.icon || DEFAULT_ICON,
                { url: broadcast.url || '/' }
            )

            sent += chunkResult.sent || 0
            failed += chunkResult.failed || 0
            removed += chunkResult.removed || 0
            quarantined += chunkResult.quarantined || 0
            processed += page.length

            const nextCursor = page[page.length - 1].id
            const progressAt = new Date()
            await this.persistProgress(broadcast.id, {
                sent_count: sent,
                failed_count: failed,
                removed_count: removed,
                last_processed_id: nextCursor,
                chunk_size: chunkSize,
                updated_at: progressAt
            })

            if (broadcast.target_mode === 'users') {
                await this.applyRecipientProgress(broadcast.id, page, chunkResult, progressAt)
            }

            cursor = nextCursor
        }

        const completedAt = new Date()
        const completedTotal = sent + failed
        if (broadcast.target_mode === 'users') {

            try {
                await PushBroadcastRecipient.update(
                    { status: 'failed', last_error: 'push_delivery_failed' },
                    { where: { broadcast_id: broadcast.id, status: 'pending' } }
                )
            } catch (error) {
                console.warn(
                    `⚠️ push-рассылка #${broadcast.id}: не удалось финализировать статусы получателей: ` +
                    `${error?.message || error}`
                )
            }
        }
        const completedUpdates = {
            total_subscriptions: completedTotal,
            sent_count: sent,
            failed_count: failed,
            removed_count: removed,
            status: 'sent',
            sent_at: completedAt,
            updated_at: completedAt
        }
        const [updatedRows] = await PushBroadcast.update(
            completedUpdates,
            { where: { id: broadcast.id, status: 'sending' } }
        )
        applyUpdates(broadcast, completedUpdates)

        if (updatedRows !== 1) {
            console.warn(
                `⚠️ push-рассылка #${broadcast.id}: финальный статус не сохранён ` +
                `(возможно, изменён другим процессом)`
            )
        }

        return {
            broadcast,
            result: {
                success: sent > 0,
                fatal: false,
                total: completedTotal,
                sent,
                failed,
                removed,
                quarantined,
                processed,
                completed: true
            }
        }
    }

    async recoverStaleSending({ now = new Date(), olderThanMs = STALE_SENDING_MS, limit = 50 } = {}) {
        const cutoff = new Date(now.getTime() - olderThanMs)
        const staleRows = await PushBroadcast.findAll({
            where: {
                status: 'sending',
                [Op.or]: [
                    { updated_at: { [Op.lt]: cutoff } },
                    { updated_at: null, started_at: { [Op.lt]: cutoff } },
                    { updated_at: null, started_at: null, created_at: { [Op.lt]: cutoff } }
                ]
            },
            attributes: ['id', 'last_processed_id', 'created_at', 'started_at', 'updated_at'],
            order: [['id', 'ASC']],
            limit
        })

        const recovered = []
        for (const stale of staleRows) {
            try {
                const [updated] = await PushBroadcast.update(
                    { status: 'pending', updated_at: now },
                    { where: { id: stale.id, status: 'sending' } }
                )
                if (updated === 1) {
                    recovered.push(stale.id)
                    console.warn(
                        `⚠️ push-рассылка #${stale.id} зависла в 'sending'; возвращена в 'pending' ` +
                        `для продолжения с курсора ${stale.last_processed_id ?? 0}`
                    )
                }
            } catch (error) {
                console.error(
                    `❌ Не удалось восстановить push-рассылку #${stale.id}: ${error?.message || error}`
                )
            }
        }
        return recovered
    }

    async retryBroadcast(broadcastId) {
        const broadcast = await PushBroadcast.findByPk(broadcastId)
        if (!broadcast) return { broadcast: null, retried: false, reason: 'not_found' }
        if (broadcast.status !== 'failed') {
            return { broadcast, retried: false, reason: `status_${broadcast.status}` }
        }

        let updated = 0
        await PushBroadcast.sequelize.transaction(async transaction => {
            const [count] = await PushBroadcast.update(
                {
                    status: 'pending',
                    last_processed_id: 0,
                    sent_count: 0,
                    failed_count: 0,
                    removed_count: 0,
                    total_subscriptions: 0,
                    started_at: null,
                    sent_at: null,
                    updated_at: new Date()
                },
                { where: { id: broadcastId, status: 'failed' }, transaction }
            )
            updated = count
            if (count === 1) {
                await PushBroadcastRecipient.update(
                    {
                        status: 'pending',
                        attempts: 0,
                        sent_at: null,
                        last_error: null
                    },
                    { where: { broadcast_id: broadcastId }, transaction }
                )
            }
        })

        if (updated === 1) {
            applyUpdates(broadcast, {
                status: 'pending',
                last_processed_id: 0,
                sent_count: 0,
                failed_count: 0,
                removed_count: 0,
                total_subscriptions: 0,
                started_at: null,
                sent_at: null
            })
        }
        return { broadcast, retried: updated === 1, reason: updated === 1 ? null : 'not_updated' }
    }

    async cancelBroadcast(broadcastId) {
        const [updated] = await PushBroadcast.update(
            { status: 'canceled', updated_at: new Date() },
            { where: { id: broadcastId, status: 'pending' } }
        )
        return { canceled: updated === 1 }
    }

    async listPendingDue({ now = new Date(), limit = 20 } = {}) {
        return PushBroadcast.findAll({
            where: {
                status: 'pending',
                [Op.or]: [
                    { scheduled_for: null },
                    { scheduled_for: { [Op.lte]: now } }
                ]
            },
            order: [['scheduled_for', 'ASC']],
            limit
        })
    }

    async listUserSubscriptions(search, { limit = 50, offset = 0 } = {}) {
        const where = {}
        const trimmedSearch = typeof search === 'string' ? search.trim() : ''

        if (trimmedSearch) {
            const pattern = `%${escapeLikePattern(trimmedSearch)}%`
            where[Op.or] = [
                { email: { [Op.iLike]: pattern } },
                { name: { [Op.iLike]: pattern } },
                { username: { [Op.iLike]: pattern } }
            ]
        }

        const { rows, count } = await User.findAndCountAll({
            attributes: ['id', 'email', 'name', 'username', 'role'],
            where,
            order: [['id', 'ASC']],
            limit,
            offset,
            distinct: true
        })

        const subscriptionsByUser = new Map()
        const ids = rows.map(row => row.id)

        if (ids.length > 0) {
            const counts = await PushSubscription.count({
                where: { user_id: { [Op.in]: ids }, invalidated_at: null },
                group: ['user_id']
            })
            for (const entry of counts) {
                const userId = Number(entry.user_id)
                const subscriptions = Number(entry.count)
                if (Number.isFinite(userId) && Number.isFinite(subscriptions)) {
                    subscriptionsByUser.set(userId, subscriptions)
                }
            }
        }

        const items = rows.map(row => {
            const subscriptions = subscriptionsByUser.get(row.id) || 0
            return {
                id: row.id,
                email: row.email,
                name: row.name,
                username: row.username,
                role: row.role,
                subscriptions,
                hasPush: subscriptions > 0
            }
        })

        return { items, total: count }
    }
}

export default new PushBroadcastService()
