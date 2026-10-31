import { createHash } from 'node:crypto'
import sequelize from '../db.js'
import GardenShare from '../models/GardenShare.js'
import GardenShareSignup from '../models/GardenShareSignup.js'
import Plant from '../models/Plant.js'
import PushSubscription from '../models/PushSubscription.js'
import User from '../models/userModels.js'
import NotificationPreference from '../models/NotificationPreference.js'
import { getFirstName } from '../utils/personName.js'
import { generateShareToken, isValidShareToken, normalizeShareToken } from '../utils/shareTokens.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import { isQuietTimeForPreference } from '../utils/quietHours.js'
import { acquireLock, releaseLock } from '../utils/distributedLock.js'
import { getRedisKeyPrefix, redisCommandStrict, withTimeout } from '../redis.js'
import {
    GARDEN_VIEW_NOTIFY_INTERVAL_MS,
    buildGardenViewNotification,
    gardenViewDedupeKey,
    shouldNotifyGardenViews
} from '../utils/gardenViews.js'
import {
    deliverNotificationToMessengersSafely,
    sendNotificationPush,
    storeNotification
} from './notificationService.js'

export const DEFAULT_OWNER_NAME = 'Садовод'
export const PUBLIC_GARDEN_NOT_FOUND = 'Сад не найден или ссылка отозвана'
export const PUBLIC_GARDEN_PLANT_LIMIT = 100
export const SHARE_TOKEN_ATTEMPTS = 3

export const GARDEN_VIEW_DEDUPE_MS = 24 * 60 * 60 * 1000

const GARDEN_VIEW_NOTIFY_LOCK_TTL_MS = 15_000
const GARDEN_VIEW_DEDUPE_REDIS_TIMEOUT_MS = 1000
const GARDEN_VISIT_MEMORY_LIMIT = 5000
const GARDEN_VISIT_KEY_MAX_USER_AGENT = 512

const recentGardenVisits = new Map()

const OWNER_ATTRIBUTES = ['id', 'name', 'username']
const PUBLIC_PLANT_ATTRIBUTES = ['id', 'name', 'species', 'watering_interval_days']

function toCount(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function toIsoDate(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function isUniqueViolation(error) {
    return error?.name === 'SequelizeUniqueConstraintError'
}

function retryDelay(attempt) {
    return new Promise(resolve => setTimeout(resolve, 10 * attempt))
}

async function findActiveShareAfterConflict(userId, attempts = 5) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const share = await findActiveShare(userId)
        if (share) return share
        if (attempt < attempts) await retryDelay(attempt)
    }
    return null
}

export function buildOwnerName(user) {
    const firstName = getFirstName(user?.name)
    if (firstName) return firstName
    const username = typeof user?.username === 'string' ? user.username.trim() : ''
    if (username) return username
    return DEFAULT_OWNER_NAME
}

export function buildSharePayload(share, signupCount = 0) {
    const token = typeof share?.token === 'string' ? share.token : ''
    return {
        token,
        path: `/garden/${token}`,
        createdAt: toIsoDate(share?.created_at),
        viewCount: toCount(share?.view_count),
        signupCount: toCount(signupCount)
    }
}

function buildPublicPlant(plant) {
    return {
        id: plant.id,
        name: plant.name,
        species: plant.species ?? null,
        intervalDays: Number.isInteger(plant.watering_interval_days)
            ? plant.watering_interval_days
            : null
    }
}

async function findActiveShare(userId) {
    return GardenShare.findOne({
        where: { user_id: userId, revoked_at: null },
        order: [['created_at', 'DESC'], ['id', 'DESC']]
    })
}

async function countSignups(shareId) {
    if (!shareId) return 0
    return GardenShareSignup.count({ where: { share_id: shareId } })
}

async function toStatusPayload(share) {
    return buildSharePayload(share, await countSignups(share.id))
}

export async function createOrGetShare(userId) {
    const existing = await findActiveShare(userId)
    if (existing) return toStatusPayload(existing)

    for (let attempt = 1; attempt <= SHARE_TOKEN_ATTEMPTS; attempt += 1) {
        try {
            const share = await GardenShare.create({
                user_id: userId,
                token: generateShareToken()
            })
            return buildSharePayload(share, 0)
        } catch (error) {
            if (!isUniqueViolation(error)) throw error

            const concurrent = await findActiveShareAfterConflict(userId)
            if (concurrent) return toStatusPayload(concurrent)
        }
    }

    const current = await findActiveShare(userId)
    if (current) return toStatusPayload(current)
    throw new Error('Не удалось создать ссылку на сад')
}

