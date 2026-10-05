import { v4 as uuidv4 } from 'uuid'

export const GUEST_TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000

export function generateGuestToken() {
    return `guest_${uuidv4().replace(/-/g, '')}_${Date.now()}`
}

const cookieOptions = {
    maxAge: GUEST_TOKEN_LIFETIME_MS,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
}

export function getGuestToken(req, res, next) {
    let guestToken = getValidGuestToken(req.cookies?.guest_token)

    if (!guestToken) {
        guestToken = generateGuestToken()
        res.cookie('guest_token', guestToken, cookieOptions)
    }

    req.guestToken = guestToken
    next()
}

export function getValidGuestToken(token, now = Date.now()) {
    const tokenData = parseGuestToken(token)
    if (
        !tokenData ||
        now - tokenData.timestamp >= GUEST_TOKEN_LIFETIME_MS ||
        tokenData.timestamp > now
    ) {
        return null
    }
    return token
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

function parseGuestToken(token) {
    if (typeof token !== 'string') return null
    const match = /^guest_[0-9a-f]{32}_(\d{13})$/i.exec(token)
    if (!match) return null
    const timestamp = Number(match[1])
    return Number.isSafeInteger(timestamp) ? { timestamp } : null
}