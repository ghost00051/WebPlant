import sequelize from '../db.js'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import WateringLog from '../models/WateringLog.js'
import ChatLog from '../models/ChatLog.js'
import AuthSession from '../models/AuthSession.js'
import Passkey from '../models/Passkey.js'
import PushSubscription from '../models/PushSubscription.js'
import PushBroadcastRecipient from '../models/PushBroadcastRecipient.js'
import Notification from '../models/Notification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import UserCookieConsent from '../models/userCookieConsentModels.js'
import UserLegalConsent from '../models/userLegalConsentModels.js'
import { hasSiteVisitDays, hasUsersCreatedAt } from '../utils/adminSchema.js'
import { removePlantPhotoFiles } from '../utils/plantPhotoCleanup.js'
import { collectChatPhotoUrls, removeChatPhotoFiles } from '../utils/chatPhoto.js'
import {
    DEFAULT_AUDIT_LIMIT,
    MAX_AUDIT_LIMIT,
    listAdminActions,
    recordAdminAction
} from '../utils/adminAudit.js'
import {
    TIMEZONE,
    escapeLike,
    isValidPrivilegeLevel,
    isValidRole,
    parseDay,
    parseOptionalId,
    parseOrder,
    parsePagination,
    parseSearch,
    parseSort,
    userCreatedAtSql
} from '../utils/adminAnalytics.js'

const MSK = `'${TIMEZONE}'`
const dayOf = expression => `((${expression}) AT TIME ZONE ${MSK})::date`

const DEFAULT_MODELS = {
    User,
    Plant,
    PlantPhoto,
    WateringLog,
    ChatLog,
    AuthSession,
    Passkey,
    PushSubscription,
    PushBroadcastRecipient,
    Notification,
    NotificationPreference,
    UserCookieConsent,
    UserLegalConsent
}

const WATERING_ACTIONS = ['watered', 'skipped']
const CHAT_ROLES = ['user', 'assistant', 'system']

const USER_SORT_COLUMNS = {
    created: 'created_at',
    email: 'u.email',
    username: 'u.username',
    plants: 'plants',
    waterings: 'waterings',
    photos: 'photos',
    chat: 'chat_messages',
    activity: 'last_activity_at',
    id: 'u.id'
}

const PLANT_SORT_COLUMNS = {
    created: 'p.created_at',
    name: 'p.name',
    species: 'p.species',
    waterings: 'waterings',
    next: 'p.next_watering_at',
    id: 'p.id'
}

const WATERING_SORT_COLUMNS = {
    action_at: 'w.action_at',
    id: 'w.id'
}

const PHOTO_SORT_COLUMNS = {
    created: 'ph.created_at',
    id: 'ph.id'
}

const CHAT_SORT_COLUMNS = {
    created: 'c.created_at',
    id: 'c.id'
}

function select(sql, params = []) {
    return sequelize.query(sql, { bind: params, type: sequelize.QueryTypes.SELECT })
}

function toInteger(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function parseIdParam(value) {
    if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) return null
    return parsed
}

function pagedResponse(items, total, { page, limit }) {
    return {
        items,
        total,
        page,
        limit,
        pages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1
    }
}

function likePattern(search) {
    return `%${escapeLike(search)}%`
}

function jsonError(res, status, message) {
    return res.status(status).json({ message })
}

function serverError(res, error, label) {
    console.error(`❌ Ошибка админ-управления (${label}):`, error)
    return res.status(500).json({ message: 'Ошибка сервера' })
}

function mapUserRow(row) {
    return {
        id: toInteger(row.id),
        email: row.email,
        name: row.name,
        username: row.username,
        phone: row.phone,
        role: row.role,
        privilegeLevel: row.privilege_level,
        createdAt: row.created_at,
        plants: toInteger(row.plants),
        activePlants: toInteger(row.active_plants),
        waterings: toInteger(row.waterings),
        photos: toInteger(row.photos),
        chatMessages: toInteger(row.chat_messages),
        pushSubscriptions: toInteger(row.push_subscriptions),
        lastActivityAt: row.last_activity_at
    }
}

function mapPlantRow(row) {
    return {
        id: toInteger(row.id),
        name: row.name,
        species: row.species,
        location: row.location,
        isActive: Boolean(row.is_active),
        wateringIntervalDays: row.watering_interval_days,
        createdAt: row.created_at,
        lastWateredAt: row.last_watered_at,
        nextWateringAt: row.next_watering_at,
        waterings: toInteger(row.waterings),
        photos: toInteger(row.photos),
        mainPhotoUrl: row.main_url || null,
        user: {
            id: toInteger(row.user_id),
            email: row.user_email,
            username: row.user_username,
            name: row.user_name
        }
    }
}

function mapWateringRow(row) {
    return {
        id: toInteger(row.id),
        plantId: toInteger(row.plant_id),
        plantName: row.plant_name,
        userId: toInteger(row.user_id),
        userEmail: row.user_email,
        userUsername: row.user_username,
        action: row.action,
        actionAt: row.action_at,
        scheduledFor: row.scheduled_for,
        hoursLate: row.hours_late,
        note: row.note,
        createdAt: row.created_at
    }
}

function mapPhotoRow(row) {
    return {
        id: toInteger(row.id),
        plantId: toInteger(row.plant_id),
        plantName: row.plant_name,
        userId: toInteger(row.user_id),
        userEmail: row.user_email,
        userUsername: row.user_username,
        url: row.url,
        isMain: Boolean(row.is_main),
        sortOrder: toInteger(row.sort_order),
        createdAt: row.created_at
    }
}

