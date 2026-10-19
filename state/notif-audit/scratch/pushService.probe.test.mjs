// Scratch probe (audit only). Run from Backend/:
//   node --test ../state/notif-audit/scratch/pushService.probe.test.mjs
// Uses the real Backend/services/pushService.js, stubbing the singleton
// web-push object method and fake subscription rows (no DB / no network).
import test from 'node:test'
import assert from 'node:assert/strict'
// Same CJS module instance that pushService.js imports as 'web-push'
// (ESM/CJS cache is keyed by resolved file URL, so mutating this object is
// visible inside pushService).
import webpush from '../../../Backend/node_modules/web-push/src/index.js'
import pushService from '../../../Backend/services/pushService.js'

function fakeSub(endpoint, { destroyThrows = false } = {}) {
    return {
        endpoint,
        p256dh: 'x',
        auth: 'y',
        destroyed: false,
        async destroy() {
            if (destroyThrows) throw new Error('DB down while deleting stale subscription')
            this.destroyed = true
        }
    }
}

function errWithStatus(statusCode) {
    const error = new Error(`push failed with ${statusCode}`)
    error.statusCode = statusCode
    return error
}

function installStub(behavior) {
    const calls = []
    webpush.sendNotification = async (subscription, payload, options) => {
        calls.push({ subscription, payload, options })
        const outcome = behavior(subscription.endpoint)
        if (outcome) throw outcome
        return { statusCode: 201, body: '', headers: {} }
    }
    return calls
}

test('only 410 removes a subscription; 400/401/403/413/429/500 are kept and retried forever', async () => {
    const subs = [
        fakeSub('https://fcm.googleapis.com/dead-410'),
        fakeSub('https://fcm.googleapis.com/bad-400'),
        fakeSub('https://fcm.googleapis.com/auth-401'),
        fakeSub('https://fcm.googleapis.com/forbidden-403'),
        fakeSub('https://fcm.googleapis.com/too-large-413'),
        fakeSub('https://fcm.googleapis.com/rate-429'),
        fakeSub('https://fcm.googleapis.com/server-500'),
        fakeSub('https://fcm.googleapis.com/ok')
    ]
    installStub(endpoint => {
        if (endpoint.endsWith('dead-410')) return errWithStatus(410)
        if (endpoint.endsWith('bad-400')) return errWithStatus(400)
        if (endpoint.endsWith('auth-401')) return errWithStatus(401)
        if (endpoint.endsWith('forbidden-403')) return errWithStatus(403)
        if (endpoint.endsWith('too-large-413')) return errWithStatus(413)
        if (endpoint.endsWith('rate-429')) return errWithStatus(429)
        if (endpoint.endsWith('server-500')) return errWithStatus(500)
        return null
    })

    const result = await pushService.sendToSubscriptions(
        subs, 'title', 'body', '/icons/icon-192.png', { url: '/home' }
    )

    assert.deepEqual(
        { total: result.total, sent: result.sent, failed: result.failed, removed: result.removed },
        { total: 8, sent: 1, failed: 7, removed: 1 }
    )
    assert.equal(subs[0].destroyed, true, '410 subscription must be deleted')
    assert.equal(subs[1].destroyed, false, '400 is not treated as terminal')
})

test('same 400 endpoint is re-attempted on every send: no backoff, no quarantine, no state', async () => {
    const sub = fakeSub('https://fcm.googleapis.com/bad-400')
    const calls = installStub(() => errWithStatus(400))
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await pushService.sendToSubscriptions([sub], 'title', 'body')
    }
    assert.equal(calls.length, 3)
    assert.equal(sub.destroyed, false)
})

test('DB failure during stale-subscription cleanup aborts the whole batch', async () => {
    const subs = [
        fakeSub('https://fcm.googleapis.com/ok-1'),
        fakeSub('https://fcm.googleapis.com/dead-410', { destroyThrows: true }),
        fakeSub('https://fcm.googleapis.com/ok-2')
    ]
    installStub(endpoint => endpoint.endsWith('dead-410') ? errWithStatus(410) : null)
    await assert.rejects(
        () => pushService.sendToSubscriptions(subs, 'title', 'body'),
        /DB down while deleting stale subscription/
    )
    // Third subscription was never attempted and no result object is returned:
    // already-delivered pushes can no longer be booked in push_broadcasts.
})

test('failed sends are sequential: total wall time is bounded by N * 10s timeout', async () => {
    const subs = [
        fakeSub('https://fcm.googleapis.com/slow-1'),
        fakeSub('https://fcm.googleapis.com/slow-2')
    ]
    const order = []
    webpush.sendNotification = async subscription => {
        order.push(subscription.endpoint)
        await new Promise(resolve => setTimeout(resolve, 25))
        const error = new Error('Socket timeout')
        throw error
    }
    const started = Date.now()
    const result = await pushService.sendToSubscriptions(subs, 'title', 'body')
    const elapsed = Date.now() - started
    assert.deepEqual(order, [
        'https://fcm.googleapis.com/slow-1',
        'https://fcm.googleapis.com/slow-2'
    ], 'sends are strictly sequential (no concurrency limit/worker pool)')
    assert.ok(elapsed >= 50, `sequential delay observed: ${elapsed}ms`)
    assert.equal(result.failed, 2)
})

test('payload shape: icon/badge/data reach web-push; timeout=10s', async () => {
    const sub = fakeSub('https://fcm.googleapis.com/ok')
    const calls = installStub(() => null)
    await pushService.sendToSubscriptions([sub], 'T', 'B', '/custom.png', { url: '/plants/1' })
    const payload = JSON.parse(calls[0].payload)
    assert.equal(payload.icon, '/custom.png')
    assert.equal(payload.badge, '/icons/icon-192.png')
    assert.deepEqual(payload.data, { url: '/plants/1' })
    assert.equal(calls[0].options.timeout, 10_000)
})
