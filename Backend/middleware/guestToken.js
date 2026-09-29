import { v4 as uuidv4 } from 'uuid'

const GUEST_TOKEN_LIFETIME = 60 * 60 * 1000

export function generateGuestToken() {
    return `guest_${uuidv4().replace(/-/g, '')}_${Date.now()}`
}

const cookieOptions = {
    maxAge: GUEST_TOKEN_LIFETIME,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
}

export function getGuestToken(req, res, next) {
    let guestToken = req.cookies.guest_token

    const tokenData = parseGuestToken(guestToken)
    if (!tokenData || Date.now() - tokenData.timestamp > GUEST_TOKEN_LIFETIME || tokenData.timestamp > Date.now()) {
        guestToken = generateGuestToken()
        res.cookie('guest_token', guestToken, cookieOptions)
    }

    req.guestToken = guestToken
    next()
}

function parseGuestToken(token) {
    if (typeof token !== 'string') return null
    const match = /^guest_[0-9a-f]{32}_(\d{13})$/i.exec(token)
    if (!match) return null
    const timestamp = Number(match[1])
    return Number.isSafeInteger(timestamp) ? { timestamp } : null
}