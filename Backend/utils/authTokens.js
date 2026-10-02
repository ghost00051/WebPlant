import { createHash, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import AuthSession from '../models/AuthSession.js'

export const ACCESS_TOKEN_LIFETIME = '15m'
export const SESSION_TOKEN_LIFETIME = '24h'
export const REFRESH_TOKEN_LIFETIME = '30d'
export const REFRESH_TOKEN_COOKIE_LIFETIME = 30 * 24 * 60 * 60 * 1000
const SESSION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000

function hashTokenId(tokenId) {
    return createHash('sha256').update(tokenId).digest('hex')
}

function baseCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production'
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        domain: isProd ? '.checktheplants.ru' : undefined,
        path: '/'
    }
}

function signToken(user, tokenType, expiresIn, { jti, sid } = {}) {
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        tokenType
    }
    if (jti) payload.jti = jti
    if (sid) payload.sid = sid

    return jwt.sign(
        payload,
        process.env.SECRET_KEY,
        { expiresIn }
    )
}

async function createAuthSession(user, tokenId, tokenType, expiresInMs) {
    await AuthSession.create({
        user_id: user.id,
        token_hash: hashTokenId(tokenId),
        token_type: tokenType,
        expires_at: new Date(Date.now() + expiresInMs)
    })
}

export async function isAuthTokenActive(payload) {
    if (!payload || !Number.isInteger(payload.id)) return false

    let tokenId
    let tokenType
    if (payload.tokenType === 'session' || payload.tokenType === 'refresh') {
        tokenId = payload.jti
        tokenType = payload.tokenType
    } else if (payload.tokenType === 'access') {
        tokenId = payload.sid
        tokenType = 'refresh'
    } else {
        return false
    }

    if (typeof tokenId !== 'string' || !tokenId) return false

    const session = await AuthSession.findOne({
        where: {
            user_id: payload.id,
            token_hash: hashTokenId(tokenId),
            token_type: tokenType,
            revoked_at: null,
            expires_at: { [Op.gt]: new Date() }
        },
        attributes: ['id']
    })
    return Boolean(session)
}

export async function revokeAuthToken(token) {
    if (typeof token !== 'string' || !token) return

    let payload
    try {
        payload = jwt.verify(token, process.env.SECRET_KEY)
    } catch {
        return
    }

    if (!Number.isInteger(payload.id)) return

    let tokenId
    let tokenType
    if (payload.tokenType === 'session' || payload.tokenType === 'refresh') {
        tokenId = payload.jti
        tokenType = payload.tokenType
    } else if (payload.tokenType === 'access') {
        tokenId = payload.sid
        tokenType = 'refresh'
    }
    if (typeof tokenId !== 'string' || !tokenId || !tokenType) return

    await AuthSession.update(
        { revoked_at: new Date() },
        {
            where: {
                user_id: payload.id,
                token_hash: hashTokenId(tokenId),
                token_type: tokenType,
                revoked_at: null
            }
        }
    )
}

export async function revokeAuthTokens(cookies = {}) {
    const tokens = new Set([cookies.token, cookies.refresh_token])
    for (const token of tokens) {
        await revokeAuthToken(token)
    }
}

export async function setSessionAuth(res, user) {
    const sessionId = randomUUID()
    await createAuthSession(
        user,
        sessionId,
        'session',
        SESSION_TOKEN_LIFETIME_MS
    )
    res.cookie(
        'token',
        signToken(user, 'session', SESSION_TOKEN_LIFETIME, { jti: sessionId }),
        baseCookieOptions()
    )
    clearRefreshTokenCookie(res)
}

export async function setRememberedAuth(res, user) {
    const sessionId = randomUUID()
    await createAuthSession(
        user,
        sessionId,
        'refresh',
        REFRESH_TOKEN_COOKIE_LIFETIME
    )
    res.cookie(
        'token',
        signToken(user, 'access', ACCESS_TOKEN_LIFETIME, { sid: sessionId }),
        baseCookieOptions()
    )
    res.cookie(
        'refresh_token',
        signToken(user, 'refresh', REFRESH_TOKEN_LIFETIME, { jti: sessionId }),
        {
            ...baseCookieOptions(),
            maxAge: REFRESH_TOKEN_COOKIE_LIFETIME
        }
    )
}

export function renewAccessToken(res, user, sessionId) {
    const token = signToken(user, 'access', ACCESS_TOKEN_LIFETIME, {
        sid: sessionId
    })
    res.cookie(
        'token',
        token,
        baseCookieOptions()
    )
    return token
}

export function clearRefreshTokenCookie(res) {
    res.clearCookie('refresh_token', baseCookieOptions())
}

export function clearAuthCookies(res) {
    res.clearCookie('token', baseCookieOptions())
    clearRefreshTokenCookie(res)
}
