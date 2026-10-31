import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
    clampNotificationText,
    NOTIFICATION_BODY_MAX_LENGTH,
    NOTIFICATION_TITLE_MAX_LENGTH,
    resolveNotificationDeliveryUrl,
    sendNotificationPush
} from './notificationService.js'
import pushService from './pushService.js'
import { messengerDelivery } from './botChannelService.js'

const originalMessengerDeliver = messengerDelivery.deliver
let deliveryCalls = []
let deliveryOutcome = { delivered: 1, failed: 0 }

beforeEach(() => {
    deliveryCalls = []
    messengerDelivery.deliver = async payload => {
        deliveryCalls.push(payload)
        if (deliveryOutcome instanceof Error) throw deliveryOutcome
        return deliveryOutcome
    }
})

afterEach(() => {
    messengerDelivery.deliver = originalMessengerDeliver
    deliveryOutcome = { delivered: 1, failed: 0 }
})

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

test('sendNotificationPush: после push доставляет в мессенджеры, kind из data.tag', async () => {
    const restore = stubPush(async () => ({ success: true, total: 1, sent: 1, failed: 0 }))
    try {
        await sendNotificationPush({
            userId: 5,
            title: '💧 Пора полить!',
            body: 'Фикус ждёт воды',
            data: { tag: 'on_day', url: '/plants/3', notificationId: 19 }
        })

        assert.equal(deliveryCalls.length, 1)
        assert.equal(deliveryCalls[0].userId, 5)
        assert.equal(deliveryCalls[0].title, '💧 Пора полить!')
        assert.equal(deliveryCalls[0].body, 'Фикус ждёт воды')
        assert.equal(deliveryCalls[0].kind, 'reminder')
        assert.equal(deliveryCalls[0].url, '/plants/3')
        assert.equal(deliveryCalls[0].notificationId, 19)
    } finally {
        restore()
    }
})

test('sendNotificationPush: kind для сводки, recap и прочих уведомлений', async () => {
    const restore = stubPush(async () => ({ success: true, total: 1, sent: 1, failed: 0 }))
    try {
        await sendNotificationPush({
            userId: 1,
            title: 't',
            body: 'b',
            data: { tag: 'morning-summary' }
        })
        await sendNotificationPush({
            userId: 1,
            title: 't',
            body: 'b',
            data: { tag: 'weekly_recap', url: '/home' }
        })
        await sendNotificationPush({
            userId: 1,
            title: 't',
            body: 'b',
            data: {}
        })

        assert.deepEqual(
            deliveryCalls.map(call => call.kind),
            ['summary', 'weekly_recap', 'notification']
        )
        assert.equal(deliveryCalls[0].url, '/home')
        assert.equal(deliveryCalls[0].notificationId, null)
    } finally {
        restore()
    }
})

test('sendNotificationPush: доставка в ботов вызывается и при падении push', async () => {
    const restore = stubPush(async () => {
        throw new Error('push exploded')
    })
    const originalConsoleError = console.error
    console.error = () => {}
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(result, null)
        assert.equal(deliveryCalls.length, 1)
    } finally {
        console.error = originalConsoleError
        restore()
    }
})

test('sendNotificationPush: ошибка мессенджеров не ломает push', async () => {
    const restore = stubPush(async () => ({ success: true, total: 1, sent: 1, failed: 0 }))
    deliveryOutcome = new Error('bot is down')
    const originalConsoleWarn = console.warn
    console.warn = () => {}
    try {
        const result = await sendNotificationPush({ userId: 1, title: 't', body: 'b' })
        assert.equal(result.sent, 1)
        assert.equal(deliveryCalls.length, 1)
    } finally {
        console.warn = originalConsoleWarn
        restore()
    }
})

test('resolveNotificationDeliveryUrl: url из data, иначе /home', () => {
    assert.equal(resolveNotificationDeliveryUrl({ url: ' /plants/1 ' }), '/plants/1')
    assert.equal(resolveNotificationDeliveryUrl({}), '/home')
    assert.equal(resolveNotificationDeliveryUrl(null), '/home')
})
