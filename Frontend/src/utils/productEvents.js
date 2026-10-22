import { API_URL } from './api.js'
import { readLocalConsent } from './cookieConsent.js'
import { getVisitorId } from './visits.js'

export const ALLOWED_PRODUCT_EVENTS = Object.freeze([
    'landing_view',
    'register',
    'plant_created',
    'watering_marked',
    'push_subscribed',
    'chat_message',
    'photo_added',
    'plant_id_started',
    'plant_id_success',
    'share_clicked'
])

const ALLOWED_EVENTS = new Set(ALLOWED_PRODUCT_EVENTS)

const MAX_BATCH_SIZE = 10
const MAX_BUFFER_SIZE = 50
const FLUSH_INTERVAL_MS = 5000
const MAX_PROPERTIES_BYTES = 2048
const MAX_PROPERTY_KEYS = 12
const MAX_PROPERTY_KEY_LENGTH = 40
const MAX_PROPERTY_STRING_LENGTH = 120
const MAX_PATH_LENGTH = 300
const DUPLICATE_WINDOW_MS = 1000

const ONCE_STORAGE_PREFIX = 'webplant-event-tracked-'
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE_LIKE = /^\+?[\d\s()-]{7,}$/
const FORBIDDEN_KEY = /(^|_)(email|e_mail|phone|password|passwd|token|secret|auth|hash|name|username|plantname|species_name|text|message|note|address)(_|$)|email|phone|password|token|secret/i

const buffer = []
const recentSignatures = new Map()
let flushTimer = null
let lifecycleBound = false

function hasAnalyticsConsent() {
    if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return false
    try {
        return readLocalConsent()?.analyticsAccepted === true
    } catch {
        return false
    }
}

function stripControlChars(value) {
    let output = ''
    for (const char of String(value)) {
        const code = char.charCodeAt(0)
        if (code >= 32 && code !== 127) output += char
    }
    return output
}

function sanitizeString(value, maxLength = MAX_PROPERTY_STRING_LENGTH) {
    const cleaned = stripControlChars(value).trim()
    if (!cleaned) return ''
    if (EMAIL_LIKE.test(cleaned)) return ''
    if (PHONE_LIKE.test(cleaned)) return ''
    return cleaned.slice(0, maxLength)
}

function sanitizeValue(value) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }
    if (typeof value === 'string') {
        const cleaned = sanitizeString(value)
        return cleaned || undefined
    }
    return undefined
}

function sanitizeProps(rawProps) {
    if (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps)) return {}

    const result = {}
    let accepted = 0
    for (const [key, value] of Object.entries(rawProps)) {
        if (accepted >= MAX_PROPERTY_KEYS) break
        if (typeof key !== 'string' || !key) continue
        if (key.length > MAX_PROPERTY_KEY_LENGTH) continue
        if (FORBIDDEN_KEY.test(key)) continue

        const clean = sanitizeValue(value)
        if (clean === undefined) continue
        result[key] = clean
        accepted += 1
    }

    try {
        if (JSON.stringify(result).length > MAX_PROPERTIES_BYTES) return {}
    } catch {
        return {}
    }
    return result
}

function sanitizeEventPath() {
    try {
        if (typeof window === 'undefined' || !window.location) return '/'
        const rawPath = String(window.location.pathname || '/')
        const pathname = rawPath.split('#')[0].split('?')[0] || '/'
        const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
        return normalized.slice(0, MAX_PATH_LENGTH) || '/'
    } catch {
        return '/'
    }
}

function clearFlushTimer() {
    if (flushTimer === null) return
    try {
        window.clearTimeout(flushTimer)
    } catch {
        /* no-op */
    }
    flushTimer = null
}

function scheduleFlush() {
    if (flushTimer !== null) return
    try {
        flushTimer = window.setTimeout(() => {
            flushTimer = null
            flushProductEvents()
        }, FLUSH_INTERVAL_MS)
    } catch {
        flushTimer = null
    }
}

function bindLifecycleListeners() {
    if (lifecycleBound || typeof window === 'undefined') return
    lifecycleBound = true
    try {
        window.addEventListener('pagehide', flushProductEvents)
        window.addEventListener('beforeunload', flushProductEvents)
    } catch {
        /* no-op */
    }
    try {
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flushProductEvents()
            })
        }
    } catch {
        /* no-op */
    }
}

function sendBatch(events, visitorId) {
    const payload = { events }
    if (visitorId) payload.visitorId = visitorId

    try {
        const request = fetch(`${API_URL}/events`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify(payload)
        })
        if (request && typeof request.catch === 'function') request.catch(() => { })
    } catch {
        // Сеть/политика браузера недоступны — тихо теряем батч, аналитика не критична.
    }
}


export function flushProductEvents() {
    clearFlushTimer()
    if (!buffer.length) return

    if (!hasAnalyticsConsent()) {
        buffer.length = 0
        return
    }

    const visitorId = getVisitorId()
    if (!visitorId) {
        buffer.length = 0
        return
    }

    while (buffer.length) {
        const batch = buffer.splice(0, MAX_BATCH_SIZE)
        if (!batch.length) break
        sendBatch(batch, visitorId)
    }
}

function rememberSignature(signature) {
    const now = Date.now()
    recentSignatures.set(signature, now)
    if (recentSignatures.size <= 40) return
    for (const [key, savedAt] of recentSignatures) {
        if (now - savedAt > DUPLICATE_WINDOW_MS) recentSignatures.delete(key)
    }
}

function isDuplicate(signature) {
    const savedAt = recentSignatures.get(signature)
    if (savedAt === undefined) return false
    const fresh = Date.now() - savedAt <= DUPLICATE_WINDOW_MS
    if (!fresh) recentSignatures.delete(signature)
    return fresh
}

/**
 * 
 * @param {string} name 
 * @param {Record<string, string|number|boolean>|undefined} props 
 * @returns {boolean} 
 */
export function trackEvent(name, props) {
    if (typeof window === 'undefined') return false
    if (typeof name !== 'string' || !ALLOWED_EVENTS.has(name)) return false
    if (!hasAnalyticsConsent()) return false

    const entry = {
        event: name,
        props: sanitizeProps(props),
        path: sanitizeEventPath()
    }

    const signature = `${name}|${entry.path}|${JSON.stringify(entry.props)}`
    if (isDuplicate(signature)) return false
    rememberSignature(signature)

    buffer.push(entry)
    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.splice(0, buffer.length - MAX_BUFFER_SIZE)
    }

    bindLifecycleListeners()

    if (buffer.length >= MAX_BATCH_SIZE) flushProductEvents()
    else scheduleFlush()

    return true
}


export function trackEventOnce(name, props) {
    if (typeof window === 'undefined') return false

    const storageKey = `${ONCE_STORAGE_PREFIX}${name}`
    try {
        if (window.sessionStorage.getItem(storageKey) === '1') return false
    } catch {
        // sessionStorage недоступен — сработает защита от дублей внутри загрузки.
    }

    const accepted = trackEvent(name, props)
    if (!accepted) return false

    try {
        window.sessionStorage.setItem(storageKey, '1')
    } catch {
        // ignore
    }
    return true
}
