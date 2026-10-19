import test from 'node:test'
import assert from 'node:assert/strict'
import webpush from 'web-push'

const vapidKeys = webpush.generateVAPIDKeys()
process.env.VAPID_SUBJECT = 'mailto:push-tests@example.com'
process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey

const {
    classifyPushError,
    endpointFingerprint,
    buildPushPayload,
    getPushStatus,
    mapWithConcurrency,
    MAX_PUSH_PAYLOAD_BYTES,
    default: pushService
} = await import('./pushService.js')

const VALID_P256DH = Buffer.alloc(65, 7).toString('base64url')
const VALID_AUTH = Buffer.alloc(16, 3).toString('base64url')

function fakeSubscription(id, endpoint, overrides = {}) {
    return {
        id,
        user_id: 1,
        endpoint,
        p256dh: VALID_P256DH,
        auth: VALID_AUTH,
        failed_attempts: 0,
        last_error: null,
        last_success_at: null,
        invalidated_at: null,
        invalid_reason: null,
        destroyed: false,
        async update(values) {
            Object.assign(this, values)
        },
        async destroy() {
            this.destroyed = true
        },
        ...overrides
    }
}

function pushError(statusCode, message = `push failed ${statusCode}`) {
    const error = new Error(message)
    if (statusCode !== null) error.statusCode = statusCode
    return error
}

test('classifyPushError: 404/410 expired, 400/401/403/413 invalid, 429/5xx/timeout retryable', () => {
    for (const code of [404, 410]) {
        assert.deepEqual(classifyPushError(pushError(code)).kind, 'expired')
    }
    for (const code of [400, 401, 403, 413]) {
        assert.deepEqual(classifyPushError(pushError(code)).kind, 'invalid')
    }
    for (const code of [429, 500, 502, 503, 504, 408]) {
        assert.deepEqual(classifyPushError(pushError(code)).kind, 'retryable')
    }
    assert.equal(classifyPushError(pushError(null, 'Socket timeout')).kind, 'retryable')
    assert.equal(classifyPushError(pushError(null, 'Socket timeout')).reason, 'timeout')
    assert.equal(classifyPushError(pushError(null, 'getaddrinfo ENOTFOUND')).kind, 'retryable')

    assert.equal(classifyPushError(pushError(422)).kind, 'invalid')
})

test('endpointFingerprint: короткий sha256-префикс, без endpoint в открытом виде', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-endpoint-token'
    const fingerprint = endpointFingerprint(endpoint)
    assert.match(fingerprint, /^[0-9a-f]{12}$/)
    assert.ok(!fingerprint.includes('secret'))
    assert.notEqual(fingerprint, endpointFingerprint(`${endpoint}2`))
    assert.equal(endpointFingerprint(''), 'unknown')
    assert.equal(endpointFingerprint(undefined), 'unknown')
})

test('buildPushPayload: oversized кириллица урезается до лимита', () => {
    const payload = JSON.parse(buildPushPayload(
        'я'.repeat(120),
        'я'.repeat(4000),
        '/icons/icon-192.png',
        { url: '/home' }
    ))
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    assert.ok(bytes <= MAX_PUSH_PAYLOAD_BYTES, `payload ${bytes} > ${MAX_PUSH_PAYLOAD_BYTES}`)
    assert.ok(payload.body.length < 4000, 'body must be truncated')
    assert.deepEqual(payload.data, { url: '/home' })
})

test('buildPushPayload: обычный payload не меняется', () => {
    const raw = buildPushPayload('Заголовок', 'Текст', '/icons/icon-192.png', { url: '/home' })
    const parsed = JSON.parse(raw)
    assert.equal(parsed.title, 'Заголовок')
    assert.equal(parsed.body, 'Текст')
    assert.equal(parsed.badge, '/icons/icon-192.png')
    assert.deepEqual(parsed.data, { url: '/home' })
})

