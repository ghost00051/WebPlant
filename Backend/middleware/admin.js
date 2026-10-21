import { requireAuth } from './auth.js'
import { parseAdminPanelOrigins } from '../utils/origins.js'

const ADMIN_API_PATH = /^\/api\/admin(?:\/|$)/
export const ADMIN_ORIGIN_FORBIDDEN_MESSAGE = 'Доступ с этого источника запрещён'

function canonicalOrigin(value) {
    try {
        return new URL(value).origin
    } catch {
        return String(value).replace(/\/$/, '')
    }
}

export function isAdminPanelOrigin(origin, { adminPanelOrigins = process.env.ADMIN_PANEL_ORIGIN } = {}) {
    if (typeof origin !== 'string' || !origin) return false
    const requested = canonicalOrigin(origin)
    return parseAdminPanelOrigins(adminPanelOrigins || '')
        .some(configuredOrigin => canonicalOrigin(configuredOrigin) === requested)
}

export function isLegacyFrontendOrigin(origin, { frontendUrl = process.env.FRONTEND_URL } = {}) {
    if (typeof origin !== 'string' || !origin) return false
    if (String(process.env.ADMIN_PANEL_ALLOW_FRONTEND_ORIGIN ?? '').toLowerCase() !== 'true') return false
    const requested = canonicalOrigin(origin)
    return String(frontendUrl || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .some(configuredOrigin => canonicalOrigin(configuredOrigin) === requested)
}

function requestOrigin(req) {
    const header = req?.headers?.origin ??
        (typeof req?.get === 'function' ? req.get('origin') : undefined)
    if (header === undefined || header === null || header === '') return null
    return typeof header === 'string' ? header : String(header)
}

export function isAdminApiRequest(req) {
    const originalUrl = typeof req?.originalUrl === 'string' ? req.originalUrl : ''
    const baseUrl = typeof req?.baseUrl === 'string' ? req.baseUrl : ''
    const path = typeof req?.path === 'string' ? req.path : ''
    const requestPath = originalUrl || `${baseUrl}${path}`
    if (!requestPath) return true
    return ADMIN_API_PATH.test(requestPath.split('?')[0])
}

export function requireAdmin(req, res, next) {
    return requireAuth(req, res, () => {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Доступ запрещён' })
        }
        if (isAdminApiRequest(req)) {
            const origin = requestOrigin(req)
            if (origin && !isAdminPanelOrigin(origin) && !isLegacyFrontendOrigin(origin)) {
                return res.status(403).json({ message: ADMIN_ORIGIN_FORBIDDEN_MESSAGE })
            }
        }
        return next()
    })
}
