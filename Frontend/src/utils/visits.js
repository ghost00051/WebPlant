import { API_URL } from './api.js'
import { readLocalConsent } from './cookieConsent.js'


const VISITOR_STORAGE_KEY = 'webplant-visitor-id'
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/
const RETRY_DELAYS_MS = [3000, 10000, 30000]
const MAX_VISIT_PATH_LENGTH = 160

const UTM_STORAGE_KEY = 'webplant-first-touch-utm'
const UTM_PARAMS = [
    ['utm_source', 'source'],
    ['utm_medium', 'medium'],
    ['utm_campaign', 'campaign']
]
const MAX_UTM_LENGTH = 120

let sent = false
let retryTimers = []

function sanitizeVisitPath(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return '/'
    const withoutFragment = rawPath.split('#')[0]
    const pathname = withoutFragment.split('?')[0]
    if (!pathname) return '/'
    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
    return normalized.slice(0, MAX_VISIT_PATH_LENGTH) || '/'
}

export function getVisitorId() {
    try {
        const stored = window.localStorage.getItem(VISITOR_STORAGE_KEY)
        if (stored && VISITOR_ID_PATTERN.test(stored)) return stored

        const generated = typeof window.crypto?.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
        window.localStorage.setItem(VISITOR_STORAGE_KEY, generated)
        return generated
    } catch (error) {
        console.warn('Не удалось получить идентификатор посетителя:', error)
        return null
    }
}

function hasAnalyticsConsent() {
    if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return false
    return readLocalConsent()?.analyticsAccepted === true
}

function stripControlChars(value) {
    let output = ''
    for (const char of String(value)) {
        const code = char.charCodeAt(0)
        if (code >= 32 && code !== 127) output += char
    }
    return output
}

function sanitizeUtmValue(rawValue) {
    if (typeof rawValue !== 'string') return ''
    const cleaned = stripControlChars(rawValue).trim()
    return cleaned.slice(0, MAX_UTM_LENGTH)
}

function readStoredUtm() {
    try {
        const raw = window.sessionStorage.getItem(UTM_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null

        const utm = {}
        for (const [, key] of UTM_PARAMS) {
            const value = sanitizeUtmValue(parsed[key])
            if (value) utm[key] = value
        }
        return Object.keys(utm).length ? utm : null
    } catch {
        return null
    }
}

export function readFirstTouchUtm() {
    if (typeof window === 'undefined') return null

    const stored = readStoredUtm()
    if (stored) return stored

    try {
        const params = new URLSearchParams(window.location?.search || '')
        const collected = {}
        for (const [param, key] of UTM_PARAMS) {
            const value = sanitizeUtmValue(params.get(param) || '')
            if (value) collected[key] = value
        }
        if (!Object.keys(collected).length) return null

        try {
            window.sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(collected))
        } catch {
            // sessionStorage может быть недоступен — метка всё равно уйдёт в этом визите.
        }
        return collected
    } catch {
        return null
    }
}

function clearRetries() {
    for (const timer of retryTimers) window.clearTimeout(timer)
    retryTimers = []
}

export function trackVisit(path) {
    if (sent || typeof window === 'undefined') return
    if (!hasAnalyticsConsent()) return

    const visitorId = getVisitorId()
    if (!visitorId) return

    sent = true
    clearRetries()

    const utm = readFirstTouchUtm()
    const body = JSON.stringify({
        visitorId,
        path: sanitizeVisitPath(path || window.location.pathname),
        ...(utm ? { utm } : {})
    })

    try {
        fetch(`${API_URL}/system/visit`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body
        }).catch(() => {
        })
    } catch (error) {
        console.warn('Не удалось отправить данные о посещении:', error)
    }
}

export function startVisitTracking() {
    readFirstTouchUtm()
    trackVisit()
    if (sent) return

    retryTimers = RETRY_DELAYS_MS.map(delay => window.setTimeout(() => {
        trackVisit()
    }, delay))
}
