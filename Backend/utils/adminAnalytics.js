
export const TIMEZONE = 'Europe/Moscow'

export const DEFAULT_RANGE_DAYS = 30
export const MAX_RANGE_DAYS = 365

export const DEFAULT_PAGE_LIMIT = 25
export const MAX_PAGE_LIMIT = 200
export const MAX_SEARCH_LENGTH = 100
export const MAX_PAGE_NUMBER = 100000

export const LOCAL_DAY_SQL = expression =>
    `((${expression}) AT TIME ZONE '${TIMEZONE}')::date`

export const LOCAL_TIMESTAMP_SQL = expression =>
    `((${expression}) AT TIME ZONE '${TIMEZONE}')`

export function userCreatedAtSql(hasCreatedAtColumn) {
    if (hasCreatedAtColumn) return 'u.created_at'
    return `(
        SELECT MIN(lc.accepted_at)
        FROM user_legal_consents lc
        WHERE lc.user_id = u.id AND lc.source = 'registration'
    )`
}

export function parseRangeDays(value, {
    fallback = DEFAULT_RANGE_DAYS,
    max = MAX_RANGE_DAYS
} = {}) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) return null
    return parsed
}

export function parsePagination(query = {}, {
    defaultLimit = DEFAULT_PAGE_LIMIT,
    maxLimit = MAX_PAGE_LIMIT
} = {}) {
    const rawPage = query.page
    const rawLimit = query.limit

    let page = 1
    if (rawPage !== undefined && rawPage !== null && rawPage !== '') {
        if (typeof rawPage !== 'string' || !/^\d{1,7}$/.test(rawPage)) return null
        page = Number(rawPage)
        if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE_NUMBER) return null
    }

    let limit = defaultLimit
    if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
        if (typeof rawLimit !== 'string' || !/^\d{1,4}$/.test(rawLimit)) return null
        limit = Number(rawLimit)
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) return null
    }

    return { page, limit, offset: (page - 1) * limit }
}

export function parseSearch(value, { maxLength = MAX_SEARCH_LENGTH } = {}) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') return null
    if (Array.from(value).length > maxLength) return null
    return value.trim()
}

export function escapeLike(value) {
    return String(value).replace(/[\\%_]/g, match => `\\${match}`)
}

export function parseOptionalId(value) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) return null
    return parsed
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function isValidDay(value) {
    if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false
    const [year, month, day] = value.split('-').map(Number)
    if (month < 1 || month > 12 || day < 1 || day > 31) return false
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
}

export function parseDay(value) {
    if (value === undefined || value === null || value === '') return undefined
    return isValidDay(value) ? value : null
}

export function buildDayList(startDay, endDay) {
    if (!isValidDay(startDay) || !isValidDay(endDay)) return []
    const days = []
    const cursor = new Date(`${startDay}T00:00:00Z`)
    const last = new Date(`${endDay}T00:00:00Z`)
    if (cursor > last) return []
    while (cursor <= last) {
        days.push(cursor.toISOString().slice(0, 10))
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return days
}

function toDayString(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === 'string') return value.slice(0, 10)
    return String(value ?? '')
}

function toNumber(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeSeries(rows, dayList, fields) {
    const pairs = Array.isArray(fields)
        ? fields.map(key => [key, key])
        : Object.entries(fields || {})

    const byDay = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
        byDay.set(toDayString(row?.day), row)
    }

    return dayList.map(day => {
        const source = byDay.get(day) || {}
        const point = { date: day }
        for (const [key, column] of pairs) {
            point[key] = toNumber(source[column])
        }
        return point
    })
}

export function sumSeries(points, key) {
    return (Array.isArray(points) ? points : [])
        .reduce((total, point) => total + toNumber(point?.[key]), 0)
}

export function deviceFromUserAgent(userAgent) {
    const value = typeof userAgent === 'string' ? userAgent.toLowerCase() : ''
    if (!value) return 'unknown'
    if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(value)) return 'tablet'
    if (/mobi|iphone|ipod|android|windows phone|opera mini/.test(value)) return 'mobile'
    return 'desktop'
}

const VISITOR_ID = /^[A-Za-z0-9._:-]{8,64}$/

export function parseVisitorId(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return VISITOR_ID.test(trimmed) ? trimmed : null
}

export function parseVisitPath(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed.startsWith('/') || trimmed.length > 300) return null
    if (/[\s<>"']/.test(trimmed)) return null
    return trimmed
}

export function parseReferrerHost(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null
    try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        const host = url.hostname.toLowerCase()
        if (!host || host.length > 255) return null
        return host
    } catch {
        return null
    }
}

export function parseSort(value, allowed, fallback) {
    if (typeof value !== 'string' || !value) return fallback
    return allowed.includes(value) ? value : fallback
}

export function parseOrder(value, fallback = 'desc') {
    if (value === 'asc') return 'asc'
    if (value === 'desc') return 'desc'
    return fallback
}

const ROLE_VALUES = ['USER', 'ADMIN']
const PRIVILEGE_VALUES = ['free', 'premium', 'pro']

export function isValidRole(value) {
    return ROLE_VALUES.includes(value)
}

export function isValidPrivilegeLevel(value) {
    return PRIVILEGE_VALUES.includes(value)
}
