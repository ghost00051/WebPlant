export const CONSENT_TYPES = ['technical', 'analytics', 'marketing', 'personalization']
export const CONSENT_VERSION = '1.0'
export const CONSENT_LIFETIME_MS = 6 * 30 * 24 * 60 * 60 * 1000

export const LOCAL_CONSENT_KEY = 'webplant-cookie-consent'

export function readLocalConsent(now = Date.now()) {
    try {
        const raw = window.localStorage.getItem(LOCAL_CONSENT_KEY)
        if (!raw) return null

        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.analyticsAccepted !== 'boolean') return null
        if (parsed.version !== CONSENT_VERSION) return null
        if (!Number.isFinite(parsed.savedAt)) return null
        if (now - parsed.savedAt >= CONSENT_LIFETIME_MS) return null

        return parsed
    } catch (error) {
        console.warn('Не удалось прочитать сохранённый выбор cookie:', error)
        return null
    }
}

export function saveLocalConsent(record) {
    try {
        window.localStorage.setItem(LOCAL_CONSENT_KEY, JSON.stringify(record))
        return record
    } catch (error) {
        console.warn('Не удалось сохранить выбор cookie на устройстве:', error)
        return null
    }
}

export function buildLocalConsent(analyticsAccepted, now = Date.now()) {
    return {
        analyticsAccepted,
        version: CONSENT_VERSION,
        savedAt: now
    }
}

export function summarizeConsents(consents) {
    const latestByType = new Map()
    for (const consent of consents) {
        if (consent && !latestByType.has(consent.consent_type)) {
            latestByType.set(consent.consent_type, consent)
        }
    }

    return {
        known: CONSENT_TYPES.every(type => latestByType.has(type)),
        analyticsAccepted: latestByType.get('analytics')?.is_accepted === true
    }
}
