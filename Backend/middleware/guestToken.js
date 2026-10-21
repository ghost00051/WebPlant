import crypto from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'

export const GUEST_TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000

export const LEGACY_GUEST_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export const GUEST_TOKEN_SIGNATURE_LENGTH = 32

const GUEST_TOKEN_HEX = '[0-9a-f]{32}'
const SIGNED_GUEST_TOKEN = new RegExp(
    `^guest_(${GUEST_TOKEN_HEX})_(\\d{13})_([0-9a-f]{${GUEST_TOKEN_SIGNATURE_LENGTH}})$`,
    'i'
)
const LEGACY_GUEST_TOKEN = new RegExp(`^guest_(${GUEST_TOKEN_HEX})_(\\d{13})$`, 'i')

const DEVELOPMENT_SECRET = 'webplant-guest-token-development-only-secret'

const cookieOptions = {
    maxAge: GUEST_TOKEN_LIFETIME_MS,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
}

function guestTokenSecret() {
    const secret = process.env.SECRET_KEY
    return typeof secret === 'string' && secret ? secret : DEVELOPMENT_SECRET
}

export function signGuestToken(hex, timestamp) {
    return crypto
        .createHmac('sha256', guestTokenSecret())
        .update(`guest.${String(hex).toLowerCase()}.${timestamp}`)
        .digest('hex')
        .slice(0, GUEST_TOKEN_SIGNATURE_LENGTH)
}

function signatureMatches(hex, timestamp, signature) {
    const expected = Buffer.from(signGuestToken(hex, timestamp), 'hex')
    const provided = Buffer.from(String(signature).toLowerCase(), 'hex')
    if (provided.length !== expected.length) return false
    return crypto.timingSafeEqual(provided, expected)
}

export function generateGuestToken(now = Date.now()) {
    const hex = uuidv4().replace(/-/g, '')
    const timestamp = Number(now)
    return `guest_${hex}_${timestamp}_${signGuestToken(hex, timestamp)}`
}

export function getGuestToken(req, res, next) {
    const parsed = parseGuestToken(req.cookies?.guest_token)
    let guestToken = parsed?.token ?? null

    if (!guestToken || parsed.legacy) {
        guestToken = generateGuestToken()
        res.cookie('guest_token', guestToken, cookieOptions)
    }

    req.guestToken = guestToken
    next()
}

export function getValidGuestToken(token, now = Date.now()) {
    return parseGuestToken(token, now)?.token ?? null
}

export function parseGuestToken(token, now = Date.now()) {
    if (typeof token !== 'string') return null

    const signed = SIGNED_GUEST_TOKEN.exec(token)
    if (signed) {
        const [, hex, rawTimestamp, signature] = signed
        const timestamp = Number(rawTimestamp)
        if (
            !Number.isSafeInteger(timestamp) ||
            now - timestamp >= GUEST_TOKEN_LIFETIME_MS ||
            timestamp > now ||
            !signatureMatches(hex, rawTimestamp, signature)
        ) {
            return null
        }
        return { token, hex: hex.toLowerCase(), timestamp, legacy: false }
    }

    const legacy = LEGACY_GUEST_TOKEN.exec(token)
    if (legacy) {
        const [, hex, rawTimestamp] = legacy
        const timestamp = Number(rawTimestamp)
        if (
            !Number.isSafeInteger(timestamp) ||
            now - timestamp >= LEGACY_GUEST_TOKEN_LIFETIME_MS ||
            timestamp > now
        ) {
            return null
        }
        return { token, hex: hex.toLowerCase(), timestamp, legacy: true }
    }

    return null
}

export function clearGuestTokenCookie(res) {
    const clearOptions = {
        httpOnly: cookieOptions.httpOnly,
        sameSite: cookieOptions.sameSite,
        secure: cookieOptions.secure,
        path: cookieOptions.path
    }
    res.clearCookie('guest_token', clearOptions)
}
