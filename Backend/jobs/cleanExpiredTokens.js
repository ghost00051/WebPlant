import UserCookieConsent from "../models/userCookieConsentModels.js"
import { Op } from "sequelize"


export async function cleanExpiredConsents() {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const deleted = await UserCookieConsent.destroy({
        where: {
            expires_at: { [Op.lt]: thirtyDaysAgo },
            user_id: null
        }
    })

    console.log(`🧹 Очищено ${deleted} истекших согласий`)
    return deleted
}

export function startCleanupJob() {
    const runCleanup = () => cleanExpiredConsents().catch(error => {
        console.error('❌ Ошибка очистки:', error)
    })

    runCleanup()
    setInterval(runCleanup, 24 * 60 * 60 * 1000)
    console.log('⏰ Запущена ежедневная очистка истекших согласий')
}