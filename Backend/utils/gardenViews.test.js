import test from 'node:test'
import assert from 'node:assert/strict'

import {
    GARDEN_VIEW_BODY_MAX_LENGTH,
    GARDEN_VIEW_NOTIFICATION_TITLE,
    GARDEN_VIEW_NOTIFICATION_TYPE,
    GARDEN_VIEW_NOTIFY_INTERVAL_MS,
    buildGardenViewNotification,
    gardenViewDedupeKey,
    shouldNotifyGardenViews
} from './gardenViews.js'

const NOW = new Date('2026-11-01T12:00:00Z')

test('константы F50', () => {
    assert.equal(GARDEN_VIEW_NOTIFICATION_TYPE, 'garden_view')
    assert.equal(GARDEN_VIEW_NOTIFICATION_TITLE, 'Ваш сад посмотрели')
    assert.equal(GARDEN_VIEW_NOTIFY_INTERVAL_MS, 24 * 60 * 60 * 1000)
    assert.equal(GARDEN_VIEW_BODY_MAX_LENGTH, 1000)
})

test('buildGardenViewNotification: заголовок, тело, payload и url', () => {
    const one = buildGardenViewNotification({ viewCount: 1 })
    assert.equal(one.type, 'garden_view')
    assert.equal(one.title, 'Ваш сад посмотрели')
    assert.match(one.body, /открыли 1 раз/)
    assert.deepEqual(one.payload, { viewCount: 1 })
    assert.equal(one.url, '/profile')

    const many = buildGardenViewNotification({ viewCount: 21 })
    assert.match(many.body, /открыли 21 раз/)
    assert.deepEqual(many.payload, { viewCount: 21 })

    const two = buildGardenViewNotification({ viewCount: 2 })
    assert.match(two.body, /2 раза/)

    const broken = buildGardenViewNotification({ viewCount: 'мусор' })
    assert.deepEqual(broken.payload, { viewCount: 1 })
    assert.ok(broken.body.length <= GARDEN_VIEW_BODY_MAX_LENGTH)
})

test('shouldNotifyGardenViews: первый просмотр уведомляет сразу', () => {
    assert.equal(shouldNotifyGardenViews({
        viewCount: 1,
        viewsNotifiedCount: 0,
        viewsNotifiedAt: null,
        now: NOW
    }), true)
})

test('shouldNotifyGardenViews: без роста просмотров не уведомляем', () => {
    assert.equal(shouldNotifyGardenViews({
        viewCount: 5,
        viewsNotifiedCount: 5,
        viewsNotifiedAt: null,
        now: NOW
    }), false)

    assert.equal(shouldNotifyGardenViews({
        viewCount: 4,
        viewsNotifiedCount: 5,
        viewsNotifiedAt: null,
        now: NOW
    }), false)

    assert.equal(shouldNotifyGardenViews({ viewCount: 0, viewsNotifiedCount: 0 }), false)
})

test('shouldNotifyGardenViews: не чаще одного раза в 24 часа', () => {
    const recent = new Date(NOW.getTime() - 60 * 60 * 1000)
    assert.equal(shouldNotifyGardenViews({
        viewCount: 9,
        viewsNotifiedCount: 3,
        viewsNotifiedAt: recent,
        now: NOW
    }), false)

    const fullDayAgo = new Date(NOW.getTime() - GARDEN_VIEW_NOTIFY_INTERVAL_MS)
    assert.equal(shouldNotifyGardenViews({
        viewCount: 9,
        viewsNotifiedCount: 3,
        viewsNotifiedAt: fullDayAgo,
        now: NOW
    }), true)

    assert.equal(shouldNotifyGardenViews({
        viewCount: 10,
        viewsNotifiedCount: 3,
        viewsNotifiedAt: 'не дата',
        now: NOW
    }), true)
})

test('gardenViewDedupeKey: стабильный ключ на share и число просмотров', () => {
    assert.equal(gardenViewDedupeKey(7, 12), 'garden-share:7:view:12')
    assert.equal(gardenViewDedupeKey(7, 0), 'garden-share:7:view:1')
    assert.equal(gardenViewDedupeKey(0, 3), null)
    assert.equal(gardenViewDedupeKey('x', 3), null)
})
