import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidPushSubscription } from './pushValidation.js'

const validSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/example',
    keys: {
        p256dh: Buffer.alloc(65, 1).toString('base64url'),
        auth: Buffer.alloc(16, 2).toString('base64url')
    }
}

test('accepts valid browser push subscriptions from supported services', () => {
    assert.equal(isValidPushSubscription(validSubscription), true)
    assert.equal(isValidPushSubscription({
        ...validSubscription,
        endpoint: 'https://updates.push.services.mozilla.com/wpush/example'
    }), true)
})

test('rejects unsafe endpoints and malformed encryption keys', () => {
    assert.equal(isValidPushSubscription({
        ...validSubscription,
        endpoint: 'http://fcm.googleapis.com/fcm/send/example'
    }), false)
    assert.equal(isValidPushSubscription({
        ...validSubscription,
        endpoint: 'https://127.0.0.1/internal'
    }), false)
    assert.equal(isValidPushSubscription({
        ...validSubscription,
        endpoint: 'https://fcm.googleapis.com:8443/send/example'
    }), false)
    assert.equal(isValidPushSubscription({
        ...validSubscription,
        keys: { ...validSubscription.keys, auth: 'invalid' }
    }), false)
})
