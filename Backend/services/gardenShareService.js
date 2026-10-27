import sequelize from '../db.js'
import GardenShare from '../models/GardenShare.js'
import GardenShareSignup from '../models/GardenShareSignup.js'
import Plant from '../models/Plant.js'
import User from '../models/userModels.js'
import NotificationPreference from '../models/NotificationPreference.js'
import { getFirstName } from '../utils/personName.js'
import { generateShareToken, isValidShareToken, normalizeShareToken } from '../utils/shareTokens.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import { isQuietTimeForPreference } from '../utils/quietHours.js'
import {
    GARDEN_VIEW_NOTIFY_INTERVAL_MS,
    buildGardenViewNotification,
    gardenViewDedupeKey,
    shouldNotifyGardenViews
} from '../utils/gardenViews.js'
import { sendNotificationPush, storeNotification } from './notificationService.js'

export const DEFAULT_OWNER_NAME = 'Садовод'
export const PUBLIC_GARDEN_NOT_FOUND = 'Сад не найден или ссылка отозвана'
export const PUBLIC_GARDEN_PLANT_LIMIT = 100
export const SHARE_TOKEN_ATTEMPTS = 3

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

export async function getPublicGarden(token) {
    const normalizedToken = normalizeShareToken(token)
    if (!normalizedToken || !isValidShareToken(normalizedToken)) return null

    const [rows] = await sequelize.query(`
        UPDATE garden_shares
           SET view_count = view_count + 1,
               last_viewed_at = now()
         WHERE token = $1
           AND revoked_at IS NULL
         RETURNING id, user_id, token, created_at, view_count,
                   views_notified_at, views_notified_count
    `, { bind: [normalizedToken] })

    const share = Array.isArray(rows) ? rows[0] : null
    if (!share) return null

    const [owner, plants, plantCount] = await Promise.all([
        User.findByPk(share.user_id, { attributes: OWNER_ATTRIBUTES }),
        Plant.findAll({
            where: { user_id: share.user_id, is_active: true },
            attributes: PUBLIC_PLANT_ATTRIBUTES,
            order: [['created_at', 'ASC'], ['id', 'ASC']],
            limit: PUBLIC_GARDEN_PLANT_LIMIT
        }),
        Plant.count({ where: { user_id: share.user_id, is_active: true } })
    ])

    if (!owner) return null

    void notifyGardenShareViews(share).catch(error => {
        console.warn(
            '⚠️ F50: не удалось уведомить владельца о просмотре сада:',
            error?.message || error
        )
    })

    return mapPublicGarden(share, owner, plants, plantCount)
}

const CLAIM_GARDEN_VIEW_NOTIFICATION_SQL = `
    UPDATE garden_shares
       SET views_notified_at = now(),
           views_notified_count = view_count
     WHERE id = $1
       AND revoked_at IS NULL
       AND view_count > views_notified_count
       AND (views_notified_at IS NULL OR views_notified_at < now() - interval '24 hours')
    RETURNING id, user_id, view_count
`

async function shouldPushGardenView(userId, now) {
    try {
        const [preference, user] = await Promise.all([
            NotificationPreference.findByPk(userId),
            User.findByPk(userId, { attributes: ['timezone'] })
        ])
        return !isQuietTimeForPreference(preference, {
            now,
            timeZone: resolveTimeZone(user?.timezone)
        })
    } catch (error) {
        console.warn(
            '⚠️ F50: не удалось проверить тихие часы, push будет отправлен:',
            error?.message || error
        )
        return true
    }
}

export async function notifyGardenShareViews(share, { now = new Date() } = {}) {
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

    const [claimedRows] = await sequelize.query(CLAIM_GARDEN_VIEW_NOTIFICATION_SQL, {
        bind: [shareId]
    })
    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : null
    if (!claimed) return { notified: false, reason: 'claimed_elsewhere' }

    const total = toCount(claimed.view_count)
    const payload = buildGardenViewNotification({ viewCount: total })
    const dedupeKey = gardenViewDedupeKey(shareId, total)
    if (!dedupeKey) return { notified: false, reason: 'invalid' }

    try {
        const { notification, created } = await storeNotification({
            userId,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            url: payload.url,
            payload: payload.payload,
            dedupeKey
        })
        if (!created) return { notified: false, reason: 'duplicate' }

        if (await shouldPushGardenView(userId, now)) {
            await sendNotificationPush({
                userId,
                title: payload.title,
                body: payload.body,
                data: {
                    url: payload.url,
                    tag: 'garden_view',
                    notificationId: notification.id
                }
            })
        }

        return { notified: true, viewCount: total, notificationId: notification.id }
    } catch (error) {
        console.warn('⚠️ F50: уведомление о просмотрах сада не создано:', error?.message || error)
        return { notified: false, reason: 'error' }
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
    notifyGardenShareViews
}
