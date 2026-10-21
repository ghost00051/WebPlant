import { isIP } from 'node:net'
import AdminAuditLog from '../models/AdminAuditLog.js'

export const MAX_PAYLOAD_BYTES = 4000
export const MAX_PAYLOAD_DEPTH = 6
export const MAX_ACTION_LENGTH = 64
export const MAX_TARGET_TYPE_LENGTH = 32
export const MAX_TARGET_ID_LENGTH = 64
export const MAX_USER_AGENT_LENGTH = 512
export const DEFAULT_AUDIT_LIMIT = 50
export const MAX_AUDIT_LIMIT = 200

const SECRET_KEY_PATTERN = /(password|token|cookie|secret)/i

function sanitizeValue(value, seen, depth) {
    if (value === null) return null
    if (typeof value === 'string') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'boolean') return value
    if (typeof value === 'bigint') return value.toString()
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
        return undefined
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString()
    }
    if (typeof value !== 'object') return String(value)
    if (depth >= MAX_PAYLOAD_DEPTH) return '[max depth]'
    if (seen.has(value)) return '[circular]'

    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return value.map(item => {
                const sanitized = sanitizeValue(item, seen, depth + 1)
                return sanitized === undefined ? null : sanitized
            })
        }

        const result = {}
        for (const [key, item] of Object.entries(value)) {
            if (SECRET_KEY_PATTERN.test(key)) continue
            const sanitized = sanitizeValue(item, seen, depth + 1)
            if (sanitized !== undefined) result[key] = sanitized
        }
        return result
    } finally {
        seen.delete(value)
    }
}

export function sanitizeAuditPayload(payload) {
    if (payload === undefined || payload === null) return null
    try {
        const sanitized = sanitizeValue(payload, new WeakSet(), 0)
        return sanitized === undefined ? null : sanitized
    } catch {
        return null
    }
}

function sliceUtf8(text, maxBytes) {
    const buffer = Buffer.from(text, 'utf8')
    if (buffer.length <= maxBytes) return text

    let end = Math.max(0, maxBytes)
    while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
    return buffer.subarray(0, end).toString('utf8')
}

export function fitAuditPayload(payload) {
    const sanitized = sanitizeAuditPayload(payload)
    if (sanitized === null) return null

    let text
    try {
        text = JSON.stringify(sanitized)
    } catch {
        return { truncated: true, reason: 'unserializable' }
    }
    if (text === undefined) return null

    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes <= MAX_PAYLOAD_BYTES) return sanitized

    let budget = MAX_PAYLOAD_BYTES - 64
    while (budget > 0) {
        const candidate = {
            truncated: true,
            original_bytes: bytes,
            preview: sliceUtf8(text, budget)
        }
        if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_PAYLOAD_BYTES) {
            return candidate
        }
        budget -= 32
    }

    return { truncated: true, original_bytes: bytes }
}

export function normalizeAuditIp(value) {
    if (typeof value !== 'string') return null

    let ip = value.trim()
    if (!ip) return null

    const comma = ip.indexOf(',')
    if (comma !== -1) ip = ip.slice(0, comma).trim()

    const zone = ip.indexOf('%')
    if (zone !== -1) ip = ip.slice(0, zone)

    return isIP(ip) ? ip : null
}

function normalizeText(value, maxLength) {
    if (value === undefined || value === null) return null
    const text = String(value).trim()
    if (!text) return null
    return text.length > maxLength ? text.slice(0, maxLength) : text
}

function normalizeAdminId(value) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeLimit(value) {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_AUDIT_LIMIT
    return Math.min(parsed, MAX_AUDIT_LIMIT)
}

function normalizeOffset(value) {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0
    return parsed
}

export function buildAuditRow(req, { action, targetType, targetId, payload } = {}) {
    const normalizedAction = typeof action === 'string' ? action.trim() : ''
    if (!normalizedAction || normalizedAction.length > MAX_ACTION_LENGTH) return null

    return {
        admin_id: normalizeAdminId(req?.user?.id),
        action: normalizedAction,
        target_type: normalizeText(targetType, MAX_TARGET_TYPE_LENGTH),
        target_id: normalizeText(targetId, MAX_TARGET_ID_LENGTH),
        payload: fitAuditPayload(payload),
        ip: normalizeAuditIp(req?.ip ?? req?.socket?.remoteAddress),
        user_agent: normalizeText(req?.get?.('user-agent'), MAX_USER_AGENT_LENGTH)
    }
}

export function createAdminAuditRecorder({ model = AdminAuditLog } = {}) {
    return async function recordAdminAction(req, entry = {}) {
        try {
            const row = buildAuditRow(req, entry)
            if (!row) return false

            await model.create(row)
            return true
        } catch (error) {
            console.warn(
                `⚠️ Не удалось записать действие администратора в аудит ` +
                `(requestId: ${req?.requestId ?? 'n/a'}):`,
                error?.message ?? error
            )
            return false
        }
    }
}

export const recordAdminAction = createAdminAuditRecorder()

function mapAuditRow(row) {
    const plain = typeof row?.get === 'function' ? row.get({ plain: true }) : (row ?? {})
    const rawId = plain.id
    const numericId = Number(rawId)

    return {
        id: rawId === null || rawId === undefined
            ? null
            : (Number.isSafeInteger(numericId) ? numericId : String(rawId)),
        adminId: plain.admin_id ?? null,
        action: plain.action ?? null,
        targetType: plain.target_type ?? null,
        targetId: plain.target_id ?? null,
        payload: plain.payload ?? null,
        ip: plain.ip ?? null,
        userAgent: plain.user_agent ?? null,
        createdAt: plain.created_at ?? null
    }
}

export function createAdminAuditLister({ model = AdminAuditLog } = {}) {
    return async function listAdminActions({ limit, offset, action, adminId } = {}) {
        const where = {}

        const normalizedAction = normalizeText(action, MAX_ACTION_LENGTH)
        if (normalizedAction) where.action = normalizedAction

        const normalizedAdminId = normalizeAdminId(adminId)
        if (normalizedAdminId !== null) where.admin_id = normalizedAdminId

        const safeLimit = normalizeLimit(limit)
        const safeOffset = normalizeOffset(offset)

        const result = await model.findAndCountAll({
            where,
            order: [['created_at', 'DESC'], ['id', 'DESC']],
            limit: safeLimit,
            offset: safeOffset
        })

        const rows = Array.isArray(result?.rows) ? result.rows : []
        const total = Array.isArray(result?.count)
            ? result.count.length
            : (Number(result?.count) || 0)

        return {
            items: rows.map(mapAuditRow),
            total,
            limit: safeLimit,
            offset: safeOffset
        }
    }
}

export const listAdminActions = createAdminAuditLister()
