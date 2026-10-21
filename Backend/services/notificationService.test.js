import test from 'node:test'
import assert from 'node:assert/strict'

import {
    clampNotificationText,
    NOTIFICATION_BODY_MAX_LENGTH,
    NOTIFICATION_TITLE_MAX_LENGTH,
    sendNotificationPush
} from './notificationService.js'
import pushService from './pushService.js'

function stubPush(handler) {
    const original = pushService.sendToUser
    pushService.sendToUser = handler
    return () => {
        pushService.sendToUser = original
    }
}

test('sendNotificationPush: успешная отправка — одна попытка', async () => {
    let calls = 0
    const restore = stubPush(async () => {
        calls += 1
        return { success: true, total: 1, sent: 1, failed: 0, removed: 0 }
    })
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(calls, 1)
        assert.equal(result.sent, 1)
    } finally {
        restore()
    }
})

test('sendNotificationPush: transient-сбой — ровно одна повторная попытка', async () => {
    let calls = 0
    const restore = stubPush(async () => {
        calls += 1
        return calls === 1
            ? { success: false, total: 1, sent: 0, failed: 1, removed: 0 }
            : { success: true, total: 1, sent: 1, failed: 0, removed: 0 }
    })
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(calls, 2)
        assert.equal(result.sent, 1)
    } finally {
        restore()
    }
})

test('sendNotificationPush: нет подписок — не ошибка и не ретрай', async () => {
    let calls = 0
    const restore = stubPush(async () => {
        calls += 1
        return { success: false, total: 0, sent: 0, failed: 0, removed: 0 }
    })
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(calls, 1)
        assert.equal(result.sent, 0)
    } finally {
        restore()
    }
})

test('sendNotificationPush: исключение не пробрасывается наружу', async () => {
    const restore = stubPush(async () => {
        throw new Error('boom')
    })
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(result, null)
    } finally {
        restore()
    }
})

test('sendNotificationPush: валидирует userId', async () => {
    await assert.rejects(
        () => sendNotificationPush({ userId: 0, title: 't', body: 'b' }),
        TypeError
    )
})

test('clampNotificationText: title <= 120, body <= 1000', () => {
    const clamped = clampNotificationText({
        title: 'т'.repeat(400),
        body: 'б'.repeat(4000)
    })
    assert.ok(clamped.title.length <= NOTIFICATION_TITLE_MAX_LENGTH)
    assert.ok(clamped.body.length <= NOTIFICATION_BODY_MAX_LENGTH)
    assert.deepEqual(
        clampNotificationText({ title: 'ok', body: 'ok' }),
        { title: 'ok', body: 'ok' }
    )
})
