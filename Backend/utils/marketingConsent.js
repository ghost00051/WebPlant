import { createHmac, timingSafeEqual } from 'node:crypto'
import { getPrimaryFrontendUrl } from './passwordReset.js'


export const UNSUBSCRIBE_PATH = '/unsubscribe'
export const UNSUBSCRIBE_URL_BASE_ENV = 'UNSUBSCRIBE_URL_BASE'
export const UNSUBSCRIBE_TOKEN_LENGTH = 32
export const UNSUBSCRIBE_TOKEN_PREFIX = 'unsubscribe'
export const UNSUBSCRIBE_ONE_CLICK_HEADER = 'List-Unsubscribe-Post'
export const UNSUBSCRIBE_ONE_CLICK_VALUE = 'List-Unsubscribe=One-Click'

const USER_ID_MAX = 2_147_483_647

export function normalizeUnsubscribeUserId(user) {
    if (user === null || user === undefined) return null

    const raw = typeof user === 'object' ? user.id : user
    if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) && raw > 0 && raw <= USER_ID_MAX ? raw : null
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!/^\d{1,10}$/.test(trimmed)) return null
        const parsed = Number(trimmed)
        return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= USER_ID_MAX ? parsed : null
    }
    return null
}

function resolveSecret(secret) {
    const value = secret === undefined ? process.env.SECRET_KEY : secret
    if (typeof value !== 'string' || !value) {
        throw new Error('SECRET_KEY is not configured')
    }
    return value
}

function signUnsubscribeToken(userId, secret) {
    return createHmac('sha256', resolveSecret(secret))
        .update(`${UNSUBSCRIBE_TOKEN_PREFIX}:${userId}`)
        .digest('base64url')
        .slice(0, UNSUBSCRIBE_TOKEN_LENGTH)
}

export function createUnsubscribeToken(user, { secret } = {}) {
    const userId = normalizeUnsubscribeUserId(user)
    if (userId === null) throw new Error('createUnsubscribeToken: invalid user id')
    return signUnsubscribeToken(userId, secret)
}

export function verifyUnsubscribeToken(userId, token, { secret } = {}) {
    const id = normalizeUnsubscribeUserId(userId)
    if (id === null) return false
    if (typeof token !== 'string' || !token) return false

    let expected
    try {
        expected = signUnsubscribeToken(id, secret)
    } catch {
        return false
    }

    const expectedBuffer = Buffer.from(expected, 'utf8')
    const providedBuffer = Buffer.from(token, 'utf8')
    if (expectedBuffer.length !== providedBuffer.length) return false
    return timingSafeEqual(expectedBuffer, providedBuffer)
}

export function buildUnsubscribeUrl(user, {
    frontendUrl = process.env.FRONTEND_URL,
    secret,
    baseUrl = process.env[UNSUBSCRIBE_URL_BASE_ENV]
} = {}) {
    const userId = normalizeUnsubscribeUserId(user)
    if (userId === null) throw new Error('buildUnsubscribeUrl: invalid user id')

    const explicitBase = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
    let base = explicitBase
    if (!base) {
        const frontendBase = getPrimaryFrontendUrl(frontendUrl)
        if (!frontendBase) throw new Error('FRONTEND_URL is not configured')
        base = `${frontendBase}${UNSUBSCRIBE_PATH}`
    }

    const token = createUnsubscribeToken(userId, { secret })
    return `${base}?uid=${userId}&token=${token}`
}

export function buildListUnsubscribeHeaders(user, options = {}) {
    const url = buildUnsubscribeUrl(user, options)
    return {
        'List-Unsubscribe': `<${url}>`,
        [UNSUBSCRIBE_ONE_CLICK_HEADER]: UNSUBSCRIBE_ONE_CLICK_VALUE
    }
}
