import { API_URL } from './api.js'
import { readLocalConsent } from './cookieConsent.js'


const VISITOR_STORAGE_KEY = 'webplant-visitor-id'
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/
const RETRY_DELAYS_MS = [3000, 10000, 30000]

let sent = false
let retryTimers = []

function readVisitorId() {
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

function clearRetries() {
    for (const timer of retryTimers) window.clearTimeout(timer)
    retryTimers = []
}

export function trackVisit(path) {
    if (sent || typeof window === 'undefined') return
    if (!hasAnalyticsConsent()) return

    const visitorId = readVisitorId()
    if (!visitorId) return

    sent = true
    clearRetries()

    const body = JSON.stringify({
        visitorId,
        path: path || `${window.location.pathname}${window.location.search}`.slice(0, 300)
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
    trackVisit()
    if (sent) return

    retryTimers = RETRY_DELAYS_MS.map(delay => window.setTimeout(() => {
        trackVisit()
    }, delay))
}
