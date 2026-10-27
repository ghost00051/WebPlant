import { Op } from 'sequelize'
import ChatLog from '../models/ChatLog.js'
import UserCookieConsent from '../models/userCookieConsentModels.js'

export const GUEST_LINK_SOURCES = Object.freeze([
    'registration_linked',
    'login_linked'
])

export const DEFAULT_LINK_MODELS = Object.freeze({
    ChatLog,
    UserCookieConsent
})

const MAX_GUEST_TOKEN_LENGTH = 255

function buildEmptyResult() {
    return {
        consentCount: 0,
        chatMessageCount: 0,
        chatSessionCount: 0,
        diagnosisCount: 0,
        linked: false,
        skipped: false,
        errors: []
    }
}

function normalizeUserId(userId) {
    const parsed = Number(userId)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeGuestToken(guestToken) {
    if (typeof guestToken !== 'string') return null
    const token = guestToken.trim()
    if (!token || token.length > MAX_GUEST_TOKEN_LENGTH) return null
    return token
}

function normalizeSource(source) {
    return GUEST_LINK_SOURCES.includes(source) ? source : 'registration_linked'
}

function describeError(error) {
    return error?.message || String(error)
}

async function runStep(errors, step, task) {
    try {
        return await task()
    } catch (error) {
        errors.push({ step, message: describeError(error) })
        return null
    }
}

function readAffectedRows(result) {
    if (Array.isArray(result)) {
        const affected = Number(result[0])
        return Number.isFinite(affected) && affected > 0 ? affected : 0
    }
    const parsed = Number(result)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export async function linkGuestDataToUser(
    userId,
    guestToken,
    source,
    transaction,
    deps = {}
) {
    const result = buildEmptyResult()
    const targetUserId = normalizeUserId(userId)
    const token = normalizeGuestToken(guestToken)

    if (!targetUserId || !token) {
        result.skipped = true
        return result
    }

    const models = { ...DEFAULT_LINK_MODELS, ...(deps.models || {}) }
    const linkSource = normalizeSource(source)
    const options = transaction ? { transaction } : {}
    const guestOwner = { user_id: null, 'metadata.guestToken': token }

    result.consentCount = await runStep(result.errors, 'cookie_consents', async () => {
        const updated = await models.UserCookieConsent.update(
            { user_id: targetUserId, source: linkSource },
            {
                where: { guest_token: token, user_id: null },
                ...options
            }
        )
        return readAffectedRows(updated)
    }) ?? 0

    result.chatSessionCount = await runStep(result.errors, 'chat_sessions', async () => {
        const count = await models.ChatLog.count({
            where: guestOwner,
            distinct: true,
            col: 'session_id',
            ...options
        })
        return Number(count) || 0
    }) ?? 0

    result.diagnosisCount = await runStep(result.errors, 'chat_diagnoses', async () => {
        const count = await models.ChatLog.count({
            where: {
                ...guestOwner,
                'metadata.diagnosis': { [Op.ne]: null }
            },
            ...options
        })
        return Number(count) || 0
    }) ?? 0

    result.chatMessageCount = await runStep(result.errors, 'chat_messages', async () => {
        const updated = await models.ChatLog.update(
            { user_id: targetUserId },
            { where: guestOwner, ...options }
        )
        return readAffectedRows(updated)
    }) ?? 0

    result.linked = result.chatMessageCount > 0 || result.consentCount > 0
    return result
}

export function describeGuestLinkSummary(result = {}) {
    const parts = []
    const consentCount = Number(result.consentCount) || 0
    const chatMessageCount = Number(result.chatMessageCount) || 0
    const chatSessionCount = Number(result.chatSessionCount) || 0
    const diagnosisCount = Number(result.diagnosisCount) || 0
    if (consentCount > 0) parts.push(`согласий: ${consentCount}`)
    if (chatMessageCount > 0) parts.push(`сообщений: ${chatMessageCount}`)
    if (chatSessionCount > 0) parts.push(`чатов: ${chatSessionCount}`)
    if (diagnosisCount > 0) parts.push(`диагнозов: ${diagnosisCount}`)
    return parts.length ? parts.join(', ') : 'нечего переносить'
}

export default {
    DEFAULT_LINK_MODELS,
    GUEST_LINK_SOURCES,
    describeGuestLinkSummary,
    linkGuestDataToUser
}
