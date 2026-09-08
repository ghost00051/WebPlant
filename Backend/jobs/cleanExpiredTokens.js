import sequelize from "../db.js"
import UserCookieConsent from "../models/userCookieConsentModels.js"
import { Op } from "sequelize"


export async function cleanExpiredConsents() {
    try {
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
    } catch (error) {
        console.error('❌ Ошибка очистки:', error)
        return 0
    }
}


export function startCleanupJob() {
    
    cleanExpiredConsents()

    
    setInterval(cleanExpiredConsents, 24 * 60 * 60 * 1000)
    console.log('⏰ Запущена ежедневная очистка истекших согласий')
}