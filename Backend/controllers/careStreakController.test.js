import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CareStreakController,
    STREAK_EVENT_LIMIT,
    serializeLatestRecap
} from './careStreakController.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-11-01T16:00:00Z')
const WEEK_START = '2026-10-26'

function wateringEvent(iso, hoursLate = 0) {
    return { action: 'watered', action_at: iso, hours_late: hoursLate }
}

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

function createController(overrides = {}) {
    const calls = {
        wateringOptions: null,
        photosOptions: null,
        careOptions: null,
        notificationOptions: null
    }

    const models = {
        User: {
            async findByPk() {
                return overrides.user ?? { id: 1, timezone: MSK }
            }
        },
        WateringLog: {
            async findAll(options) {
                calls.wateringOptions = options
                if (typeof overrides.findAllWateringLogs === 'function') {
                    return overrides.findAllWateringLogs(options)
                }
                return overrides.events ?? []
            }
        },
        Plant: {
            async findAll() {
                return overrides.plants ?? [{ id: 1 }, { id: 2 }]
            }
        },
        PlantPhoto: {
            async count(options) {
                calls.photosOptions = options
                if (typeof overrides.countPhotos === 'function') return overrides.countPhotos(options)
                return overrides.photos ?? 2
            }
        },
        PlantCareLog: {
            async count(options) {
                calls.careOptions = options
                if (typeof overrides.countCareActions === 'function') {
                    return overrides.countCareActions(options)
                }
                return overrides.careActions ?? 1
            }
        },
        Notification: {
            async findOne(options) {
                calls.notificationOptions = options
                if (typeof overrides.findOneNotification === 'function') {
                    return overrides.findOneNotification(options)
                }
                return overrides.latestRecap ?? {
                    id: 7,
                    title: '🌿 Итоги недели',
                    body: '4 из 4 поливов, 2 фото, серия 4 🔥',
                    created_at: '2026-10-26T16:00:00.000Z',
                    payload: { stats: { scheduled: 4 }, streak: { current: 4 } }
                }
            }
        }
    }

    const controller = new CareStreakController({
        models,
        now: () => NOW
    })

    return { controller, calls }
}

test('serializeLatestRecap: null и строка уведомления', () => {
    assert.equal(serializeLatestRecap(null), null)
    assert.equal(serializeLatestRecap(undefined), null)

    const serialized = serializeLatestRecap({
        id: 7,
        title: '🌿 Итоги недели',
        body: '3 из 4 поливов',
        created_at: '2026-10-26T16:00:00.000Z',
        payload: { stats: { scheduled: 4 }, streak: { current: 5 } }
    })
    assert.deepEqual(serialized, {
        id: 7,
        title: '🌿 Итоги недели',
        body: '3 из 4 поливов',
        createdAt: '2026-10-26T16:00:00.000Z',
        payload: { stats: { scheduled: 4 }, streak: { current: 5 } }
    })

    const broken = serializeLatestRecap({
        id: 8,
        title: 'x',
        body: 'y',
        created_at: 'не дата',
        payload: 'oops'
    })
    assert.equal(broken.createdAt, null)
    assert.deepEqual(broken.payload, {})
})

test('loadCareStreak: ответ строго по контракту', async () => {
    const { controller, calls } = createController({
        events: [
            wateringEvent('2026-10-26T06:00:00Z'),
            wateringEvent('2026-10-28T06:00:00Z'),
            wateringEvent('2026-10-30T06:00:00Z'),
            wateringEvent('2026-11-01T06:00:00Z')
        ]
    })

    const result = await controller.loadCareStreak(1)

    assert.deepEqual(Object.keys(result).sort(), [
        'best',
        'current',
        'lastWateredAt',
        'latestRecap',
        'updatedAt',
        'week'
    ])
    assert.equal(result.current, 4)
    assert.equal(result.best, 4)
    assert.equal(result.lastWateredAt, '2026-11-01T06:00:00.000Z')
    assert.equal(result.updatedAt, NOW.toISOString())

    assert.deepEqual(Object.keys(result.week).sort(), [
        'careActions',
        'days',
        'photos',
        'scheduled',
        'skipped',
        'startDate',
        'wateredLate',
        'wateredOnTime'
    ])
    assert.equal(result.week.wateredOnTime, 4)
    assert.equal(result.week.wateredLate, 0)
    assert.equal(result.week.skipped, 0)
    assert.equal(result.week.scheduled, 4)
    assert.equal(result.week.photos, 2)
    assert.equal(result.week.careActions, 1)
    assert.equal(result.week.startDate, WEEK_START)
    assert.equal(result.week.days.length, 7)
    assert.equal(result.week.days[0].date, WEEK_START)

    assert.deepEqual(result.latestRecap, {
        id: 7,
        title: '🌿 Итоги недели',
        body: '4 из 4 поливов, 2 фото, серия 4 🔥',
        createdAt: '2026-10-26T16:00:00.000Z',
        payload: { stats: { scheduled: 4 }, streak: { current: 4 } }
    })
    assert.equal(result.latestRecap.createdAt, '2026-10-26T16:00:00.000Z')

    assert.equal(calls.notificationOptions.where.type, 'weekly_recap')
    assert.equal(calls.notificationOptions.where.user_id, 1)
    assert.equal(calls.wateringOptions.limit, STREAK_EVENT_LIMIT)
    assert.ok(calls.wateringOptions.order[0].includes('DESC'))
    assert.ok(calls.photosOptions.where.created_at)
    assert.ok(calls.careOptions.where.performed_at)
})

test('loadCareStreak: без растений фото = 0, серия по последним событиям', async () => {
    const { controller } = createController({
        plants: [],
        events: [
            wateringEvent('2026-10-30T06:00:00Z'),
            wateringEvent('2026-10-31T06:00:00Z', 25),
            wateringEvent('2026-11-01T06:00:00Z')
        ]
    })

    const result = await controller.loadCareStreak(1)
    assert.equal(result.week.photos, 0)
    assert.equal(result.current, 1)
    assert.equal(result.best, 1)
    assert.equal(result.week.wateredLate, 1)
})

test('loadCareStreak: старая схема без payload не ломает ответ', async () => {
    const { controller } = createController({
        events: [wateringEvent('2026-11-01T06:00:00Z')],
        findOneNotification: () => {
            throw new Error('column payload does not exist')
        }
    })

    const result = await controller.loadCareStreak(1)
    assert.equal(result.latestRecap, null)
    assert.equal(result.current, 1)
})

test('GET: 401 без пользователя, 200 с данными, 500 при ошибке БД', async () => {
    const { controller } = createController({ events: [wateringEvent('2026-11-01T06:00:00Z')] })

    const unauthorized = createResponse()
    await controller.get({ user: null }, unauthorized)
    assert.equal(unauthorized.statusCode, 401)
    assert.match(unauthorized.body.message, /авториза/i)

    const authorized = createResponse()
    await controller.get({ user: { id: 1 } }, authorized)
    assert.equal(authorized.statusCode, 200)
    assert.equal(authorized.body.current, 1)
    assert.ok(authorized.body.week)

    const failing = createController({
        findAllWateringLogs: () => {
            throw new Error('db down')
        }
    })
    const failed = createResponse()
    await failing.controller.get({ user: { id: 1 } }, failed)
    assert.equal(failed.statusCode, 500)
    assert.match(failed.body.message, /серию ухода/)
})
