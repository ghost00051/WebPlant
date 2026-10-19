export const MAX_PUSH_ENDPOINT_LENGTH = 2048
export const P256DH_KEY_BYTES = 65
export const AUTH_SECRET_BYTES = 16

const ALLOWED_PUSH_HOSTS = [
    'fcm.googleapis.com',
    'fcm.googleapis.cn',
    'web.push.apple.com',
    'push.services.mozilla.com',
    'push.services.mozilla.org',
    'notify.windows.com'
]

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const CONTROL_OR_WHITESPACE_PATTERN = /[\s\u0000-\u001F\u007F]/
const HTTPS_AUTHORITY_PATTERN = /^https:\/\/([^/?#]+)/i

export function isAllowedPushHost(hostname) {
    return ALLOWED_PUSH_HOSTS.some(host =>
        hostname === host || hostname.endsWith(`.${host}`)
    )
}

function decodeBase64Url(value) {
    if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return null
    return Buffer.from(value, 'base64url')
}

function validateEndpoint(endpoint) {
    if (endpoint === undefined || endpoint === null) return 'endpoint-missing'
    if (typeof endpoint !== 'string' || !endpoint) return 'endpoint-invalid'
    if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) return 'endpoint-too-long'
    if (CONTROL_OR_WHITESPACE_PATTERN.test(endpoint)) return 'endpoint-control-chars'

    let url
    try {
        url = new URL(endpoint)
    } catch {
        return 'endpoint-invalid'
    }
    if (url.protocol !== 'https:') return 'endpoint-protocol'
    if (url.port && url.port !== '443') return 'endpoint-port'
    if (url.username || url.password) return 'endpoint-credentials'
    if (!url.pathname) return 'endpoint-path'

    const hostname = url.hostname.toLowerCase()
    if (!isAllowedPushHost(hostname)) return 'endpoint-host'

    const authorityMatch = HTTPS_AUTHORITY_PATTERN.exec(endpoint)
    const rawHost = authorityMatch
        ? authorityMatch[1].replace(/:\d+$/, '')
        : ''
    if (!rawHost || rawHost !== rawHost.toLowerCase()) return 'endpoint-host-case'

    return null
}

function readSubscriptionKeys(subscription) {
    const keys = subscription.keys
    if (keys !== undefined && keys !== null) {
        if (typeof keys !== 'object' || Array.isArray(keys)) return null
        return { p256dh: keys.p256dh, auth: keys.auth }
    }
    return { p256dh: subscription.p256dh, auth: subscription.auth }
}

function validateKeys(keys) {
    const publicKey = decodeBase64Url(keys?.p256dh)
    if (!publicKey || publicKey.length !== P256DH_KEY_BYTES) return 'p256dh-invalid'
    const authSecret = decodeBase64Url(keys?.auth)
    if (!authSecret || authSecret.length !== AUTH_SECRET_BYTES) return 'auth-invalid'
    return null
}

export function validateSubscriptionForSend(subscription) {
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
        return { ok: false, reason: 'subscription-invalid' }
    }

    const endpointReason = validateEndpoint(subscription.endpoint)
    if (endpointReason) return { ok: false, reason: endpointReason }

    const keys = readSubscriptionKeys(subscription)
    if (!keys) return { ok: false, reason: 'keys-invalid' }

    const keysReason = validateKeys(keys)
    if (keysReason) return { ok: false, reason: keysReason }

    return { ok: true }
}

export function isValidPushSubscription(subscription) {
    return validateSubscriptionForSend(subscription).ok
}
