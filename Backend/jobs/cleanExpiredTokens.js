import UserCookieConsent from "../models/userCookieConsentModels.js"
import AuthSession from '../models/AuthSession.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import PlantPhoto from '../models/PlantPhoto.js'
import ChatLog from '../models/ChatLog.js'
import SiteVisit from '../models/SiteVisit.js'
import { Op } from "sequelize"
import { cleanOrphanedPlantPhotoFiles } from '../utils/plantPhotoCleanup.js'
import { withDistributedLock } from '../utils/distributedLock.js'

const GUEST_DATA_RETENTION_MS = 180 * 24 * 60 * 60 * 1000
const VISIT_RETENTION_DAYS = 400
const CLEANUP_LOCK = 'job:cleanup-expired'
const CLEANUP_LOCK_TTL_MS = 30 * 60 * 1000

export async function cleanExpiredAuthData() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const guestDataCutoff = new Date(Date.now() - GUEST_DATA_RETENTION_MS)
    const visitCutoff = new Date(Date.now() - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)

    const [
        deletedConsents,
        deletedGuestChatLogs,
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

    const deleted =
        deletedConsents + deletedGuestChatLogs + deletedSessions + deletedChallenges +
        deletedResetTokens
    console.log(
        `🧹 Очищено гостевых согласий: ${deletedConsents}, гостевых сообщений: ${deletedGuestChatLogs}, ` +
        `сессий: ${deletedSessions}, ` +
        `passkey-челленджей: ${deletedChallenges}, ссылок сброса пароля: ${deletedResetTokens}, ` +
        `фото-файлов: ${deletedPhotos}, ` +
        `дней статистики посещений: ${deletedVisits}`
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