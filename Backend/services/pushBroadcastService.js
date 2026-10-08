import { Op } from 'sequelize'
import PushBroadcast from '../models/PushBroadcast.js'
import PushBroadcastRecipient from '../models/PushBroadcastRecipient.js'
import PushSubscription from '../models/PushSubscription.js'
import User from '../models/userModels.js'
import pushService from './pushService.js'
import {
    resolveScheduledStatus,
    validateBroadcastInput
} from '../utils/pushBroadcastValidation.js'

const DEFAULT_ICON = '/icons/icon-192.png'

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

    async createBroadcast({ adminId = null, payload, now = new Date() } = {}) {
        const validation = validateBroadcastInput(payload)
        if (!validation.ok) {
            const error = new Error(validation.message)
            error.statusCode = 400
            throw error
        }

        const value = validation.value
        const scheduledFor = value.scheduledFor ? new Date(value.scheduledFor) : null
        const status = resolveScheduledStatus(value.scheduledFor, now)
        const subscriptionWhere = this.buildSubscriptionWhere({
            targetMode: value.targetMode,
            userIds: value.userIds,
            includeGuests: value.includeGuests
        })

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
                created_by: adminId
            }, { transaction })

            if (value.targetMode === 'users' && value.userIds.length > 0) {
                recipients = await PushBroadcastRecipient.bulkCreate(
                    value.userIds.map(userId => ({
                        broadcast_id: broadcast.id,
                        user_id: userId
                    })),
                    { transaction, returning: true }
                )
            }
        })

        if (status !== 'sending') {
            return { broadcast, recipients, sentResult: null }
        }

        const { broadcast: updated, result } = await this.sendBroadcast(broadcast.id, { now })
        return { broadcast: updated, recipients, sentResult: result }
    }

    async sendBroadcast(broadcastId, { now = new Date() } = {}) {
        const broadcast = await PushBroadcast.findByPk(broadcastId)
        if (!broadcast || broadcast.status !== 'sending') {
            return { broadcast, result: null }
        }

        let userIds = []
        if (broadcast.target_mode === 'users') {
            const recipientRows = await PushBroadcastRecipient.findAll({
                where: { broadcast_id: broadcast.id },
                attributes: ['user_id']
            })
            userIds = recipientRows.map(row => row.user_id)
        }

        const subscriptionWhere = this.buildSubscriptionWhere({
            targetMode: broadcast.target_mode,
            userIds,
            includeGuests: broadcast.include_guests
        })
        const subscriptions = await PushSubscription.findAll({ where: subscriptionWhere })

        const result = await pushService.sendToSubscriptions(
            subscriptions,
            broadcast.title,
            broadcast.body,
            broadcast.icon || DEFAULT_ICON,
            { url: broadcast.url || '/' }
        )

        const updates = {
            total_subscriptions: result.total ?? subscriptions.length,
            sent_count: result.sent ?? 0,
            failed_count: result.failed ?? 0,
            removed_count: result.removed ?? 0,
            sent_at: now,
            status: (result.sent ?? 0) > 0 ? 'sent' : 'failed'
        }

        await PushBroadcast.update(updates, { where: { id: broadcast.id } })

        if (typeof broadcast.set === 'function') {
            broadcast.set(updates)
        } else {
            Object.assign(broadcast, updates)
        }

        return { broadcast, result }
    }

    async cancelBroadcast(broadcastId) {
        const [updated] = await PushBroadcast.update(
            { status: 'canceled' },
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
                where: { user_id: { [Op.in]: ids } },
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
