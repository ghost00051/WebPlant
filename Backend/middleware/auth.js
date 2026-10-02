import jwt from 'jsonwebtoken'
import User from '../models/userModels.js'
import {
    clearAuthCookies,
    clearRefreshTokenCookie,
    isAuthTokenActive,
    renewAccessToken
} from '../utils/authTokens.js'

export async function refreshRememberedSession(req, res, next) {
    const token = req.cookies?.token
    let tokenPayload
    if (token) {
        try {
            tokenPayload = jwt.verify(token, process.env.SECRET_KEY)
        } catch {
            tokenPayload = null
        }

        if (tokenPayload && tokenPayload.tokenType !== 'refresh') {
            const legacySession =
                tokenPayload.tokenType === 'session' && !tokenPayload.jti
            if (legacySession || await isAuthTokenActive(tokenPayload)) return next()

            clearAuthCookies(res)
            req.cookies.token = undefined
            req.cookies.refresh_token = undefined
            return next()
        }
    }

    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) return next()

    let refreshPayload
    try {
        refreshPayload = jwt.verify(refreshToken, process.env.SECRET_KEY)
    } catch {
        clearRefreshTokenCookie(res)
        return next()
    }

    if (
        refreshPayload.tokenType !== 'refresh' ||
        !(await isAuthTokenActive(refreshPayload))
    ) {
        clearRefreshTokenCookie(res)
        req.cookies.refresh_token = undefined
        return next()
    }

    try {
        const user = await User.findByPk(refreshPayload.id)
        if (!user) {
            clearRefreshTokenCookie(res)
            return next()
        }

        req.cookies.token = renewAccessToken(res, user, refreshPayload.jti)
        return next()
    } catch (error) {
        return next(error)
    }
}

async function authenticate(req, res, next, required) {
    let decoded
    const token = req.cookies?.token
    if (token) {
        let verified
        try {
            verified = jwt.verify(token, process.env.SECRET_KEY)
        } catch {
            verified = undefined
        }
        if (verified) {
            if (verified.tokenType === 'session' && !verified.jti) {
                decoded = verified
            } else if (
                verified.tokenType !== 'refresh' &&
                await isAuthTokenActive(verified)
            ) {
                decoded = verified
            }
        }
    }

    try {
        if (!decoded && req.cookies?.refresh_token) {
            let refreshPayload
            try {
                refreshPayload = jwt.verify(
                    req.cookies.refresh_token,
                    process.env.SECRET_KEY
                )
            } catch {
                refreshPayload = undefined
            }
            if (
                refreshPayload?.tokenType === 'refresh' &&
                await isAuthTokenActive(refreshPayload)
            ) {
                decoded = refreshPayload
            }
        }

        if (!decoded) {
            if (required) {
                return res.status(401).json({ message: 'Не авторизован' })
            }
            return next()
        }

        const user = await User.findByPk(decoded.id)
        if (!user) {
            return res.status(401).json({ message: 'Пользователь не найден' })
        }

        if (decoded.tokenType === 'refresh') {
            req.cookies.token = renewAccessToken(res, user, decoded.jti)
        }

        req.user = user
        return next()
    } catch (error) {
        return next(error)
    }
}

export function requireAuth(req, res, next) {
    return authenticate(req, res, next, true)
}

export function optionalAuth(req, res, next) {
    return authenticate(req, res, next, false)
}