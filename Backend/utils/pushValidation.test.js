import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_PUSH_ENDPOINT_LENGTH,
    isAllowedPushHost,
    isValidPushSubscription,
    validateSubscriptionForSend
} from './pushValidation.js'

const P256DH = Buffer.alloc(65, 7).toString('base64url')
const AUTH = Buffer.alloc(16, 9).toString('base64url')
const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'

function subscription(overrides = {}) {
    return {
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: P256DH, auth: AUTH },
        ...overrides
    }
}

function flatSubscription(overrides = {}) {
    return {
        endpoint: FCM_ENDPOINT,
        p256dh: P256DH,
        auth: AUTH,
        ...overrides
    }
}

function endpointOfLength(length) {
    const prefix = 'https://fcm.googleapis.com/fcm/send/'
    return `${prefix}${'a'.repeat(length - prefix.length)}`
}

function expectValid(sub) {
    assert.deepEqual(validateSubscriptionForSend(sub), { ok: true })
    assert.equal(isValidPushSubscription(sub), true)
}

function expectInvalid(sub, reason) {
    const result = validateSubscriptionForSend(sub)
    assert.equal(result.ok, false)
    if (reason) assert.equal(result.reason, reason)
    assert.equal(isValidPushSubscription(sub), false)
}

test('allowlist: принимает известные push-провайдеры и их поддомены', () => {
    const endpoints = [
        'https://fcm.googleapis.com/fcm/send/abc',
        'https://fcm.googleapis.cn/fcm/send/abc',
        'https://web.push.apple.com/QGxhbGxvY2F0aW9u',
        'https://push.services.mozilla.com/wpush/v2/abc',
        'https://push.services.mozilla.org/wpush/v2/abc',
        'https://notify.windows.com/w/?token=abc',
        'https://wns2-by3p.notify.windows.com/w/?token=abc',
        'https://updates.push.services.mozilla.com/wpush/v1/abc'
    ]
    for (const endpoint of endpoints) {
        expectValid(subscription({ endpoint }))
    }
})

test('allowlist: отвергает чужие и похожие хосты', () => {
    const endpoints = [
        'https://example.com/push/abc',
        'https://fcm.googleapis.com.evil.example/fcm/send/abc',
        'https://evil-fcm.googleapis.com/fcm/send/abc',
        'https://localhost/push/abc',
        'https://127.0.0.1/push/abc',
        'https://[::1]/push/abc',
        'https://fcm.googleapis.com./fcm/send/abc',
        'https://notify.windows.com.example/push'
    ]
    for (const endpoint of endpoints) {
        expectInvalid(subscription({ endpoint }), 'endpoint-host')
    }
})

test('endpoint: требует https, стандартный порт и валидный URL', () => {
    expectInvalid(subscription({ endpoint: 'http://fcm.googleapis.com/fcm/send/abc' }), 'endpoint-protocol')
    expectInvalid(subscription({ endpoint: 'javascript:alert(1)' }), 'endpoint-protocol')
    expectInvalid(subscription({ endpoint: 'data:text/html,<script>alert(1)</script>' }), 'endpoint-protocol')
    expectInvalid(subscription({ endpoint: 'ftp://fcm.googleapis.com/fcm/send/abc' }), 'endpoint-protocol')
    expectInvalid(subscription({ endpoint: '/fcm/send/abc' }), 'endpoint-invalid')
    expectInvalid(subscription({ endpoint: 'not a url' }), 'endpoint-control-chars')
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com:8443/fcm/send/abc' }), 'endpoint-port')
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com:80/fcm/send/abc' }), 'endpoint-port')
    expectValid(subscription({ endpoint: 'https://fcm.googleapis.com:443/fcm/send/abc' }))
})

