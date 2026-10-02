import UserCookieConsent from "../models/userCookieConsentModels.js"
import AuthSession from '../models/AuthSession.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import PlantPhoto from '../models/PlantPhoto.js'
import { Op } from "sequelize"
import { cleanOrphanedPlantPhotoFiles } from '../utils/plantPhotoCleanup.js'


export async function cleanExpiredAuthData() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [deletedConsents, deletedSessions, deletedChallenges, deletedPhotos] = await Promise.all([
        UserCookieConsent.destroy({
            where: {
                expires_at: { [Op.lt]: thirtyDaysAgo },
                user_id: null
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

    const deleted = deletedConsents + deletedSessions + deletedChallenges
    console.log(
        `🧹 Очищено согласий: ${deletedConsents}, сессий: ${deletedSessions}, ` +
        `passkey-челленджей: ${deletedChallenges}, фото-файлов: ${deletedPhotos}`
    )
    return deleted
}

export function startCleanupJob() {
    const runCleanup = () => cleanExpiredAuthData().catch(error => {
        console.error('❌ Ошибка очистки:', error)
    })

    runCleanup()
    setInterval(runCleanup, 24 * 60 * 60 * 1000)
    console.log('⏰ Запущена ежедневная очистка истекших согласий')
}