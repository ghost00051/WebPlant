import { randomBytes } from 'node:crypto'

export const SHARE_TOKEN_BYTES = 16
export const SHARE_TOKEN_MIN_LENGTH = 16
export const SHARE_TOKEN_MAX_LENGTH = 64
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

export function generateShareToken() {
    return randomBytes(SHARE_TOKEN_BYTES).toString('base64url')
}

export function isValidShareToken(value) {
    return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value)
}

export function normalizeShareToken(value) {
    if (typeof value !== 'string') return null
    const token = value.trim()
    return token ? token : null
}

export function parseShareToken(value) {
    if (value === undefined || value === null) return { ok: true, token: null }
    if (typeof value !== 'string') return { ok: false, token: null }
    const token = value.trim()
    if (!token) return { ok: true, token: null }
    if (!SHARE_TOKEN_PATTERN.test(token)) return { ok: false, token: null }
    return { ok: true, token }
}