export async function getShareStatus(userId) {
    const share = await findActiveShare(userId)
    if (!share) return null
    return toStatusPayload(share)
}

export async function revokeShare(userId) {
    await GardenShare.update(
        { revoked_at: new Date() },
        { where: { user_id: userId, revoked_at: null } }
    )
}

function mapPublicGarden(share, owner, plants, plantCount) {
    return {
        token: share.token,
        ownerName: buildOwnerName(owner),
        plantCount: toCount(plantCount),
        plants: plants.map(buildPublicPlant),
        sharedAt: toIsoDate(share.created_at),
        viewCount: toCount(share.view_count)
    }
}

const SELECT_PUBLIC_GARDEN_SQL = `
    SELECT id, user_id, token, created_at, view_count,
           views_notified_at, views_notified_count
      FROM garden_shares
     WHERE token = $1
       AND revoked_at IS NULL
`

const INCREMENT_GARDEN_VIEWS_SQL = `
    UPDATE garden_shares
       SET view_count = view_count + 1,
           last_viewed_at = now()
     WHERE id = $1
       AND revoked_at IS NULL
     RETURNING id, user_id, token, created_at, view_count,
               views_notified_at, views_notified_count
`

const LOAD_GARDEN_VIEW_NOTIFICATION_STATE_SQL = `
    SELECT id, user_id, view_count, views_notified_at, views_notified_count
      FROM garden_shares
     WHERE id = $1
       AND revoked_at IS NULL
`

const MARK_GARDEN_VIEWS_NOTIFIED_SQL = `
    UPDATE garden_shares
       SET views_notified_at = now(),
           views_notified_count = GREATEST(views_notified_count, $2)
     WHERE id = $1
       AND revoked_at IS NULL
`

function toNowMs(now) {
    const date = now instanceof Date ? now : new Date(now)
    return Number.isFinite(date.getTime()) ? date.getTime() : Date.now()
}

export function buildGardenVisitorKey({ ip, userAgent } = {}) {
    const ipPart = typeof ip === 'string' ? ip.trim() : ''
    const userAgentPart = typeof userAgent === 'string'
        ? userAgent.trim().slice(0, GARDEN_VISIT_KEY_MAX_USER_AGENT)
        : ''
    if (!ipPart && !userAgentPart) return null

    return createHash('sha256')
        .update(`${ipPart}\n${userAgentPart}`)
        .digest('hex')
        .slice(0, 32)
}

function pruneGardenVisitMemory(nowMs) {
    if (recentGardenVisits.size < GARDEN_VISIT_MEMORY_LIMIT) return

    for (const [key, expiresAt] of recentGardenVisits) {
        if (expiresAt <= nowMs) recentGardenVisits.delete(key)
    }
    while (recentGardenVisits.size >= GARDEN_VISIT_MEMORY_LIMIT) {
        const oldestKey = recentGardenVisits.keys().next().value
        if (oldestKey === undefined) break
        recentGardenVisits.delete(oldestKey)
    }
}

function claimGardenVisitInMemory(key, { nowMs, ttlMs }) {
    pruneGardenVisitMemory(nowMs)

    const expiresAt = recentGardenVisits.get(key)
    if (Number.isFinite(expiresAt) && expiresAt > nowMs) return false

    recentGardenVisits.set(key, nowMs + ttlMs)
    return true
}

export async function claimGardenView(
    shareId,
    visitorKey,
    {
        now = new Date(),
        ttlMs = GARDEN_VIEW_DEDUPE_MS,
        command = redisCommandStrict
    } = {}
) {
    const id = Number(shareId)
    if (!Number.isInteger(id) || id < 1 || !visitorKey) {
        return { counted: true, deduped: false, degraded: true }
    }

    const nowMs = toNowMs(now)
    const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.trunc(ttlMs) : GARDEN_VIEW_DEDUPE_MS
    const key = `${getRedisKeyPrefix()}:garden:visit:${id}:${visitorKey}`

    try {
        const reply = await withTimeout(
            command(['SET', key, String(nowMs), 'PX', String(effectiveTtl), 'NX']),
            GARDEN_VIEW_DEDUPE_REDIS_TIMEOUT_MS,
            'garden view dedupe redis timeout'
        )
        return reply === 'OK'
            ? { counted: true, deduped: false, degraded: false }
            : { counted: false, deduped: true, degraded: false }
    } catch (error) {
        if (process.env.REDIS_DEBUG === 'true') {
            console.warn('⚠️ F50: дедуп просмотров без Redis:', error?.message || error)
        }
        const counted = claimGardenVisitInMemory(key, { nowMs, ttlMs: effectiveTtl })
        return { counted, deduped: !counted, degraded: true }
    }
}

