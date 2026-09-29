export function getConsentState(consent, now = new Date()) {
    const isExpired = Boolean(consent?.expires_at && new Date(consent.expires_at) <= now)
    return {
        hasConsent: Boolean(consent?.is_accepted && !consent.is_revoked && !isExpired),
        isExpired
    }
}
