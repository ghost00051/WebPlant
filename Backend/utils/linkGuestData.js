import ChatLog from '../models/ChatLog.js'
import UserCookieConsent from '../models/userCookieConsentModels.js'

export async function linkGuestDataToUser(
    userId,
    guestToken,
    source,
    transaction
) {
    if (!guestToken) return { consentCount: 0, chatMessageCount: 0 }

    const options = transaction ? { transaction } : {}
    const [consentResult] = await UserCookieConsent.update(
        { user_id: userId, source },
        {
            where: { guest_token: guestToken, user_id: null },
            ...options
        }
    )
    const [chatMessageCount] = await ChatLog.update(
        { user_id: userId },
        {
            where: {
                user_id: null,
                'metadata.guestToken': guestToken
            },
            ...options
        }
    )

    return {
        consentCount: consentResult,
        chatMessageCount
    }
}
