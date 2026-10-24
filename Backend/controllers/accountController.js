import bcrypt from 'bcrypt'
import sequelize from '../db.js'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import PlantCarePlan from '../models/PlantCarePlan.js'
import WateringLog from '../models/WateringLog.js'
import ChatLog from '../models/ChatLog.js'
import AiAdviceLog from '../models/AiAdviceLog.js'
import Notification from '../models/Notification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import PushSubscription from '../models/PushSubscription.js'
import PushBroadcastRecipient from '../models/PushBroadcastRecipient.js'
import MailBroadcastRecipient from '../models/MailBroadcastRecipient.js'
import AuthSession from '../models/AuthSession.js'
import Passkey from '../models/Passkey.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import UserCookieConsent from '../models/userCookieConsentModels.js'
import UserLegalConsent from '../models/userLegalConsentModels.js'
import SiteVisit from '../models/SiteVisit.js'
import { removePlantPhotoFiles } from '../utils/plantPhotoCleanup.js'
import { collectChatPhotoUrls, removeChatPhotoFiles } from '../utils/chatPhoto.js'
import { clearAuthCookies } from '../utils/authTokens.js'

export const DELETION_CONFIRMATION = 'УДАЛИТЬ'
export const ACCOUNT_EXPORT_FORMAT = 'webplant-account-export'
export const ACCOUNT_EXPORT_FORMAT_VERSION = 1

const DEFAULT_MODELS = {
    User,
    Plant,
    PlantPhoto,
    PlantCarePlan,
    WateringLog,
    ChatLog,
    AiAdviceLog,
    Notification,
    NotificationPreference,
    PushSubscription,
    PushBroadcastRecipient,
    MailBroadcastRecipient,
    AuthSession,
    Passkey,
    PasskeyChallenge,
    PasswordResetToken,
    UserCookieConsent,
    UserLegalConsent,
    SiteVisit
}


export function sanitizeUser(user) {
    if (!user) return null
    return {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        username: user.username ?? null,
        phone: user.phone ?? null,
        bio: user.bio ?? null,
        role: user.role ?? null,
        privilegeLevel: user.privilege_level ?? null,
        timezone: user.timezone ?? null
    }
}

export function sanitizePasskey(passkey) {
    if (!passkey) return null
    return {
        deviceName: passkey.device_name ?? null,
        createdAt: passkey.created_at ?? null,
        lastUsedAt: passkey.last_used_at ?? null,
        transports: Array.isArray(passkey.transports) ? passkey.transports : []
    }
}

export function pushEndpointHost(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint) return null
    try {
        return new URL(endpoint).host || null
    } catch {
        return null
    }
}

export function sanitizePushSubscription(subscription) {
    if (!subscription) return null
    return {
        service: pushEndpointHost(subscription.endpoint),
        createdAt: subscription.created_at ?? null,
        lastSuccessAt: subscription.last_success_at ?? null,
        invalidatedAt: subscription.invalidated_at ?? null
    }
}

export function sanitizeChatMessage(message) {
    if (!message) return null
    return {
        id: message.id,
        sessionId: message.session_id ?? null,
        role: message.role ?? null,
        text: message.text ?? '',
        createdAt: message.created_at ?? null
    }
}

export function sanitizeNotification(notification) {
    if (!notification) return null
    return {
        id: notification.id,
        type: notification.type ?? null,
        title: notification.title ?? null,
        body: notification.body ?? null,
        createdAt: notification.created_at ?? null,
        readAt: notification.read_at ?? null
    }
}

export function collectPhotoUrls(photos) {
    const urls = []
    for (const photo of Array.isArray(photos) ? photos : []) {
        if (typeof photo?.url === 'string' && photo.url && !urls.includes(photo.url)) {
            urls.push(photo.url)
        }
    }
    return urls
}