test('sendToSubscriptions: политика ошибок, карантин, удаление 410', async () => {
    const subscriptions = [
        fakeSubscription(1, 'https://fcm.googleapis.com/fcm/send/ok-1'),
        fakeSubscription(2, 'https://fcm.googleapis.com/fcm/send/expired-410'),
        fakeSubscription(3, 'https://fcm.googleapis.com/fcm/send/invalid-400'),
        fakeSubscription(4, 'https://fcm.googleapis.com/fcm/send/retry-500'),
        fakeSubscription(5, 'https://fcm.googleapis.com/fcm/send/retry-500-last', {
            failed_attempts: 4
        }),
        fakeSubscription(6, 'http://not-a-push-host.example.com/endpoint')
    ]

    webpush.sendNotification = async subscription => {
        const { endpoint } = subscription
        if (endpoint.includes('expired-410')) throw pushError(410)
        if (endpoint.includes('invalid-400')) throw pushError(400)
        if (endpoint.includes('retry-500')) throw pushError(500)
        return { statusCode: 201, body: '', headers: {} }
    }

    const result = await pushService.sendToSubscriptions(
        subscriptions,
        'Заголовок',
        'Текст',
        '/icons/icon-192.png',
        { url: '/home' }
    )

    assert.equal(result.total, 6)
    assert.equal(result.sent, 1)
    assert.equal(result.failed, 5)
    assert.equal(result.removed, 1)
    assert.equal(result.quarantined, 3)

    assert.equal(subscriptions[0].failed_attempts, 0)
    assert.ok(subscriptions[0].last_success_at instanceof Date)

    assert.equal(subscriptions[1].destroyed, true, '410 -> destroy')

    assert.ok(subscriptions[2].invalidated_at instanceof Date, '400 -> quarantine')
    assert.equal(subscriptions[2].invalid_reason, 'http_400')

    assert.equal(subscriptions[3].invalidated_at, null, '500 first attempt stays retryable')
    assert.equal(subscriptions[3].failed_attempts, 1)
    assert.ok(subscriptions[3].last_error)

    assert.ok(subscriptions[4].invalidated_at instanceof Date, '5 failures -> quarantine')
    assert.equal(subscriptions[4].invalid_reason, 'quarantine_after_5_failures')

    assert.ok(subscriptions[5].invalidated_at instanceof Date, 'invalid subscription quarantined')
})

test('sendToSubscriptions: успех сбрасывает failed_attempts и сохраняет last_success_at', async () => {
    const subscription = fakeSubscription(10, 'https://fcm.googleapis.com/fcm/send/recover', {
        failed_attempts: 3,
        last_error: 'old error'
    })
    webpush.sendNotification = async () => ({ statusCode: 201, body: '', headers: {} })

    const result = await pushService.sendToSubscriptions([subscription], 'T', 'B')
    assert.equal(result.sent, 1)
    assert.equal(subscription.failed_attempts, 0)
    assert.equal(subscription.last_error, null)
    assert.ok(subscription.last_success_at instanceof Date)
})

test('sendToSubscriptions: невалидные/карантинные подписки не отправляются', async () => {
    const invalidated = fakeSubscription(20, 'https://fcm.googleapis.com/fcm/send/old', {
        invalidated_at: new Date(),
        invalid_reason: 'http_410'
    })
    let calls = 0
    webpush.sendNotification = async () => {
        calls += 1
        return { statusCode: 201, body: '', headers: {} }
    }
    const result = await pushService.sendToSubscriptions([invalidated], 'T', 'B')
    assert.equal(calls, 0)
    assert.equal(result.sent, 0)
    assert.equal(result.total, 0)
})

test('mapWithConcurrency: не превышает лимит и сохраняет порядок результатов', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async item => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active -= 1
        return item * 2
    })
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14])
    assert.ok(peak <= 3, `peak concurrency ${peak}`)
})

test('getPushStatus: конфигурация валидна при тестовых VAPID-ключах', () => {
    const status = getPushStatus()
    assert.equal(status.configured, true)
    assert.equal(status.valid, true)
})
