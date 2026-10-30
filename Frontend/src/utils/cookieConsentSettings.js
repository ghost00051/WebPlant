export const COOKIE_SETTINGS_EVENT = 'webplant:cookie-consent-settings'
export const COOKIE_CONSENT_SAVED_EVENT = 'webplant:cookie-consent-saved'

export function openCookieConsentSettings() {
    if (typeof window === 'undefined') return

    try {
        window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))
    } catch (error) {
        console.warn('Не удалось открыть настройки cookie:', error)
    }
}

/**
 * Сообщает слушателям (в том числе маяку посещений), что выбор cookie сохранён.
 * Лёгкое событие без зависимостей: визит уходит сразу после позднего согласия.
 */
export function notifyCookieConsentSaved(analyticsAccepted) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return

    const accepted = analyticsAccepted === true
    try {
        if (typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new window.CustomEvent(COOKIE_CONSENT_SAVED_EVENT, {
                detail: { analyticsAccepted: accepted }
            }))
            return
        }

        const event = new Event(COOKIE_CONSENT_SAVED_EVENT)
        event.analyticsAccepted = accepted
        window.dispatchEvent(event)
    } catch (error) {
        console.warn('Не удалось оповестить о сохранении согласия cookie:', error)
    }
}