export function resetGardenViewDedupeState() {
    recentGardenVisits.clear()
}

export async function getPublicGarden(token, {
    viewerUserId = null,
    ip = null,
    userAgent = null,
    now = new Date(),
    deps = {}
} = {}) {
    const normalizedToken = normalizeShareToken(token)
    if (!normalizedToken || !isValidShareToken(normalizedToken)) return null

    const db = deps.sequelize || sequelize
    const UserModel = deps.User || User
    const PlantModel = deps.Plant || Plant

    const [rows] = await db.query(SELECT_PUBLIC_GARDEN_SQL, {
        bind: [normalizedToken]
    })
    let share = Array.isArray(rows) ? rows[0] : null
    if (!share) return null

    const viewerId = Number(viewerUserId)
    const isOwnerView = Number.isInteger(viewerId) && viewerId > 0 &&
        viewerId === Number(share.user_id)

    let viewCounted = false
    if (!isOwnerView) {
        const visitorKey = buildGardenVisitorKey({ ip, userAgent })
        const claimed = await (deps.claimGardenView || claimGardenView)(
            share.id,
            visitorKey,
            { now }
        )
        if (claimed.counted) {
            const [updatedRows] = await db.query(INCREMENT_GARDEN_VIEWS_SQL, {
                bind: [share.id]
            })
            const updated = Array.isArray(updatedRows) ? updatedRows[0] : null
            if (updated) {
                share = updated
                viewCounted = true
            }
        }
    }

    const [owner, plants, plantCount] = await Promise.all([
        UserModel.findByPk(share.user_id, { attributes: OWNER_ATTRIBUTES }),
        PlantModel.findAll({
            where: { user_id: share.user_id, is_active: true },
            attributes: PUBLIC_PLANT_ATTRIBUTES,
            order: [['created_at', 'ASC'], ['id', 'ASC']],
            limit: PUBLIC_GARDEN_PLANT_LIMIT
        }),
        PlantModel.count({ where: { user_id: share.user_id, is_active: true } })
    ])

    if (!owner) return null

    if (viewCounted) {
        void (deps.notifyGardenShareViews || notifyGardenShareViews)(share, { now }).catch(error => {
            console.warn(
                '⚠️ F50: не удалось уведомить владельца о просмотре сада:',
                error?.message || error
            )
        })
    }

    return mapPublicGarden(share, owner, plants, plantCount)
}

export async function resolveGardenViewDelivery(userId, now = new Date(), deps = {}) {
    const NotificationPreferenceModel = deps.NotificationPreference || NotificationPreference
    const UserModel = deps.User || User
    const PushSubscriptionModel = deps.PushSubscription || PushSubscription

    try {
        const [preference, user, activeSubscriptions] = await Promise.all([
            NotificationPreferenceModel.findByPk(userId),
            UserModel.findByPk(userId, { attributes: ['timezone'] }),
            PushSubscriptionModel.count({ where: { user_id: userId, invalidated_at: null } })
        ])

        if (isQuietTimeForPreference(preference, {
            now,
            timeZone: resolveTimeZone(user?.timezone)
        })) {
            console.log(
                `🌙 F50: у пользователя ${userId} тихие часы — ` +
                'уведомление о просмотрах сада только в приложении'
            )
            return { push: false, messengers: false, reason: 'quiet_hours' }
        }

        if (toCount(activeSubscriptions) === 0) {
            return { push: false, messengers: true, reason: 'push_disabled' }
        }

        return { push: true, messengers: false, reason: null }
    } catch (error) {
        console.warn(
            '⚠️ F50: не удалось проверить настройки владельца, push будет отправлен:',
            error?.message || error
        )
        return { push: true, messengers: false, reason: 'error' }
    }
}

async function deliverGardenViewNotification({
    userId,
    payload,
    notification,
    now,
    deps = {}
}) {
    const delivery = await (deps.resolveGardenViewDelivery || resolveGardenViewDelivery)(
        userId,
        now,
        deps
    )
    const notificationId = Number.isInteger(notification?.id) ? notification.id : null

    if (delivery.push) {
        await (deps.sendNotificationPush || sendNotificationPush)({
            userId,
            title: payload.title,
            body: payload.body,
            data: {
                url: payload.url,
                tag: 'garden_view',
                notificationId
            }
        })
        return
    }

    if (delivery.messengers) {
        await (deps.deliverNotificationToMessengersSafely || deliverNotificationToMessengersSafely)({
            userId,
            title: payload.title,
            body: payload.body,
            data: {
                url: payload.url,
                tag: 'garden_view',
                notificationId
            }
        })
    }
}

