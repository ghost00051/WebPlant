import assert from 'node:assert/strict'
import test from 'node:test'
import PushSubscription from '../models/PushSubscription.js'

const { default: pushController } = await import('./pushController.js')
const originalDestroy = PushSubscription.destroy

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(statusCode) {
            this.statusCode = statusCode
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

test.after(() => {
    PushSubscription.destroy = originalDestroy
})

test('unsubscribe only removes the authenticated user subscription', async () => {
    let query
    PushSubscription.destroy = async options => {
        query = options
        return 1
    }
    const res = createResponse()

    await pushController.unsubscribe({
        user: { id: 42 },
        body: { endpoint: 'https://fcm.googleapis.com/example' }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(query.where, {
        endpoint: 'https://fcm.googleapis.com/example',
        user_id: 42
    })
})

test('unsubscribe rejects a missing endpoint without querying subscriptions', async () => {
    let queried = false
    PushSubscription.destroy = async () => {
        queried = true
    }
    const res = createResponse()

    await pushController.unsubscribe({ user: { id: 42 }, body: {} }, res)

    assert.equal(res.statusCode, 400)
    assert.equal(queried, false)
})