export function buildAccountExport({
    exportedAt,
    user,
    plants = [],
    photos = [],
    carePlans = [],
    wateringLogs = [],
    chatMessages = [],
    aiAdvice = [],
    notifications = [],
    notificationPreferences = null,
    pushSubscriptions = [],
    cookieConsents = [],
    legalConsents = [],
    passkeys = [],
    authSessionsCount = 0,
    siteVisits = []
}) {
    const photosByPlant = new Map()
    for (const photo of photos) {
        const key = Number(photo.plant_id)
        if (!photosByPlant.has(key)) photosByPlant.set(key, [])
        photosByPlant.get(key).push({
            url: photo.url ?? null,
            thumbnailUrl: photo.thumb_url ?? null,
            isMain: Boolean(photo.is_main),
            width: photo.width ?? null,
            height: photo.height ?? null,
            createdAt: photo.created_at ?? null
        })
    }
    const carePlanByPlant = new Map()
    for (const plan of carePlans) {
        carePlanByPlant.set(Number(plan.plant_id), plan.plan ?? null)
    }

    return {
        format: ACCOUNT_EXPORT_FORMAT,
        formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
        exportedAt,
        account: sanitizeUser(user),
        plants: plants.map(plant => ({
            id: plant.id,
            name: plant.name ?? null,
            species: plant.species ?? null,
            location: plant.location ?? null,
            description: plant.description ?? null,
            wateringIntervalDays: plant.watering_interval_days ?? null,
            wateringTimeOfDay: plant.watering_time_of_day ?? null,
            lastWateredAt: plant.last_watered_at ?? null,
            nextWateringAt: plant.next_watering_at ?? null,
            isActive: Boolean(plant.is_active),
            reminderWeekdays: plant.reminder_weekdays ?? [],
            metadata: plant.metadata ?? {},
            carePlan: carePlanByPlant.get(Number(plant.id)) ?? null,
            photos: photosByPlant.get(Number(plant.id)) ?? []
        })),
        wateringLogs: wateringLogs.map(log => {
            const hoursLate = Number.isFinite(Number(log.hours_late))
                ? Number(log.hours_late)
                : null
            return {
                id: log.id,
                plantId: log.plant_id ?? null,
                action: log.action ?? null,
                wateredAt: log.action_at ?? null,
                scheduledFor: log.scheduled_for ?? null,
                hoursLate,
                daysLate: hoursLate === null ? null : Math.floor(hoursLate / 24),
                comment: log.note ?? null,
                metadata: log.metadata ?? {}
            }
        }),
        chatMessages: chatMessages.map(sanitizeChatMessage),
        aiAdvice: aiAdvice.map(log => ({
            id: log.id,
            kind: log.kind ?? null,
            plantName: log.plant_name ?? null,
            species: log.species ?? null,
            intervalDays: log.interval_days ?? null,
            timeOfDay: log.time_of_day ?? null,
            createdAt: log.created_at ?? null
        })),
        notifications: notifications.map(sanitizeNotification),
        notificationPreferences: notificationPreferences
            ? {
                morningSummaryEnabled: notificationPreferences.morning_summary_enabled ?? null,
                careAdviceEnabled: notificationPreferences.care_advice_enabled ?? null,
                darkThemeEnabled: notificationPreferences.dark_theme_enabled ?? null,
                themeMode: notificationPreferences.theme_mode ?? null
            }
            : null,
        pushSubscriptions: pushSubscriptions.map(sanitizePushSubscription),
        consents: {
            cookie: cookieConsents.map(consent => ({
                type: consent.consent_type ?? null,
                accepted: Boolean(consent.is_accepted),
                version: consent.version ?? null,
                acceptedAt: consent.accepted_at ?? null,
                revoked: Boolean(consent.is_revoked),
                revokedAt: consent.revoked_at ?? null,
                source: consent.source ?? null
            })),
            legal: legalConsents.map(consent => ({
                type: consent.consent_type ?? null,
                accepted: Boolean(consent.is_accepted),
                documentVersion: consent.document_version ?? null,
                acceptedAt: consent.accepted_at ?? null,
                revokedAt: consent.revoked_at ?? null,
                source: consent.source ?? null
            }))
        },
        passkeys: passkeys.map(sanitizePasskey),
        sessions: { authSessions: Number(authSessionsCount) || 0 },
        siteVisits: siteVisits.map(visit => ({
            day: visit.day ?? null,
            views: visit.views ?? null,
            firstPath: visit.first_path ?? null,
            referrerHost: visit.referrer_host ?? null,
            device: visit.device ?? null
        }))
    }
}