function mapChatRow(row) {
    return {
        id: toInteger(row.id),
        userId: row.user_id === null ? null : toInteger(row.user_id),
        userEmail: row.user_email,
        userUsername: row.user_username,
        sessionId: row.session_id,
        role: row.role,
        text: row.text,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        error: row.error,
        createdAt: row.created_at
    }
}

class AdminManageController {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.db = deps.db || sequelize
        this.select = deps.select || select
        this.hasSiteVisitDays = deps.hasSiteVisitDays || hasSiteVisitDays
        this.removePlantPhotoFiles = deps.removePlantPhotoFiles || removePlantPhotoFiles
        this.removeChatPhotoFiles = deps.removeChatPhotoFiles || removeChatPhotoFiles
        this.collectChatPhotoUrls = deps.collectChatPhotoUrls || collectChatPhotoUrls
        this.recordAudit = deps.recordAdminAction || recordAdminAction

        for (const name of Object.getOwnPropertyNames(AdminManageController.prototype)) {
            if (name !== 'constructor' && typeof this[name] === 'function') {
                this[name] = this[name].bind(this)
            }
        }
    }

    async listUsers(req, res) {
        const search = parseSearch(req.query.search)
        const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 })
        if (search === null || !pagination) {
            return jsonError(res, 400, 'Некорректные параметры списка пользователей')
        }

        const sortKey = parseSort(req.query.sort, Object.keys(USER_SORT_COLUMNS), 'created')
        const order = parseOrder(req.query.order, 'desc')

        try {
            const hasCreatedAt = await hasUsersCreatedAt()
            const createdExpr = userCreatedAtSql(hasCreatedAt)
            const sortColumn = sortKey === 'created' ? createdExpr : USER_SORT_COLUMNS[sortKey]

            const params = []
            let where = ''
            if (search) {
                params.push(likePattern(search))
                where = `WHERE (u.email ILIKE $${params.length}
                    OR u.name ILIKE $${params.length}
                    OR u.username ILIKE $${params.length})`
            }

            const limitIndex = params.length + 1
            const offsetIndex = params.length + 2

            const rows = await select(`
                SELECT u.id, u.email, u.name, u.username, u.phone, u.role, u.privilege_level,
                       ${createdExpr} AS created_at,
                       COALESCE(pl.plants, 0)::int AS plants,
                       COALESCE(pl.active_plants, 0)::int AS active_plants,
                       COALESCE(wl.waterings, 0)::int AS waterings,
                       COALESCE(ph.photos, 0)::int AS photos,
                       COALESCE(ch.chat_messages, 0)::int AS chat_messages,
                       COALESCE(ps.push_subscriptions, 0)::int AS push_subscriptions,
                       GREATEST(pl.last_at, wl.last_at, ch.last_at) AS last_activity_at
                FROM users u
                LEFT JOIN (
                    SELECT user_id, count(*)::int AS plants,
                           count(*) FILTER (WHERE is_active)::int AS active_plants,
                           max(created_at) AS last_at
                    FROM plants GROUP BY user_id
                ) pl ON pl.user_id = u.id
                LEFT JOIN (
                    SELECT user_id, count(*)::int AS waterings, max(action_at) AS last_at
                    FROM watering_logs GROUP BY user_id
                ) wl ON wl.user_id = u.id
                LEFT JOIN (
                    SELECT p.user_id, count(*)::int AS photos
                    FROM plant_photos ph JOIN plants p ON p.id = ph.plant_id
                    GROUP BY p.user_id
                ) ph ON ph.user_id = u.id
                LEFT JOIN (
                    SELECT user_id, count(*)::int AS chat_messages, max(created_at) AS last_at
                    FROM chat_logs WHERE user_id IS NOT NULL GROUP BY user_id
                ) ch ON ch.user_id = u.id
                LEFT JOIN (
                    SELECT user_id, count(*)::int AS push_subscriptions
                    FROM push_subscriptions WHERE user_id IS NOT NULL GROUP BY user_id
                ) ps ON ps.user_id = u.id
                ${where}
                ORDER BY ${sortColumn} ${order.toUpperCase()} NULLS LAST, u.id DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            `, [...params, pagination.limit, pagination.offset])

            const totalRow = await select(
                `SELECT count(*)::int AS total FROM users u ${where}`,
                params
            )

            return res.json(pagedResponse(
                rows.map(mapUserRow),
                toInteger(totalRow[0]?.total),
                pagination
            ))
        } catch (error) {
            return serverError(res, error, 'listUsers')
        }
    }

    async getUser(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор пользователя')

        try {
            const hasCreatedAt = await hasUsersCreatedAt()
            const createdExpr = userCreatedAtSql(hasCreatedAt)

            const userRow = await select(`
                SELECT u.id, u.email, u.name, u.username, u.phone, u.bio, u.role,
                       u.privilege_level, ${createdExpr} AS created_at
                FROM users u
                WHERE u.id = $1
            `, [id])

            if (!userRow.length) return jsonError(res, 404, 'Пользователь не найден')

            const [
                statsRow,
                plants,
                waterings,
                chat,
                sessions,
                passkeys,
                pushSubscriptions,
                legalConsents,
                cookieConsents
            ] = await Promise.all([
                select(`
                    SELECT
                        (SELECT count(*)::int FROM plants WHERE user_id = $1) AS plants,
                        (SELECT count(*)::int FROM plants WHERE user_id = $1 AND is_active) AS active_plants,
                        (SELECT count(*)::int FROM watering_logs WHERE user_id = $1) AS waterings,
                        (SELECT count(*)::int FROM watering_logs WHERE user_id = $1 AND action = 'skipped') AS skipped,
                        (SELECT count(*)::int FROM plant_photos ph JOIN plants p ON p.id = ph.plant_id
                            WHERE p.user_id = $1) AS photos,
                        (SELECT count(*)::int FROM chat_logs WHERE user_id = $1) AS chat_messages,
                        (SELECT count(DISTINCT session_id)::int FROM chat_logs WHERE user_id = $1) AS chat_sessions,
                        (SELECT count(*)::int FROM push_subscriptions WHERE user_id = $1) AS push_subscriptions,
                        (SELECT count(*)::int FROM passkeys WHERE user_id = $1) AS passkeys,
                        (SELECT count(*)::int FROM auth_sessions WHERE user_id = $1
                            AND revoked_at IS NULL AND expires_at > now()) AS active_sessions,
                        (SELECT max(action_at) FROM watering_logs WHERE user_id = $1) AS last_watering_at,
                        (SELECT max(created_at) FROM chat_logs WHERE user_id = $1) AS last_chat_at
                `, [id]),

                select(`
                    SELECT p.id, p.name, p.species, p.location, p.is_active, p.watering_interval_days,
                           p.created_at, p.last_watered_at, p.next_watering_at,
                           p.user_id, u.email AS user_email, u.username AS user_username,
                           u.name AS user_name,
                           COALESCE(wl.c, 0)::int AS waterings,
                           COALESCE(ph.c, 0)::int AS photos,
                           ph.main_url
                    FROM plants p
                    JOIN users u ON u.id = p.user_id
                    LEFT JOIN (
                        SELECT plant_id, count(*)::int AS c FROM watering_logs GROUP BY plant_id
                    ) wl ON wl.plant_id = p.id
                    LEFT JOIN (
                        SELECT plant_id, count(*)::int AS c,
                               (array_agg(url ORDER BY is_main DESC, sort_order ASC, id ASC))[1] AS main_url
                        FROM plant_photos GROUP BY plant_id
                    ) ph ON ph.plant_id = p.id
                    WHERE p.user_id = $1
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 50
                `, [id]),

                select(`
                    SELECT w.id, w.plant_id, p.name AS plant_name, w.user_id,
                           u.email AS user_email, u.username AS user_username,
                           w.action, w.action_at, w.scheduled_for, w.hours_late, w.note, w.created_at
                    FROM watering_logs w
                    JOIN plants p ON p.id = w.plant_id
                    JOIN users u ON u.id = w.user_id
                    WHERE w.user_id = $1
                    ORDER BY w.action_at DESC, w.id DESC
                    LIMIT 25
                `, [id]),

                select(`
                    SELECT c.id, c.user_id, u.email AS user_email, u.username AS user_username,
                           c.session_id, c.role, c.text, c.input_tokens, c.output_tokens, c.error,
                           c.created_at
                    FROM chat_logs c
                    LEFT JOIN users u ON u.id = c.user_id
                    WHERE c.user_id = $1
                    ORDER BY c.created_at DESC, c.id DESC
                    LIMIT 25
                `, [id]),

                select(`
                    SELECT id, token_type, created_at, expires_at, revoked_at
                    FROM auth_sessions
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT 10
                `, [id]),

                select(`
                    SELECT id, device_name, created_at, last_used_at
                    FROM passkeys
                    WHERE user_id = $1
                    ORDER BY id DESC
                `, [id]),

                select(`
                    SELECT id, user_agent, created_at
                    FROM push_subscriptions
                    WHERE user_id = $1
                    ORDER BY id DESC
                    LIMIT 10
                `, [id]),

                select(`
                    SELECT id, consent_type, is_accepted, document_version, accepted_at, source
                    FROM user_legal_consents
                    WHERE user_id = $1
                    ORDER BY accepted_at DESC NULLS LAST, id DESC
                    LIMIT 10
                `, [id]),

                select(`
                    SELECT id, consent_type, is_accepted, is_revoked, accepted_at, source, created_at
                    FROM user_cookie_consents
                    WHERE user_id = $1
                    ORDER BY created_at DESC, id DESC
                    LIMIT 10
                `, [id])
            ])

            const stats = statsRow[0] || {}
            const base = userRow[0]

            return res.json({
                user: {
                    id: toInteger(base.id),
                    email: base.email,
                    name: base.name,
                    username: base.username,
                    phone: base.phone,
                    bio: base.bio,
                    role: base.role,
                    privilegeLevel: base.privilege_level,
                    createdAt: base.created_at,
                    userCreatedAtTracked: hasCreatedAt
                },
                stats: {
                    plants: toInteger(stats.plants),
                    activePlants: toInteger(stats.active_plants),
                    waterings: toInteger(stats.waterings),
                    skippedWaterings: toInteger(stats.skipped),
                    photos: toInteger(stats.photos),
                    chatMessages: toInteger(stats.chat_messages),
                    chatSessions: toInteger(stats.chat_sessions),
                    pushSubscriptions: toInteger(stats.push_subscriptions),
                    passkeys: toInteger(stats.passkeys),
                    activeSessions: toInteger(stats.active_sessions),
                    lastWateringAt: stats.last_watering_at || null,
                    lastChatAt: stats.last_chat_at || null
                },
                plants: plants.map(mapPlantRow),
                waterings: waterings.map(mapWateringRow),
                chat: chat.map(mapChatRow),
                sessions,
                passkeys,
                pushSubscriptions,
                legalConsents,
                cookieConsents
            })
        } catch (error) {
            return serverError(res, error, 'getUser')
        }
    }

    async updateUser(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор пользователя')

        const { role, privilegeLevel, privilege_level: privilegeLevelSnake } = req.body || {}
        const nextPrivilege = privilegeLevel ?? privilegeLevelSnake

        if (role === undefined && nextPrivilege === undefined) {
            return jsonError(res, 400, 'Нет полей для обновления')
        }
        if (role !== undefined && !isValidRole(role)) {
            return jsonError(res, 400, 'Роль должна быть USER или ADMIN')
        }
        if (nextPrivilege !== undefined && !isValidPrivilegeLevel(nextPrivilege)) {
            return jsonError(res, 400, 'Некорректный уровень привилегий')
        }

        try {
            const user = await User.findByPk(id)
            if (!user) return jsonError(res, 404, 'Пользователь не найден')

            if (role !== undefined && user.id === req.user?.id && role !== user.role) {
                return jsonError(res, 400, 'Нельзя изменить собственную роль')
            }

            if (role === 'USER' && user.role === 'ADMIN') {
                const admins = await User.count({ where: { role: 'ADMIN' } })
                if (admins <= 1) {
                    return jsonError(res, 409, 'Нельзя снять права последнего администратора')
                }
            }

            const previousRole = user.role
            const previousPrivilege = user.privilege_level
            const updates = {}
            if (role !== undefined) updates.role = role
            if (nextPrivilege !== undefined) updates.privilege_level = nextPrivilege

            const roleChanged = updates.role !== undefined && updates.role !== previousRole
            const privilegeChanged = updates.privilege_level !== undefined &&
                updates.privilege_level !== previousPrivilege

            await user.update(updates)

            if (roleChanged) {
                await this.recordAudit(req, {
                    action: 'user.role_changed',
                    targetType: 'user',
                    targetId: id,
                    payload: { from: previousRole, to: user.role }
                })
            }
            if (privilegeChanged) {
                await this.recordAudit(req, {
                    action: 'user.privilege_changed',
                    targetType: 'user',
                    targetId: id,
                    payload: { from: previousPrivilege, to: user.privilege_level }
                })
            }

            return res.json({
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    username: user.username,
                    role: user.role,
                    privilegeLevel: user.privilege_level
                }
            })
        } catch (error) {
            return serverError(res, error, 'updateUser')
        }
    }

    async deleteUser(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор пользователя')
        if (id === req.user?.id) {
            return jsonError(res, 400, 'Нельзя удалить собственную учётную запись')
        }

        try {
            const {
                User: UserModel,
                Plant: PlantModel,
                PlantPhoto: PlantPhotoModel,
                WateringLog: WateringLogModel,
                ChatLog: ChatLogModel,
                PushSubscription: PushSubscriptionModel,
                PushBroadcastRecipient: PushBroadcastRecipientModel,
                Notification: NotificationModel,
                NotificationPreference: NotificationPreferenceModel,
                AuthSession: AuthSessionModel,
                Passkey: PasskeyModel,
                UserCookieConsent: UserCookieConsentModel,
                UserLegalConsent: UserLegalConsentModel
            } = this.models

            const user = await UserModel.findByPk(id)
            if (!user) return jsonError(res, 404, 'Пользователь не найден')

            if (user.role === 'ADMIN') {
                const admins = await UserModel.count({ where: { role: 'ADMIN' } })
                if (admins <= 1) {
                    return jsonError(res, 409, 'Нельзя удалить последнего администратора')
                }
            }

            const email = user.email
            const wasAdmin = user.role === 'ADMIN'
            const visitsTracked = await this.hasSiteVisitDays()
            const photoUrls = (await this.select(`
                SELECT ph.url
                FROM plant_photos ph
                JOIN plants p ON p.id = ph.plant_id
                WHERE p.user_id = $1
            `, [id])).map(row => row.url)

            const chatPhotoRows = await ChatLogModel.findAll({
                where: { user_id: id },
                attributes: ['metadata'],
                raw: true
            })
            const chatPhotoUrls = this.collectChatPhotoUrls(chatPhotoRows)

            const removed = await this.db.transaction(async transaction => {
                const plantRows = await PlantModel.findAll({
                    where: { user_id: id },
                    attributes: ['id'],
                    raw: true,
                    transaction
                })
                const plantIds = plantRows.map(row => row.id)

                const counts = {
                    plants: plantIds.length,
                    photos: await PlantPhotoModel.count({ where: { plant_id: plantIds }, transaction }),
                    waterings: await WateringLogModel.count({ where: { user_id: id }, transaction }),
                    chatMessages: await ChatLogModel.count({ where: { user_id: id }, transaction }),
                    pushSubscriptions: await PushSubscriptionModel.count({ where: { user_id: id }, transaction }),
                    notifications: await NotificationModel.count({ where: { user_id: id }, transaction }),
                    legalConsents: await UserLegalConsentModel.count({ where: { user_id: id }, transaction }),
                    cookieConsents: await UserCookieConsentModel.count({ where: { user_id: id }, transaction }),
                    sessions: await AuthSessionModel.count({ where: { user_id: id }, transaction }),
                    passkeys: await PasskeyModel.count({ where: { user_id: id }, transaction })
                }

                if (plantIds.length) {
                    await PlantPhotoModel.destroy({ where: { plant_id: plantIds }, transaction })
                    await WateringLogModel.destroy({ where: { plant_id: plantIds }, transaction })
                }
                await WateringLogModel.destroy({ where: { user_id: id }, transaction })
                await PlantModel.destroy({ where: { user_id: id }, transaction })
                await ChatLogModel.destroy({ where: { user_id: id }, transaction })
                await PushSubscriptionModel.destroy({ where: { user_id: id }, transaction })
                await PushBroadcastRecipientModel.destroy({ where: { user_id: id }, transaction })
                await NotificationModel.destroy({ where: { user_id: id }, transaction })
                await NotificationPreferenceModel.destroy({ where: { user_id: id }, transaction })
                await UserCookieConsentModel.destroy({ where: { user_id: id }, transaction })
                await UserLegalConsentModel.destroy({ where: { user_id: id }, transaction })
                await AuthSessionModel.destroy({ where: { user_id: id }, transaction })
                await PasskeyModel.destroy({ where: { user_id: id }, transaction })
                await this.db.query(
                    'UPDATE push_broadcasts SET created_by = NULL WHERE created_by = $1',
                    { bind: [id], transaction }
                )
                if (visitsTracked) {
                    await this.db.query(
                        'UPDATE site_visit_days SET user_id = NULL WHERE user_id = $1',
                        { bind: [id], transaction }
                    )
                }

                await user.destroy({ transaction })

                return counts
            })

            await this.recordAudit(req, {
                action: 'user.deleted',
                targetType: 'user',
                targetId: id,
                payload: { was_admin: wasAdmin }
            })

            const filesRemoved = await this.removePlantPhotoFiles(photoUrls)

            let chatPhotoFilesRemoved = 0
            try {
                chatPhotoFilesRemoved = await this.removeChatPhotoFiles(chatPhotoUrls)
            } catch (error) {
                console.warn('⚠️ Не удалось удалить фото чата удалённого пользователя:', error?.message || error)
            }

            return res.json({
                deleted: true,
                user: { id, email },
                removed: {
                    ...removed,
                    photoFiles: filesRemoved,
                    chatPhotoFiles: chatPhotoFilesRemoved
                }
            })
        } catch (error) {
            return serverError(res, error, 'deleteUser')
        }
    }

    async listPlants(req, res) {
        const search = parseSearch(req.query.search)
        const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 })
        const userId = parseOptionalId(req.query.user_id)
        if (search === null || !pagination || userId === null) {
            return jsonError(res, 400, 'Некорректные параметры списка растений')
        }

        const activeFilter = req.query.active
        if (activeFilter !== undefined && activeFilter !== '' &&
            activeFilter !== 'true' && activeFilter !== 'false') {
            return jsonError(res, 400, 'Параметр active должен быть true или false')
        }

        const sortKey = parseSort(req.query.sort, Object.keys(PLANT_SORT_COLUMNS), 'created')
        const order = parseOrder(req.query.order, 'desc')

        try {
            const conditions = []
            const params = []

            if (search) {
                params.push(likePattern(search))
                conditions.push(`(p.name ILIKE $${params.length}
                    OR p.species ILIKE $${params.length}
                    OR p.location ILIKE $${params.length}
                    OR u.email ILIKE $${params.length}
                    OR u.username ILIKE $${params.length})`)
            }
            if (userId !== undefined) {
                params.push(userId)
                conditions.push(`p.user_id = $${params.length}`)
            }
            if (activeFilter === 'true' || activeFilter === 'false') {
                conditions.push(`p.is_active = ${activeFilter === 'true'}`)
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
            const limitIndex = params.length + 1
            const offsetIndex = params.length + 2

            const rows = await select(`
                SELECT p.id, p.name, p.species, p.location, p.is_active, p.watering_interval_days,
                       p.created_at, p.last_watered_at, p.next_watering_at,
                       u.id AS user_id, u.email AS user_email, u.username AS user_username,
                       u.name AS user_name,
                       COALESCE(wl.c, 0)::int AS waterings,
                       COALESCE(ph.c, 0)::int AS photos,
                       ph.main_url
                FROM plants p
                JOIN users u ON u.id = p.user_id
                LEFT JOIN (
                    SELECT plant_id, count(*)::int AS c FROM watering_logs GROUP BY plant_id
                ) wl ON wl.plant_id = p.id
                LEFT JOIN (
                    SELECT plant_id, count(*)::int AS c,
                           (array_agg(url ORDER BY is_main DESC, sort_order ASC, id ASC))[1] AS main_url
                    FROM plant_photos GROUP BY plant_id
                ) ph ON ph.plant_id = p.id
                ${where}
                ORDER BY ${PLANT_SORT_COLUMNS[sortKey]} ${order.toUpperCase()} NULLS LAST, p.id DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            `, [...params, pagination.limit, pagination.offset])

            const totalRows = await select(`
                SELECT count(*)::int AS total
                FROM plants p
                JOIN users u ON u.id = p.user_id
                ${where}
            `, params)

            return res.json(pagedResponse(
                rows.map(mapPlantRow),
                toInteger(totalRows[0]?.total),
                pagination
            ))
        } catch (error) {
            return serverError(res, error, 'listPlants')
        }
    }

    async deletePlant(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор растения')

        try {
            const plant = await Plant.findByPk(id)
            if (!plant) return jsonError(res, 404, 'Растение не найдено')

            const photoUrls = (await PlantPhoto.findAll({
                where: { plant_id: id },
                attributes: ['url'],
                raw: true
            })).map(row => row.url)

            const removed = await sequelize.transaction(async transaction => {
                const photos = await PlantPhoto.destroy({ where: { plant_id: id }, transaction })
                const waterings = await WateringLog.destroy({ where: { plant_id: id }, transaction })
                await plant.destroy({ transaction })
                return { photos, waterings }
            })

            await this.recordAudit(req, {
                action: 'plant.deleted',
                targetType: 'plant',
                targetId: id,
                payload: { photos: removed.photos, waterings: removed.waterings }
            })

            const filesRemoved = await removePlantPhotoFiles(photoUrls)

            return res.json({
                deleted: true,
                plant: { id, name: plant.name, userId: plant.user_id },
                removed: { ...removed, photoFiles: filesRemoved }
            })
        } catch (error) {
            return serverError(res, error, 'deletePlant')
        }
    }

    async listWaterings(req, res) {
        const search = parseSearch(req.query.search)
        const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 })
        const userId = parseOptionalId(req.query.user_id)
        const plantId = parseOptionalId(req.query.plant_id)
        const from = parseDay(req.query.from)
        const to = parseDay(req.query.to)

        if (search === null || !pagination || userId === null || plantId === null ||
            from === null || to === null) {
            return jsonError(res, 400, 'Некорректные параметры списка поливов')
        }

        const action = req.query.action
        if (action !== undefined && action !== '' && !WATERING_ACTIONS.includes(action)) {
            return jsonError(res, 400, 'Действие должно быть watered или skipped')
        }

        const sortKey = parseSort(req.query.sort, Object.keys(WATERING_SORT_COLUMNS), 'action_at')
        const order = parseOrder(req.query.order, 'desc')

        try {
            const conditions = []
            const params = []

            if (search) {
                params.push(likePattern(search))
                conditions.push(`(p.name ILIKE $${params.length}
                    OR u.email ILIKE $${params.length}
                    OR u.username ILIKE $${params.length})`)
            }
            if (userId !== undefined) {
                params.push(userId)
                conditions.push(`w.user_id = $${params.length}`)
            }
            if (plantId !== undefined) {
                params.push(plantId)
                conditions.push(`w.plant_id = $${params.length}`)
            }
            if (action === 'watered' || action === 'skipped') {
                params.push(action)
                conditions.push(`w.action = $${params.length}`)
            }
            if (from) {
                params.push(from)
                conditions.push(`${dayOf('w.action_at')} >= $${params.length}::date`)
            }
            if (to) {
                params.push(to)
                conditions.push(`${dayOf('w.action_at')} <= $${params.length}::date`)
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
            const limitIndex = params.length + 1
            const offsetIndex = params.length + 2

            const rows = await select(`
                SELECT w.id, w.plant_id, p.name AS plant_name, w.user_id,
                       u.email AS user_email, u.username AS user_username,
                       w.action, w.action_at, w.scheduled_for, w.hours_late, w.note, w.created_at
                FROM watering_logs w
                JOIN plants p ON p.id = w.plant_id
                JOIN users u ON u.id = w.user_id
                ${where}
                ORDER BY ${WATERING_SORT_COLUMNS[sortKey]} ${order.toUpperCase()}, w.id DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            `, [...params, pagination.limit, pagination.offset])

            const totalRows = await select(`
                SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE w.action = 'watered')::int AS watered,
                       count(*) FILTER (WHERE w.action = 'skipped')::int AS skipped
                FROM watering_logs w
                JOIN plants p ON p.id = w.plant_id
                JOIN users u ON u.id = w.user_id
                ${where}
            `, params)

            const totals = totalRows[0] || {}

            return res.json({
                ...pagedResponse(rows.map(mapWateringRow), toInteger(totals.total), pagination),
                summary: {
                    watered: toInteger(totals.watered),
                    skipped: toInteger(totals.skipped)
                }
            })
        } catch (error) {
            return serverError(res, error, 'listWaterings')
        }
    }

    async deleteWatering(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор записи о поливе')

        try {
            const log = await WateringLog.findByPk(id)
            if (!log) return jsonError(res, 404, 'Запись о поливе не найдена')

            const result = await sequelize.transaction(async transaction => {
                const plant = await Plant.findByPk(log.plant_id, {
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })

                const latest = await WateringLog.findOne({
                    where: { plant_id: log.plant_id },
                    order: [['action_at', 'DESC'], ['id', 'DESC']],
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })
                const isLatestAction = latest?.id === log.id
                const originalAction = log.action
                const restoredSkip = isLatestAction ? log.metadata?.converted_from_skip : null

                if (restoredSkip) {
                    await log.update({
                        action: 'skipped',
                        action_at: restoredSkip.action_at,
                        scheduled_for: restoredSkip.scheduled_for,
                        hours_late: restoredSkip.hours_late,
                        note: restoredSkip.note,
                        metadata: { ...(log.metadata || {}), converted_from_skip: null }
                    }, { transaction })
                } else {
                    await log.destroy({ transaction })
                }

                let scheduleRestored = false
                let restoredNextWateringAt = null
                if (plant) {
                    const lastWatering = await WateringLog.findOne({
                        where: { plant_id: log.plant_id, action: 'watered' },
                        order: [['action_at', 'DESC'], ['id', 'DESC']],
                        transaction,
                        lock: transaction.LOCK.UPDATE
                    })

                    const updates = {
                        last_watered_at: lastWatering?.action_at ?? null
                    }
                    if (isLatestAction) {
                        const hasPrevPlan = Boolean(log.metadata) &&
                            Object.hasOwn(log.metadata, 'prev_next_watering_at')
                        if (hasPrevPlan) {
                            updates.next_watering_at = log.metadata.prev_next_watering_at
                        } else if (originalAction === 'watered' || log.scheduled_for) {
                            updates.next_watering_at = log.scheduled_for ?? log.action_at
                        }
                        restoredNextWateringAt = updates.next_watering_at ?? null
                        scheduleRestored = true
                    }
                    await plant.update(updates, { transaction })
                }

                return {
                    isLatestAction,
                    scheduleRestored,
                    restoredSkip: Boolean(restoredSkip),
                    plantId: log.plant_id,
                    plantName: plant?.name ?? null,
                    ownerId: plant?.user_id ?? log.user_id,
                    action: originalAction,
                    nextWateringAt: (isLatestAction ? restoredNextWateringAt : null) ?? plant?.next_watering_at ?? null
                }
            })

            await this.recordAudit(req, {
                action: 'watering.deleted',
                targetType: 'watering',
                targetId: id,
                payload: {
                    plant_id: result.plantId,
                    action: result.action,
                    restored_skip: result.restoredSkip,
                    schedule_restored: result.scheduleRestored
                }
            })

            return res.json({ deleted: true, ...result })
        } catch (error) {
            return serverError(res, error, 'deleteWatering')
        }
    }

    async listPhotos(req, res) {
        const search = parseSearch(req.query.search)
        const pagination = parsePagination(req.query, { defaultLimit: 24, maxLimit: 100 })
        const userId = parseOptionalId(req.query.user_id)
        const plantId = parseOptionalId(req.query.plant_id)
        if (search === null || !pagination || userId === null || plantId === null) {
            return jsonError(res, 400, 'Некорректные параметры списка фотографий')
        }

        const sortKey = parseSort(req.query.sort, Object.keys(PHOTO_SORT_COLUMNS), 'created')
        const order = parseOrder(req.query.order, 'desc')

        try {
            const conditions = []
            const params = []

            if (search) {
                params.push(likePattern(search))
                conditions.push(`(p.name ILIKE $${params.length}
                    OR u.email ILIKE $${params.length}
                    OR u.username ILIKE $${params.length})`)
            }
            if (userId !== undefined) {
                params.push(userId)
                conditions.push(`p.user_id = $${params.length}`)
            }
            if (plantId !== undefined) {
                params.push(plantId)
                conditions.push(`ph.plant_id = $${params.length}`)
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
            const limitIndex = params.length + 1
            const offsetIndex = params.length + 2

            const rows = await select(`
                SELECT ph.id, ph.plant_id, p.name AS plant_name, p.user_id,
                       u.email AS user_email, u.username AS user_username,
                       ph.url, ph.is_main, ph.sort_order, ph.created_at
                FROM plant_photos ph
                JOIN plants p ON p.id = ph.plant_id
                JOIN users u ON u.id = p.user_id
                ${where}
                ORDER BY ${PHOTO_SORT_COLUMNS[sortKey]} ${order.toUpperCase()}, ph.id DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            `, [...params, pagination.limit, pagination.offset])

            const totalRows = await select(`
                SELECT count(*)::int AS total
                FROM plant_photos ph
                JOIN plants p ON p.id = ph.plant_id
                JOIN users u ON u.id = p.user_id
                ${where}
            `, params)

            return res.json(pagedResponse(
                rows.map(mapPhotoRow),
                toInteger(totalRows[0]?.total),
                pagination
            ))
        } catch (error) {
            return serverError(res, error, 'listPhotos')
        }
    }

    async deletePhoto(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор фотографии')

        try {
            const photo = await PlantPhoto.findByPk(id)
            if (!photo) return jsonError(res, 404, 'Фотография не найдена')

            const { url, plant_id: plantId, is_main: wasMain } = photo
            await photo.destroy()

            let promotedPhotoId = null
            if (wasMain) {
                const next = await PlantPhoto.findOne({
                    where: { plant_id: plantId },
                    order: [['sort_order', 'ASC'], ['id', 'ASC']]
                })
                if (next) {
                    await next.update({ is_main: true, sort_order: 0 })
                    promotedPhotoId = next.id
                }
            }

            const filesRemoved = await removePlantPhotoFiles(url)

            await this.recordAudit(req, {
                action: 'photo.deleted',
                targetType: 'photo',
                targetId: id,
                payload: {
                    plant_id: plantId,
                    was_main: wasMain,
                    promoted_photo_id: promotedPhotoId,
                    files_removed: filesRemoved
                }
            })

            return res.json({
                deleted: true,
                photo: { id, plantId, url },
                promotedPhotoId,
                filesRemoved
            })
        } catch (error) {
            return serverError(res, error, 'deletePhoto')
        }
    }

    async listChat(req, res) {
        const search = parseSearch(req.query.search)
        const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 })
        const userId = parseOptionalId(req.query.user_id)
        if (search === null || !pagination || userId === null) {
            return jsonError(res, 400, 'Некорректные параметры списка сообщений')
        }

        const role = req.query.role
        if (role !== undefined && role !== '' && !CHAT_ROLES.includes(role)) {
            return jsonError(res, 400, 'Некорректная роль сообщения')
        }

        const sortKey = parseSort(req.query.sort, Object.keys(CHAT_SORT_COLUMNS), 'created')
        const order = parseOrder(req.query.order, 'desc')

        try {
            const conditions = []
            const params = []

            if (search) {
                params.push(likePattern(search))
                conditions.push(`(c.text ILIKE $${params.length}
                    OR u.email ILIKE $${params.length}
                    OR u.username ILIKE $${params.length})`)
            }
            if (userId !== undefined) {
                params.push(userId)
                conditions.push(`c.user_id = $${params.length}`)
            }
            if (CHAT_ROLES.includes(role)) {
                params.push(role)
                conditions.push(`c.role = $${params.length}`)
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
            const limitIndex = params.length + 1
            const offsetIndex = params.length + 2

            const rows = await select(`
                SELECT c.id, c.user_id, u.email AS user_email, u.username AS user_username,
                       c.session_id, c.role, c.text, c.input_tokens, c.output_tokens, c.error,
                       c.created_at
                FROM chat_logs c
                LEFT JOIN users u ON u.id = c.user_id
                ${where}
                ORDER BY ${CHAT_SORT_COLUMNS[sortKey]} ${order.toUpperCase()}, c.id DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            `, [...params, pagination.limit, pagination.offset])

            const totalRows = await select(`
                SELECT count(*)::int AS total
                FROM chat_logs c
                LEFT JOIN users u ON u.id = c.user_id
                ${where}
            `, params)

            return res.json(pagedResponse(
                rows.map(mapChatRow),
                toInteger(totalRows[0]?.total),
                pagination
            ))
        } catch (error) {
            return serverError(res, error, 'listChat')
        }
    }

    async deleteChat(req, res) {
        const id = parseIdParam(req.params.id)
        if (!id) return jsonError(res, 400, 'Некорректный идентификатор сообщения')

        try {
            const message = await this.models.ChatLog.findByPk(id)
            if (!message) return jsonError(res, 404, 'Сообщение не найдено')

            const chatPhotoUrls = this.collectChatPhotoUrls([message])

            await message.destroy()

            await this.recordAudit(req, {
                action: 'chat.deleted',
                targetType: 'chat',
                targetId: id,
                payload: { session_id: message.session_id, role: message.role }
            })

            let chatPhotoFilesRemoved = 0
            try {
                chatPhotoFilesRemoved = await this.removeChatPhotoFiles(chatPhotoUrls)
            } catch (error) {
                console.warn(`⚠️ Не удалось удалить фото чата сообщения ${id}:`, error?.message || error)
            }

            return res.json({ deleted: true, message: { id }, chatPhotoFiles: chatPhotoFilesRemoved })
        } catch (error) {
            return serverError(res, error, 'deleteChat')
        }
    }

    async deleteChatSession(req, res) {
        const sessionId = req.params.sessionId
        if (typeof sessionId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
            return jsonError(res, 400, 'Некорректный идентификатор переписки')
        }

        try {
            const { ChatLog: ChatLogModel } = this.models

            const chatPhotoRows = await ChatLogModel.findAll({
                where: { session_id: sessionId },
                attributes: ['metadata'],
                raw: true
            })
            const chatPhotoUrls = this.collectChatPhotoUrls(chatPhotoRows)

            const deleted = await ChatLogModel.destroy({ where: { session_id: sessionId } })

            if (deleted > 0) {
                await this.recordAudit(req, {
                    action: 'chat.session_deleted',
                    targetType: 'chat_session',
                    targetId: sessionId,
                    payload: { removed: deleted }
                })
            }

            let chatPhotoFilesRemoved = 0
            try {
                chatPhotoFilesRemoved = await this.removeChatPhotoFiles(chatPhotoUrls)
            } catch (error) {
                console.warn(`⚠️ Не удалось удалить фото чата переписки ${sessionId}:`, error?.message || error)
            }

            return res.json({
                deleted: true,
                sessionId,
                removed: deleted,
                chatPhotoFiles: chatPhotoFilesRemoved
            })
        } catch (error) {
            return serverError(res, error, 'deleteChatSession')
        }
    }

    async listAudit(req, res) {
        const rawLimit = req.query.limit
        const rawOffset = req.query.offset
        const rawAction = req.query.action
        const rawAdminId = req.query.adminId ?? req.query.admin_id

        let limit = DEFAULT_AUDIT_LIMIT
        if (rawLimit !== undefined && rawLimit !== '') {
            if (typeof rawLimit !== 'string' || !/^\d{1,3}$/.test(rawLimit)) {
                return jsonError(res, 400, `limit должен быть целым числом от 1 до ${MAX_AUDIT_LIMIT}`)
            }
            limit = Number(rawLimit)
            if (limit < 1 || limit > MAX_AUDIT_LIMIT) {
                return jsonError(res, 400, `limit должен быть целым числом от 1 до ${MAX_AUDIT_LIMIT}`)
            }
        }

        let offset = 0
        if (rawOffset !== undefined && rawOffset !== '') {
            if (typeof rawOffset !== 'string' || !/^\d{1,9}$/.test(rawOffset)) {
                return jsonError(res, 400, 'offset должен быть неотрицательным целым числом')
            }
            offset = Number(rawOffset)
        }

        let action
        if (rawAction !== undefined && rawAction !== '') {
            if (typeof rawAction !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(rawAction)) {
                return jsonError(res, 400, 'Некорректный фильтр по действию')
            }
            action = rawAction
        }

        const adminId = parseOptionalId(rawAdminId)
        if (adminId === null) {
            return jsonError(res, 400, 'Некорректный идентификатор администратора')
        }

        try {
            return res.json(await listAdminActions({ limit, offset, action, adminId }))
        } catch (error) {
            return serverError(res, error, 'listAudit')
        }
    }
}

export { AdminManageController }
export default new AdminManageController()
