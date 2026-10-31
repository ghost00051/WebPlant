import { API_URL } from './api.js'
import { readLocalConsent } from './cookieConsent.js'
import { COOKIE_CONSENT_SAVED_EVENT } from './cookieConsentSettings.js'


const VISITOR_STORAGE_KEY = 'webplant-visitor-id'
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/
const MAX_VISIT_PATH_LENGTH = 160

// Разумные повторы: сразу после загрузки + до трёх попыток с backoff.
const VISIT_RETRY_DELAYS_MS = [3000, 10000, 30000]
const VISIT_MAX_ATTEMPTS = VISIT_RETRY_DELAYS_MS.length + 1
const VISIT_MAX_RETRY_DELAY_MS = 5 * 60 * 1000

const UTM_STORAGE_KEY = 'webplant-first-touch-utm'
const UTM_PARAMS = [
    ['utm_source', 'source'],
    ['utm_medium', 'medium'],
    ['utm_campaign', 'campaign']
]
const MAX_UTM_LENGTH = 120

let sent = false
let inFlight = false
let attempts = 0
let retryTimer = null
let trackedPath = null
let consentListening = false
// Согласие, подтверждённое событием (например, известно только серверу).
let consentConfirmed = false

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
    if (consentConfirmed) return true
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

/** Задержка перед следующей попыткой: backoff + уважение Retry-After (429). */
export function nextVisitRetryDelay(attempt, retryAfterSeconds) {
    const safeAttempt = Math.max(1, Math.trunc(Number(attempt) || 1))
    const baseDelay = VISIT_RETRY_DELAYS_MS[
        Math.min(safeAttempt - 1, VISIT_RETRY_DELAYS_MS.length - 1)
    ]
    const retryAfterMs = Number(retryAfterSeconds) * 1000
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return Math.min(Math.max(baseDelay, retryAfterMs), VISIT_MAX_RETRY_DELAY_MS)
    }
    return baseDelay
}

/** Повторяем только временные сбои: сеть, 429 и 5xx. Прочие 4xx — окончательный отказ. */
export function isRetryableVisitStatus(status) {
    const code = Number(status)
    if (!Number.isFinite(code) || code <= 0) return true
    return code === 429 || code >= 500
}

function clearRetryTimer() {
    if (retryTimer !== null && typeof window !== 'undefined') {
        try {
            window.clearTimeout(retryTimer)
        } catch {
            // таймер уже мог отработать — это не мешает новой попытке
        }
    }
    retryTimer = null
}

function readRetryAfterSeconds(response) {
    try {
        const raw = response?.headers?.get?.('Retry-After')
        if (!raw) return null
        const seconds = Number(raw)
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null
    } catch {
        return null
    }
}

function scheduleRetry(response) {
    if (typeof window === 'undefined' || sent) return
    if (attempts >= VISIT_MAX_ATTEMPTS) return

    clearRetryTimer()
    const delay = nextVisitRetryDelay(attempts, readRetryAfterSeconds(response))
    retryTimer = window.setTimeout(() => {
        retryTimer = null
        trackVisit()
    }, delay)
}

function sendVisit(visitorId, visitPath) {
    const utm = readFirstTouchUtm()
    const body = JSON.stringify({
        visitorId,
        path: visitPath,
        ...(utm ? { utm } : {})
    })

    return fetch(`${API_URL}/system/visit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body
    })
}

/**
 * Отправляет визит, если пользователь разрешил аналитику.
 * sent выставляется только после успешного ответа, поэтому сеть/429 не «сжигают» визит.
 */
export function trackVisit(path) {
    if (typeof window === 'undefined' || sent || inFlight) return Promise.resolve(false)
    if (!hasAnalyticsConsent()) return Promise.resolve(false)

    const visitorId = getVisitorId()
    if (!visitorId) return Promise.resolve(false)

    if (typeof path === 'string' && !trackedPath) trackedPath = path
    const visitPath = sanitizeVisitPath(trackedPath || path || window.location?.pathname)

    clearRetryTimer()
    inFlight = true
    attempts += 1

    let request
    try {
        request = sendVisit(visitorId, visitPath)
    } catch (error) {
        inFlight = false
        console.warn('Не удалось отправить данные о посещении:', error)
        scheduleRetry(null)
        return Promise.resolve(false)
    }

    return Promise.resolve(request)
        .then(response => {
            inFlight = false
            if (response?.ok) {
                sent = true
                attempts = 0
                return true
            }
            if (isRetryableVisitStatus(response?.status)) scheduleRetry(response)
            return false
        })
        .catch(error => {
            inFlight = false
            console.warn('Не удалось отправить данные о посещении:', error)
            scheduleRetry(null)
            return false
        })
}

function handleConsentSaved(event) {
    const accepted = event?.detail?.analyticsAccepted === true ||
        event?.analyticsAccepted === true
    consentConfirmed = accepted

    if (sent || inFlight) return
    if (!accepted) {
        // Согласие отозвали — снимаем запланированные повторы.
        clearRetryTimer()
        return
    }
    // Согласие могли дать позже — начинаем счётчик попыток заново.
    attempts = 0
    clearRetryTimer()
    trackVisit()
}

function listenForConsentSaved() {
    if (consentListening) return
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return

    consentListening = true
    window.addEventListener(COOKIE_CONSENT_SAVED_EVENT, handleConsentSaved)
}

export function startVisitTracking() {
    if (typeof window === 'undefined') return

    readFirstTouchUtm()
    listenForConsentSaved()
    trackVisit()
}

/** Сбрасывает состояние маяка (используется в тестах). */
export function resetVisitTracking() {
    clearRetryTimer()

    if (consentListening && typeof window !== 'undefined' &&
        typeof window.removeEventListener === 'function') {
        try {
            window.removeEventListener(COOKIE_CONSENT_SAVED_EVENT, handleConsentSaved)
        } catch {
            // старый window мог быть уже недоступен (тесты)
        }
    }

    consentListening = false
    sent = false
    inFlight = false
    attempts = 0
    trackedPath = null
    consentConfirmed = false
}