export class AccountController {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.db = deps.db || sequelize
        this.comparePassword = deps.comparePassword || bcrypt.compare
        this.removePlantPhotoFiles = deps.removePlantPhotoFiles || removePlantPhotoFiles
        this.removeChatPhotoFiles = deps.removeChatPhotoFiles || removeChatPhotoFiles
        this.clearAuthCookies = deps.clearAuthCookies || clearAuthCookies
        this.exportData = this.exportData.bind(this)
    }

    async exportData(req, res) {
        const userId = req.user?.id
        if (!Number.isInteger(userId)) {
            return res.status(401).json({ message: 'Не авторизован' })
        }

        try {
            const payload = await this.collectExportData(userId)
            if (!payload) return res.status(404).json({ message: 'Пользователь не найден' })

            const filename = `lejka-account-${userId}-${payload.exportedAt.slice(0, 10)}.json`
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('X-Content-Type-Options', 'nosniff')
            return res.json(payload)
        } catch (error) {
            console.error('❌ Ошибка экспорта данных пользователя:', error?.message || error)
            return res.status(500).json({ message: 'Не удалось подготовить экспорт данных' })
        }
    }

    async collectExportData(userId) {
        const {
            User: UserModel,
            Plant: PlantModel,
            PlantPhoto: PlantPhotoModel,
            PlantCarePlan: PlantCarePlanModel,
            WateringLog: WateringLogModel,
            ChatLog: ChatLogModel,
            AiAdviceLog: AiAdviceLogModel,
            Notification: NotificationModel,
            NotificationPreference: NotificationPreferenceModel,
            PushSubscription: PushSubscriptionModel,
            UserCookieConsent: UserCookieConsentModel,
            UserLegalConsent: UserLegalConsentModel,
            Passkey: PasskeyModel,
            AuthSession: AuthSessionModel,
            SiteVisit: SiteVisitModel
        } = this.models

        const user = await UserModel.findByPk(userId)
        if (!user) return null

        const [plants, wateringLogs, chatMessages, aiAdvice, notifications, notificationPreferences,
            pushSubscriptions, cookieConsents, legalConsents, passkeys, authSessionsCount, siteVisits] =
            await Promise.all([
                PlantModel.findAll({ where: { user_id: userId }, raw: true }),
                WateringLogModel.findAll({ where: { user_id: userId }, raw: true }),
                ChatLogModel.findAll({ where: { user_id: userId }, raw: true }),
                AiAdviceLogModel.findAll({ where: { user_id: userId }, raw: true }),
                NotificationModel.findAll({ where: { user_id: userId }, raw: true }),
                NotificationPreferenceModel.findOne({ where: { user_id: userId }, raw: true }),
                PushSubscriptionModel.findAll({ where: { user_id: userId }, raw: true }),
                UserCookieConsentModel.findAll({ where: { user_id: userId }, raw: true }),
                UserLegalConsentModel.findAll({ where: { user_id: userId }, raw: true }),
                PasskeyModel.findAll({ where: { user_id: userId }, raw: true }),
                AuthSessionModel.count({ where: { user_id: userId } }),
                SiteVisitModel.findAll({ where: { user_id: userId }, raw: true })
            ])

        const plantIds = plants.map(plant => plant.id)
        const [photos, carePlans] = plantIds.length
            ? await Promise.all([
                PlantPhotoModel.findAll({ where: { plant_id: plantIds }, raw: true }),
                PlantCarePlanModel.findAll({ where: { plant_id: plantIds }, raw: true })
            ])
            : [[], []]

        return buildAccountExport({
            exportedAt: new Date().toISOString(),
            user,
            plants,
            photos,
            carePlans,
            wateringLogs,
            chatMessages,
            aiAdvice,
            notifications,
            notificationPreferences,
            pushSubscriptions,
            cookieConsents,
            legalConsents,
            passkeys,
            authSessionsCount,
            siteVisits
        })
    }

    async deleteMe(req, res) {
        const userId = req.user?.id
        if (!Number.isInteger(userId)) {
            return res.status(401).json({ message: 'Не авторизован' })
        }

        const { password, confirm } = req.body || {}

        if (confirm !== DELETION_CONFIRMATION) {
            return res.status(400).json({
                message: `Для удаления аккаунта введите слово ${DELETION_CONFIRMATION}`,
                requiresConfirmation: true
            })
        }
        if (typeof password !== 'string' || !password || password.length > 1024) {
            return res.status(400).json({
                message: 'Подтвердите удаление паролем от аккаунта',
                requiresPassword: true
            })
        }

        try {
            const user = await this.models.User.findByPk(userId)
            if (!user) return res.status(401).json({ message: 'Пользователь не найден' })

            if (user.role === 'ADMIN') {
                return res.status(409).json({
                    message: 'Аккаунт администратора удаляется через админ-панель'
                })
            }

            const passwordMatches = await this.comparePassword(password, user.password)
            if (!passwordMatches) {
                return res.status(403).json({ message: 'Неверный пароль' })
            }

            const [photoRows] = await this.db.query(
                `SELECT ph.url
                 FROM plant_photos ph
                 JOIN plants p ON p.id = ph.plant_id
                 WHERE p.user_id = $1`,
                { bind: [userId] }
            )
            const photoUrls = collectPhotoUrls(photoRows)

            const chatPhotoRows = await this.models.ChatLog.findAll({
                where: { user_id: userId },
                attributes: ['metadata'],
                raw: true
            })
            const chatPhotoUrls = collectChatPhotoUrls(chatPhotoRows)

            const removed = await this.db.transaction(async transaction => {
                const { User: UserModel, Plant: PlantModel, PlantPhoto: PlantPhotoModel,
                    WateringLog: WateringLogModel, ChatLog: ChatLogModel,
                    PushSubscription: PushSubscriptionModel,
                    PushBroadcastRecipient: PushBroadcastRecipientModel,
                    MailBroadcastRecipient: MailBroadcastRecipientModel,
                    Notification: NotificationModel,
                    NotificationPreference: NotificationPreferenceModel,
                    AuthSession: AuthSessionModel, Passkey: PasskeyModel,
                    PasskeyChallenge: PasskeyChallengeModel,
                    PasswordResetToken: PasswordResetTokenModel,
                    UserCookieConsent: UserCookieConsentModel,
                    UserLegalConsent: UserLegalConsentModel,
                    AiAdviceLog: AiAdviceLogModel, SiteVisit: SiteVisitModel } = this.models

                const plantRows = await PlantModel.findAll({
                    where: { user_id: userId },
                    attributes: ['id'],
                    raw: true,
                    transaction
                })
                const plantIds = plantRows.map(row => row.id)

                const counts = {
                    plants: plantIds.length,
                    photos: plantIds.length
                        ? await PlantPhotoModel.count({ where: { plant_id: plantIds }, transaction })
                        : 0,
                    waterings: await WateringLogModel.count({ where: { user_id: userId }, transaction }),
                    chatMessages: await ChatLogModel.count({ where: { user_id: userId }, transaction }),
                    pushSubscriptions: await PushSubscriptionModel.count({ where: { user_id: userId }, transaction }),
                    notifications: await NotificationModel.count({ where: { user_id: userId }, transaction }),
                    legalConsents: await UserLegalConsentModel.count({ where: { user_id: userId }, transaction }),
                    cookieConsents: await UserCookieConsentModel.count({ where: { user_id: userId }, transaction }),
                    sessions: await AuthSessionModel.count({ where: { user_id: userId }, transaction }),
                    passkeys: await PasskeyModel.count({ where: { user_id: userId }, transaction })
                }

                if (plantIds.length) {
                    await PlantPhotoModel.destroy({ where: { plant_id: plantIds }, transaction })
                    await WateringLogModel.destroy({ where: { plant_id: plantIds }, transaction })
                }
                await WateringLogModel.destroy({ where: { user_id: userId }, transaction })
                await PlantModel.destroy({ where: { user_id: userId }, transaction })
                await ChatLogModel.destroy({ where: { user_id: userId }, transaction })
                await PushSubscriptionModel.destroy({ where: { user_id: userId }, transaction })
                await PushBroadcastRecipientModel.destroy({ where: { user_id: userId }, transaction })
                await MailBroadcastRecipientModel.destroy({ where: { user_id: userId }, transaction })
                await NotificationModel.destroy({ where: { user_id: userId }, transaction })
                await NotificationPreferenceModel.destroy({ where: { user_id: userId }, transaction })
                await UserCookieConsentModel.destroy({ where: { user_id: userId }, transaction })
                await UserLegalConsentModel.destroy({ where: { user_id: userId }, transaction })
                await AuthSessionModel.destroy({ where: { user_id: userId }, transaction })
                await PasskeyModel.destroy({ where: { user_id: userId }, transaction })
                await PasskeyChallengeModel.destroy({ where: { user_id: userId }, transaction })
                await PasswordResetTokenModel.destroy({ where: { user_id: userId }, transaction })

                await AiAdviceLogModel.update({ user_id: null }, { where: { user_id: userId }, transaction })
                await SiteVisitModel.update({ user_id: null }, { where: { user_id: userId }, transaction })
                await this.db.query(
                    'UPDATE push_broadcasts SET created_by = NULL WHERE created_by = $1',
                    { bind: [userId], transaction }
                )
                await this.db.query(
                    'UPDATE mail_broadcasts SET created_by = NULL WHERE created_by = $1',
                    { bind: [userId], transaction }
                )

                await UserModel.destroy({ where: { id: userId }, transaction })
                return counts
            })

            const filesRemoved = await this.removePlantPhotoFiles(photoUrls)
            let chatPhotoFilesRemoved = 0
            try {
                chatPhotoFilesRemoved = await this.removeChatPhotoFiles(chatPhotoUrls)
            } catch (error) {
                console.warn('⚠️ Не удалось удалить фото чата:', error?.message || error)
            }
            this.clearAuthCookies(res)

            return res.json({
                deleted: true,
                removed: {
                    ...removed,
                    photoFiles: filesRemoved,
                    chatPhotoFiles: chatPhotoFilesRemoved
                }
            })
        } catch (error) {
            console.error('❌ Ошибка удаления аккаунта:', error?.message || error)
            return res.status(500).json({ message: 'Не удалось удалить аккаунт. Попробуйте позже или напишите в поддержку.' })
        }
    }
}

export default new AccountController()
