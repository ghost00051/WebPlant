export const COOKIE_SETTINGS_EVENT = 'webplant:cookie-consent-settings'

export function openCookieConsentSettings() {
    if (typeof window === 'undefined') return

    try {
        window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))
    } catch (error) {
        console.warn('Не удалось открыть настройки cookie:', error)
    }
}