test('endpoint: отвергает credentials в URL, заглавные буквы в хосте и управляющие символы', () => {
    expectInvalid(
        subscription({ endpoint: 'https://user:pass@fcm.googleapis.com/fcm/send/abc' }),
        'endpoint-credentials'
    )
    expectInvalid(
        subscription({ endpoint: 'https://FCM.GOOGLEAPIS.COM/fcm/send/abc' }),
        'endpoint-host-case'
    )
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/a bc' }), 'endpoint-control-chars')
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/a\nb' }), 'endpoint-control-chars')
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/a\tb' }), 'endpoint-control-chars')
    expectInvalid(subscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/a\u0000b' }), 'endpoint-control-chars')
})

test('endpoint: граница длины 2048 символов', () => {
    const atLimit = endpointOfLength(MAX_PUSH_ENDPOINT_LENGTH)
    assert.equal(atLimit.length, MAX_PUSH_ENDPOINT_LENGTH)
    expectValid(subscription({ endpoint: atLimit }))
    expectInvalid(
        subscription({ endpoint: endpointOfLength(MAX_PUSH_ENDPOINT_LENGTH + 1) }),
        'endpoint-too-long'
    )
})

test('endpoint: отсутствует/неверный тип', () => {
    expectInvalid({ keys: { p256dh: P256DH, auth: AUTH } }, 'endpoint-missing')
    expectInvalid(subscription({ endpoint: null }), 'endpoint-missing')
    expectInvalid(subscription({ endpoint: 42 }), 'endpoint-invalid')
    expectInvalid(subscription({ endpoint: '' }), 'endpoint-invalid')
    expectInvalid(subscription({ endpoint: {} }), 'endpoint-invalid')
})

test('keys: принимает вложенную и плоскую формы', () => {
    expectValid(subscription())
    expectValid(flatSubscription())
    expectValid(flatSubscription({ keys: undefined }))
})

test('keys: p256dh ровно 65 байт, auth ровно 16 байт после декодирования', () => {
    expectInvalid(subscription({ keys: { p256dh: Buffer.alloc(64, 7).toString('base64url'), auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: Buffer.alloc(66, 7).toString('base64url'), auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: P256DH, auth: Buffer.alloc(15, 9).toString('base64url') } }), 'auth-invalid')
    expectInvalid(subscription({ keys: { p256dh: P256DH, auth: Buffer.alloc(17, 9).toString('base64url') } }), 'auth-invalid')
})

test('keys: отвергает не-base64url, пустые и нестроковые значения', () => {
    expectInvalid(subscription({ keys: { p256dh: `${P256DH}=`, auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: `${P256DH}+`, auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: `${P256DH}/`, auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: P256DH, auth: '!' } }), 'auth-invalid')
    expectInvalid(subscription({ keys: { p256dh: '', auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: 123, auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { auth: AUTH } }), 'p256dh-invalid')
    expectInvalid(subscription({ keys: { p256dh: P256DH } }), 'auth-invalid')
    expectInvalid(subscription({ keys: 'nope' }), 'keys-invalid')
    expectInvalid(subscription({ keys: [P256DH, AUTH] }), 'keys-invalid')
})

test('отвергает не-объекты и массивы', () => {
    for (const value of [null, undefined, 'endpoint', 42, [], [subscription()]]) {
        const result = validateSubscriptionForSend(value)
        assert.equal(result.ok, false)
        assert.equal(result.reason, 'subscription-invalid')
        assert.equal(isValidPushSubscription(value), false)
    }
})

test('isAllowedPushHost: allowlist по точному хосту и поддомену', () => {
    assert.equal(isAllowedPushHost('fcm.googleapis.com'), true)
    assert.equal(isAllowedPushHost('sub.fcm.googleapis.com'), true)
    assert.equal(isAllowedPushHost('fcm.googleapis.com.evil.example'), false)
    assert.equal(isAllowedPushHost('notfcm.googleapis.com'), false)
    assert.equal(isAllowedPushHost('fcm.googleapis.co'), false)
})

test('isValidPushSubscription совместим по смыслу с прежним API', () => {
    assert.equal(isValidPushSubscription(subscription()), true)
    assert.equal(isValidPushSubscription(subscription({ keys: { p256dh: 'short', auth: 'short' } })), false)
    assert.equal(isValidPushSubscription(null), false)
    assert.equal(isValidPushSubscription(flatSubscription()), true)
})
