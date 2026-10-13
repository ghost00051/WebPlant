import { createHash, randomBytes } from 'node:crypto'

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
export const RESET_TOKEN_TTL_MINUTES = RESET_TOKEN_TTL_MS / 60 / 1000
export const RESET_TOKEN_BYTES = 32
export const RESET_LINK_PATH = '/reset-password'
export const RESET_REQUEST_COOLDOWN_MS = 60 * 1000
export const RESET_MAX_REQUESTS_PER_HOUR = 3
export const RESET_PASSWORD_MIN_LENGTH = 8
const RESET_PASSWORD_MAX_BYTES = 72

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function generateResetToken() {
    return randomBytes(RESET_TOKEN_BYTES).toString('base64url')
}

export function hashResetToken(token) {
    return createHash('sha256').update(token).digest('hex')
}

export function isValidResetTokenFormat(token) {
    return typeof token === 'string' && TOKEN_PATTERN.test(token)
}

export function isValidResetPassword(password) {
    return typeof password === 'string' &&
        password.length >= RESET_PASSWORD_MIN_LENGTH &&
        Buffer.byteLength(password, 'utf8') <= RESET_PASSWORD_MAX_BYTES
}

export function isResetTokenUsable(tokenRecord, now = new Date()) {
    if (!tokenRecord) return false
    if (tokenRecord.used_at) return false
    if (!tokenRecord.expires_at) return false
    return new Date(tokenRecord.expires_at).getTime() > now.getTime()
}

export function isResetRequestTooSoon(lastCreatedAt, now = new Date()) {
    if (!lastCreatedAt) return false
    const elapsed = now.getTime() - new Date(lastCreatedAt).getTime()
    return elapsed >= 0 && elapsed < RESET_REQUEST_COOLDOWN_MS
}

export function getPrimaryFrontendUrl(frontendUrl) {
    if (typeof frontendUrl !== 'string') return ''
    const first = frontendUrl.split(',').map(value => value.trim()).find(Boolean)
    return first ? first.replace(/\/+$/, '') : ''
}

export function buildResetUrl(token, frontendUrl) {
    const base = getPrimaryFrontendUrl(frontendUrl)
    if (!base) throw new Error('FRONTEND_URL is not configured')
    if (!isValidResetTokenFormat(token)) throw new Error('Invalid reset token')
    return `${base}${RESET_LINK_PATH}?token=${encodeURIComponent(token)}`
}

export function maskEmail(email) {
    if (typeof email !== 'string') return ''
    const trimmed = email.trim()
    const at = trimmed.lastIndexOf('@')
    if (at < 1) return ''
    const local = trimmed.slice(0, at)
    const domain = trimmed.slice(at + 1)
    if (!domain) return ''
    const visible = local.slice(0, Math.min(2, local.length))
    return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}
