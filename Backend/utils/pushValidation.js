const ALLOWED_PUSH_HOSTS = [
    'fcm.googleapis.com',
    'fcm.googleapis.cn',
    'web.push.apple.com',
    'push.services.mozilla.com',
    'push.services.mozilla.org',
    'notify.windows.com'
]

function isAllowedPushHost(hostname) {
    return ALLOWED_PUSH_HOSTS.some(host =>
        hostname === host || hostname.endsWith(`.${host}`)
    )
}

function decodeBase64Url(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null
    return Buffer.from(value, 'base64url')
}

export function isValidPushSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object') return false
    const { endpoint, keys } = subscription
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return false

    let url
    try {
        url = new URL(endpoint)
    } catch {
        return false
    }
    if (url.protocol !== 'https:' ||
        (url.port && url.port !== '443') ||
        url.username ||
        url.password ||
        !url.pathname ||
        !isAllowedPushHost(url.hostname.toLowerCase())) {
        return false
    }

    const publicKey = decodeBase64Url(keys?.p256dh)
    const authSecret = decodeBase64Url(keys?.auth)
    return publicKey?.length === 65 && authSecret?.length === 16
}
