import { Op } from 'sequelize'
import MailBroadcast from '../models/MailBroadcast.js'
import MailBroadcastRecipient from '../models/MailBroadcastRecipient.js'
import User from '../models/userModels.js'
import { sendBroadcastEmail } from './mailService.js'
import { getFirstName } from '../utils/personName.js'
import { withDistributedLock } from '../utils/distributedLock.js'
import {
    resolveScheduledStatus,
    validateMailBroadcastInput
} from '../utils/mailBroadcastValidation.js'

const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_SQL_PATTERN = '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
const MAX_ERROR_LENGTH = 500

const DEFAULT_DELAY_MS = 200
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_SYNC_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 1000

const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000
const DEDUPE_STATUSES = ['pending', 'sending', 'sent']

export const MAIL_BROADCAST_LOCK = 'job:mail-broadcast'
export const MAIL_BROADCAST_LOCK_TTL_MS = 3 * 60 * 1000

export const STALE_SENDING_MS = 6 * 60 * 60 * 1000

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback
    return Math.min(parsed, max)
}

export function readMailBroadcastSettings(env = process.env) {
    return {
        delayMs: parsePositiveInt(env.MAIL_BROADCAST_DELAY_MS, DEFAULT_DELAY_MS),
        batchSize: parsePositiveInt(env.MAIL_BROADCAST_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
        syncBatchSize: parsePositiveInt(
            env.MAIL_BROADCAST_SYNC_BATCH,
            DEFAULT_SYNC_BATCH_SIZE,
            MAX_BATCH_SIZE
        ),
        dedupeWindowMs: parsePositiveInt(
            env.MAIL_BROADCAST_DEDUPE_WINDOW_MS,
            DEFAULT_DEDUPE_WINDOW_MS
        )
    }
}

export function escapeLikePattern(value) {
    return value.replace(/[\\%_]/g, character => `\\${character}`)
}

export function normalizeEmail(value) {
    const email = typeof value === 'string' ? value.trim() : ''
    if (!email || email.length > MAX_EMAIL_LENGTH) return ''
    return EMAIL_PATTERN.test(email) ? email : ''
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function errorText(error) {
    const message = error?.message || String(error)
    return message.slice(0, MAX_ERROR_LENGTH)
}

function toPlain(row) {
    if (!row) return null
    if (typeof row.get === 'function') return row.get({ plain: true })
    return { ...row }
}

class MailBroadcastService {
    constructor() {
        this.sendEmail = sendBroadcastEmail
    }

    buildRecipientWhere({ targetMode, userIds = [] } = {}) {
        if (targetMode === 'users') {
            return { id: { [Op.in]: [...userIds] } }
        }
        return {}
    }

    async createBroadcast({ adminId = null, payload, now = new Date(), deferDelivery = false } = {}) {
        const validation = validateMailBroadcastInput(payload)
        if (!validation.ok) {
            const error = new Error(validation.message)
            error.statusCode = 400
            throw error
        }

        const value = validation.value
        const scheduledFor = value.scheduledFor ? new Date(value.scheduledFor) : null
        // deferDelivery: немедленную рассылку не отправляем внутри HTTP-запроса,
        // а оставляем в статусе 'pending' — её заберёт mailBroadcastJob (раз в минуту).
        const status = deferDelivery ? 'pending' : resolveScheduledStatus(value.scheduledFor, now)
        const recipientWhere = this.buildRecipientWhere({
            targetMode: value.targetMode,
            userIds: value.userIds
        })

        let broadcast
        let recipients = []

        await MailBroadcast.sequelize.transaction(async transaction => {
            const totalRecipients = await User.count({ where: recipientWhere, transaction })

            broadcast = await MailBroadcast.create({
                subject: value.subject,
                body: value.body,
                cta_label: value.ctaLabel,
                cta_url: value.ctaUrl,
                target_mode: value.targetMode,
                status,
                scheduled_for: scheduledFor,
                total_recipients: totalRecipients,
                created_by: adminId
            }, { transaction })

            if (value.targetMode === 'users' && value.userIds.length > 0) {
                recipients = await this.materializeRecipients(broadcast.id, recipientWhere, {
                    transaction
                })
            }
        })

        if (value.targetMode === 'users') {
            if (typeof broadcast.set === 'function') {
                broadcast.set({ total_recipients: recipients.length })
            } else {
                broadcast.total_recipients = recipients.length
            }
        }

        return { broadcast, recipients, sentResult: null }
    }

    /**
     * Ищет рассылку с тем же содержимым, созданную этим же админом за последнее окно.
     * Защищает от повторного нажатия «Отправить» (в том числе после оборванного
     * запроса), из-за которого письма уходили дважды.
     */
    async findRecentDuplicate({
        subject,
        body,
        ctaLabel = '',
        ctaUrl = '',
        targetMode,
        adminId = null,
        now = new Date(),
        windowMs = DEFAULT_DEDUPE_WINDOW_MS
    } = {}) {
        if (!subject || !body || !targetMode) return null

        const where = {
            subject,
            body,
            target_mode: targetMode,
            cta_label: ctaLabel || null,
            cta_url: ctaUrl || null,
            status: { [Op.in]: DEDUPE_STATUSES },
            created_at: { [Op.gte]: new Date(now.getTime() - windowMs) }
        }
        if (adminId) where.created_by = adminId

        return MailBroadcast.findOne({ where, order: [['id', 'DESC']] })
    }

    async materializeRecipients(broadcastId, where, { transaction } = {}) {
        const users = await User.findAll({
            attributes: ['id', 'email'],
            where,
            order: [['id', 'ASC']],
            transaction
        })

        const rows = []
        for (const user of users) {
            const email = normalizeEmail(user.email)
            if (!email) continue
            rows.push({
                broadcast_id: broadcastId,
                user_id: user.id,
                email,
                status: 'pending'
            })
        }

        if (rows.length > 0) {
            await MailBroadcastRecipient.bulkCreate(rows, { transaction, ignoreDuplicates: true })
        }

        await MailBroadcast.update(
            { total_recipients: rows.length },
            { where: { id: broadcastId }, transaction }
        )

        return rows
    }

    async ensureRecipients(broadcast) {
        const existing = await MailBroadcastRecipient.count({
            where: { broadcast_id: broadcast.id }
        })
        if (existing > 0) return existing

        const where = this.buildRecipientWhere({
            targetMode: broadcast.target_mode,
            userIds: broadcast.target_mode === 'users'
                ? await this.selectedUserIds(broadcast.id)
                : []
        })

        const rows = await this.materializeRecipients(broadcast.id, where)
        return rows.length
    }

    async selectedUserIds(broadcastId) {
        const rows = await MailBroadcastRecipient.findAll({
            where: { broadcast_id: broadcastId },
            attributes: ['user_id']
        })
        return rows.map(row => row.user_id)
    }

    async sendBroadcast(broadcastId, { now = new Date(), batchSize, delayMs } = {}) {
        const broadcast = await MailBroadcast.findByPk(broadcastId)
        if (!broadcast || broadcast.status !== 'sending') {
            return { broadcast, result: null }
        }

        const settings = readMailBroadcastSettings()
        const limit = parsePositiveInt(batchSize, settings.batchSize, MAX_BATCH_SIZE)
        const pause = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : settings.delayMs

        await this.ensureRecipients(broadcast)

        const pending = await MailBroadcastRecipient.findAll({
            where: { broadcast_id: broadcast.id, status: 'pending' },
            order: [['id', 'ASC']],
            limit
        })

        const nameById = await this.loadRecipientNames(pending)

        let sent = 0
        let failed = 0
        let skipped = 0
        const errors = []

        for (const [index, row] of pending.entries()) {
            const attempts = (row.attempts || 0) + 1

            if (!nameById.has(row.user_id)) {
                skipped++
                await row.update({ status: 'skipped', attempts, error: 'Пользователь удалён' })
                continue
            }

            if (pause > 0 && index < pending.length - 1) await sleep(pause)

            try {
                await this.sendEmail({
                    to: row.email,
                    userName: getFirstName(nameById.get(row.user_id)),
                    subject: broadcast.subject,
                    body: broadcast.body,
                    ctaLabel: broadcast.cta_label || '',
                    ctaUrl: broadcast.cta_url || ''
                })
                sent++
                await row.update({ status: 'sent', attempts, error: null, sent_at: now })
            } catch (error) {
                failed++
                errors.push({ email: row.email, error: errorText(error) })
                await row.update({ status: 'failed', attempts, error: errorText(error) })
                console.error(`❌ Письмо для ${row.email} не отправлено:`, error?.message || error)
            }
        }

        const counters = await this.countRecipients(broadcast.id)
        const done = counters.remaining === 0
        const status = !done
            ? 'sending'
            : counters.sent > 0 || counters.total === 0 ? 'sent' : 'failed'

        const updates = {
            total_recipients: counters.total,
            sent_count: counters.sent,
            failed_count: counters.failed,
            skipped_count: counters.skipped,
            status,
            sent_at: done ? now : null
        }

        await MailBroadcast.update(updates, { where: { id: broadcast.id } })

        if (typeof broadcast.set === 'function') {
            broadcast.set(updates)
        } else {
            Object.assign(broadcast, updates)
        }

        return {
            broadcast,
            result: {
                success: counters.sent > 0,
                total: counters.total,
                sent: counters.sent,
                failed: counters.failed,
                skipped: counters.skipped,
                remaining: counters.remaining,
                done,
                batch: { sent, failed, skipped, picked: pending.length },
                errors: errors.length > 0 ? errors : undefined
            }
        }
    }

    async loadRecipientNames(rows) {
        const ids = [...new Set(rows.map(row => row.user_id))]
        if (ids.length === 0) return new Map()

        const users = await User.findAll({
            where: { id: { [Op.in]: ids } },
            attributes: ['id', 'name']
        })

        return new Map(users.map(user => [user.id, user.name]))
    }

    async countRecipients(broadcastId) {
        const rows = await MailBroadcastRecipient.findAll({
            where: { broadcast_id: broadcastId },
            attributes: ['status', [MailBroadcast.sequelize.fn('COUNT', '*'), 'count']],
            group: ['status'],
            raw: true
        })

        const counters = { total: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 }
        for (const row of rows) {
            const value = Number(row.count)
            if (!Number.isFinite(value)) continue
            counters.total += value
            if (row.status === 'sent') counters.sent += value
            else if (row.status === 'failed') counters.failed += value
            else if (row.status === 'skipped') counters.skipped += value
            else if (row.status === 'pending') counters.remaining += value
        }
        return counters
    }

    async deliverBroadcast(broadcastId, { now = new Date(), batchSize } = {}) {
        const outcome = await withDistributedLock(
            MAIL_BROADCAST_LOCK,
            { ttlMs: MAIL_BROADCAST_LOCK_TTL_MS },
            () => this.sendBroadcast(broadcastId, { now, batchSize })
        )

        if (!outcome.ran) {
            return {
                broadcast: toPlain(await MailBroadcast.findByPk(broadcastId)),
                result: null,
                queued: true
            }
        }

        const { broadcast, result } = outcome.result
        return { broadcast, result, queued: false }
    }

    async cancelBroadcast(broadcastId) {
        const [updated] = await MailBroadcast.update(
            { status: 'canceled' },
            { where: { id: broadcastId, status: 'pending' } }
        )
        return { canceled: updated === 1 }
    }

    async listPendingDue({ now = new Date(), limit = 20 } = {}) {
        return MailBroadcast.findAll({
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

    async listUnfinishedSending({ limit = 20 } = {}) {
        return MailBroadcast.findAll({
            where: { status: 'sending' },
            order: [['created_at', 'ASC'], ['id', 'ASC']],
            limit
        })
    }

    async failStaleSending({ now = new Date(), olderThanMs = STALE_SENDING_MS } = {}) {
        const cutoff = new Date(now.getTime() - olderThanMs)
        const candidates = await MailBroadcast.findAll({
            where: { status: 'sending', created_at: { [Op.lt]: cutoff } },
            attributes: ['id', 'created_at']
        })

        const failed = []
        for (const candidate of candidates) {
            const remaining = await MailBroadcastRecipient.count({
                where: { broadcast_id: candidate.id, status: 'pending' }
            })
            if (remaining === 0) continue

            const [updated] = await MailBroadcast.update(
                { status: 'failed' },
                { where: { id: candidate.id, status: 'sending' } }
            )
            if (updated !== 1) continue

            failed.push(candidate.id)
            console.warn(
                `⚠️ Рассылка писем #${candidate.id} зависла в статусе 'sending' ` +
                `с ${new Date(candidate.created_at).toISOString()}: осталось ${remaining} писем`
            )
        }

        return failed
    }

    async listRecipients(search, { limit = 50, offset = 0 } = {}) {
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

        const items = rows.map(row => ({
            id: row.id,
            email: row.email,
            name: row.name,
            username: row.username,
            role: row.role,
            hasEmail: Boolean(normalizeEmail(row.email))
        }))

        return { items, total: count }
    }

    async countAudience() {
        const [total, withEmail] = await Promise.all([
            User.count(),
            User.count({ where: { email: { [Op.regexp]: EMAIL_SQL_PATTERN } } })
        ])

        return { total, withEmail, withoutEmail: total - withEmail }
    }
}

export default new MailBroadcastService()
