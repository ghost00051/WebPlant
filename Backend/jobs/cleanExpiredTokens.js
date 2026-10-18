import UserCookieConsent from "../models/userCookieConsentModels.js"
import AuthSession from '../models/AuthSession.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import PlantPhoto from '../models/PlantPhoto.js'
import ChatLog from '../models/ChatLog.js'
import AiAdviceLog from '../models/AiAdviceLog.js'
import SiteVisit from '../models/SiteVisit.js'
import Notification from '../models/Notification.js'
import PushSubscription from '../models/PushSubscription.js'
import { Op } from "sequelize"
import { cleanOrphanedPlantPhotoFiles } from '../utils/plantPhotoCleanup.js'
import { withDistributedLock } from '../utils/distributedLock.js'

const GUEST_DATA_RETENTION_MS = 180 * 24 * 60 * 60 * 1000
const VISIT_RETENTION_DAYS = 400
const NOTIFICATION_RETENTION_DAYS = 180
const CLEANUP_LOCK = 'job:cleanup-expired'
const CLEANUP_LOCK_TTL_MS = 30 * 60 * 1000

function readRetentionDays(value, fallback) {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function retentionCutoff(days) {
    if (!days) return null
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export async function cleanExpiredAuthData() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const guestDataCutoff = new Date(Date.now() - GUEST_DATA_RETENTION_MS)
    const visitCutoff = new Date(Date.now() - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    const chatLogCutoff = retentionCutoff(readRetentionDays(process.env.CHAT_LOG_RETENTION_DAYS, 365))
    const adviceLogCutoff = retentionCutoff(readRetentionDays(process.env.AI_ADVICE_LOG_RETENTION_DAYS, 365))
    const notificationCutoff = retentionCutoff(
        readRetentionDays(process.env.NOTIFICATION_RETENTION_DAYS, NOTIFICATION_RETENTION_DAYS)
    )

    const [
        deletedConsents,
        deletedGuestChatLogs,
        deletedUserChatLogs,
        deletedAdviceLogs,
        deletedSessions,
        deletedChallenges,
        deletedResetTokens,
        deletedPhotos,
        deletedVisits
    ] = await Promise.all([
        UserCookieConsent.destroy({
            where: {
                [Op.or]: [
                    { expires_at: { [Op.lt]: thirtyDaysAgo } },
                    { created_at: { [Op.lt]: guestDataCutoff } }
                ],
                user_id: null
            }
        }),
        ChatLog.destroy({
            where: {
                user_id: null,
                created_at: { [Op.lt]: guestDataCutoff }
            }
        }),
        chatLogCutoff
            ? ChatLog.destroy({
                where: {
                    user_id: { [Op.ne]: null },
                    created_at: { [Op.lt]: chatLogCutoff }
                }
            })
            : Promise.resolve(0),
        adviceLogCutoff
            ? AiAdviceLog.destroy({
                where: { created_at: { [Op.lt]: adviceLogCutoff } }
            })
            : Promise.resolve(0),
        AuthSession.destroy({
            where: {
                [Op.or]: [
                    { expires_at: { [Op.lt]: new Date() } },
                    { revoked_at: { [Op.lt]: thirtyDaysAgo } }
                ]
            }
        }),
        PasskeyChallenge.destroy({
            where: { expires_at: { [Op.lt]: new Date() } }
        }),
        PasswordResetToken.destroy({
            where: {
                [Op.or]: [
                    { expires_at: { [Op.lt]: thirtyDaysAgo } },
                    { used_at: { [Op.lt]: thirtyDaysAgo } }
                ]
            }
        }),
        PlantPhoto.findAll({ attributes: ['url'], raw: true })
            .then(rows => cleanOrphanedPlantPhotoFiles({
                referencedUrls: rows.map(row => row.url)
            })),
        SiteVisit.destroy({
            where: { day: { [Op.lt]: visitCutoff } }
        })
    ])

    const deletedNotifications = notificationCutoff
        ? await Notification.destroy({ where: { created_at: { [Op.lt]: notificationCutoff } } })
        : 0
    const deletedGuestSubscriptions = await PushSubscription.destroy({
        where: { user_id: null, created_at: { [Op.lt]: guestDataCutoff } }
    })

    const deleted =
        deletedConsents + deletedGuestChatLogs + deletedUserChatLogs + deletedAdviceLogs +
        deletedSessions + deletedChallenges + deletedResetTokens
    console.log(
        `🧹 Очищено гостевых согласий: ${deletedConsents}, гостевых сообщений: ${deletedGuestChatLogs}, ` +
        `сообщений пользователей: ${deletedUserChatLogs}, ` +
        `записей журнала ИИ: ${deletedAdviceLogs}, ` +
        `сессий: ${deletedSessions}, ` +
        `passkey-челленджей: ${deletedChallenges}, ссылок сброса пароля: ${deletedResetTokens}, ` +
        `фото-файлов: ${deletedPhotos}, ` +
        `дней статистики посещений: ${deletedVisits}`
    )
    console.log(
        `🧹 Уведомления: удалено ${deletedNotifications}, гостевых push-подписок: ${deletedGuestSubscriptions}`
    )
    return deleted
}

export function startCleanupJob() {
    const runCleanup = () => withDistributedLock(
        CLEANUP_LOCK,
        { ttlMs: CLEANUP_LOCK_TTL_MS },
        () => cleanExpiredAuthData()
    ).catch(error => {
        console.error('❌ Ошибка очистки:', error)
    })

    runCleanup()
    setInterval(runCleanup, 24 * 60 * 60 * 1000)
    console.log('⏰ Запущена ежедневная очистка истекших согласий и auth-данных (распределённый лок Redis)')
}