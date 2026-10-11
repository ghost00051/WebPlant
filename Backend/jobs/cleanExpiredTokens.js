import UserCookieConsent from "../models/userCookieConsentModels.js"
import AuthSession from '../models/AuthSession.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import PlantPhoto from '../models/PlantPhoto.js'
import ChatLog from '../models/ChatLog.js'
import { Op } from "sequelize"
import { cleanOrphanedPlantPhotoFiles } from '../utils/plantPhotoCleanup.js'
import { withDistributedLock } from '../utils/distributedLock.js'

const GUEST_DATA_RETENTION_MS = 180 * 24 * 60 * 60 * 1000
const CLEANUP_LOCK = 'job:cleanup-expired'
const CLEANUP_LOCK_TTL_MS = 30 * 60 * 1000

export async function cleanExpiredAuthData() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const guestDataCutoff = new Date(Date.now() - GUEST_DATA_RETENTION_MS)

    const [
        deletedConsents,
        deletedGuestChatLogs,
        deletedSessions,
        deletedChallenges,
        deletedPhotos
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
        PlantPhoto.findAll({ attributes: ['url'], raw: true })
            .then(rows => cleanOrphanedPlantPhotoFiles({
                referencedUrls: rows.map(row => row.url)
            }))
    ])

    const deleted =
        deletedConsents + deletedGuestChatLogs + deletedSessions + deletedChallenges
    console.log(
        `🧹 Очищено гостевых согласий: ${deletedConsents}, гостевых сообщений: ${deletedGuestChatLogs}, ` +
        `сессий: ${deletedSessions}, ` +
        `passkey-челленджей: ${deletedChallenges}, фото-файлов: ${deletedPhotos}`
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