export async function notifyGardenShareViews(share, {
    now = new Date(),
    deps = {}
} = {}) {
    const shareId = Number(share?.id)
    const userId = Number(share?.user_id)
    const viewCount = toCount(share?.view_count)

    if (!Number.isInteger(shareId) || shareId < 1 ||
        !Number.isInteger(userId) || userId < 1 ||
        viewCount < 1) {
        return { notified: false, reason: 'invalid' }
    }

    const shouldNotify = shouldNotifyGardenViews({
        viewCount,
        viewsNotifiedCount: share?.views_notified_count,
        viewsNotifiedAt: share?.views_notified_at,
        now,
        intervalMs: GARDEN_VIEW_NOTIFY_INTERVAL_MS
    })
    if (!shouldNotify) return { notified: false, reason: 'throttled' }

    const lock = await (deps.acquireLock || acquireLock)(`garden-view-notify:${shareId}`, {
        ttlMs: GARDEN_VIEW_NOTIFY_LOCK_TTL_MS
    })
    if (!lock?.acquired) return { notified: false, reason: 'claimed_elsewhere' }

    try {
        const [rows] = await (deps.sequelize || sequelize).query(
            LOAD_GARDEN_VIEW_NOTIFICATION_STATE_SQL,
            { bind: [shareId] }
        )
        const fresh = Array.isArray(rows) ? rows[0] : null
        if (!fresh) return { notified: false, reason: 'invalid' }

        const total = toCount(fresh.view_count)
        const freshShouldNotify = shouldNotifyGardenViews({
            viewCount: total,
            viewsNotifiedCount: fresh.views_notified_count,
            viewsNotifiedAt: fresh.views_notified_at,
            now,
            intervalMs: GARDEN_VIEW_NOTIFY_INTERVAL_MS
        })
        if (!freshShouldNotify) return { notified: false, reason: 'throttled' }

        const payload = buildGardenViewNotification({ viewCount: total })
        const dedupeKey = gardenViewDedupeKey(shareId, total)
        if (!dedupeKey) return { notified: false, reason: 'invalid' }

        let stored
        try {
            stored = await (deps.storeNotification || storeNotification)({
                userId,
                type: payload.type,
                title: payload.title,
                body: payload.body,
                url: payload.url,
                payload: payload.payload,
                dedupeKey
            })
        } catch (error) {
            console.warn('⚠️ F50: уведомление о просмотрах сада не создано:', error?.message || error)
            return { notified: false, reason: 'error' }
        }

        try {
            await (deps.sequelize || sequelize).query(MARK_GARDEN_VIEWS_NOTIFIED_SQL, {
                bind: [shareId, total]
            })
        } catch (error) {
            console.warn(
                '⚠️ F50: не удалось обновить состояние троттлинга просмотров:',
                error?.message || error
            )
        }

        if (!stored?.created) return { notified: false, reason: 'duplicate' }

        await deliverGardenViewNotification({
            userId,
            payload,
            notification: stored.notification,
            now,
            deps
        })

        return {
            notified: true,
            viewCount: total,
            notificationId: stored.notification?.id ?? null
        }
    } finally {
        await (deps.releaseLock || releaseLock)(lock)
    }
}

export async function attributeShareSignup(userId, shareToken, { transaction } = {}) {
    try {
        const targetUserId = Number(userId)
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) return false

        const token = normalizeShareToken(shareToken)
        if (!token || !isValidShareToken(token)) return false

        const share = await GardenShare.findOne({
            where: { token, revoked_at: null },
            attributes: ['id'],
            transaction
        })
        if (!share) return false

        const [, affectedRows] = await sequelize.query(`
            INSERT INTO garden_share_signups (share_id, user_id, created_at)
            VALUES ($1, $2, now())
            ON CONFLICT (user_id) DO NOTHING
        `, { bind: [share.id, targetUserId], transaction })

        if (typeof affectedRows === 'number') return affectedRows > 0
        return Number(affectedRows?.rowCount) > 0
    } catch (error) {
        console.error('⚠️ Не удалось атрибутировать регистрацию из шаринга:', error?.message || error)
        return false
    }
}

export default {
    createOrGetShare,
    getShareStatus,
    revokeShare,
    getPublicGarden,
    attributeShareSignup,
    notifyGardenShareViews,
    buildGardenVisitorKey,
    claimGardenView,
    resolveGardenViewDelivery,
    resetGardenViewDedupeState
}
