import test from 'node:test'
import assert from 'node:assert/strict'

import {
    MAX_REMINDER_TICK_METRICS,
    getReminderTickMetrics,
    recordReminderTick,
    resetReminderTickMetrics
} from './reminderTickMetrics.js'

test.beforeEach(() => {
    resetReminderTickMetrics()
})

test('recordReminderTick: пишет запись в ring buffer', () => {
    const startedAt = new Date('2026-10-25T09:00:00Z')
    const entry = recordReminderTick({
        startedAt,
        durationMs: 123.6,
        batches: 2,
        plantsProcessed: 40,
        notificationsCreated: 7,
        errors: 1
    })

    assert.deepEqual(entry, {
        startedAt: '2026-10-25T09:00:00.000Z',
        durationMs: 124,
        batches: 2,
        plantsProcessed: 40,
        notificationsCreated: 7,
        errors: 1
    })

    const snapshot = getReminderTickMetrics()
    assert.equal(snapshot.maxTicks, MAX_REMINDER_TICK_METRICS)
    assert.equal(snapshot.count, 1)
    assert.equal(snapshot.lastTickAt, '2026-10-25T09:00:00.000Z')
    assert.deepEqual(snapshot.ticks[0], entry)
})

test('recordReminderTick: безопасные значения по умолчанию', () => {
    recordReminderTick({
        durationMs: -10,
        batches: 'abc',
        plantsProcessed: Number.NaN,
        notificationsCreated: undefined,
        errors: -1
    })

    const [tick] = getReminderTickMetrics().ticks
    assert.deepEqual(tick, {
        startedAt: null,
        durationMs: 0,
        batches: 0,
        plantsProcessed: 0,
        notificationsCreated: 0,
        errors: 0
    })
})

test('recordReminderTick: startedAt принимает ISO-строку и невалидное значение', () => {
    recordReminderTick({ startedAt: '2026-10-25T06:15:00.000Z' })
    recordReminderTick({ startedAt: 'not-a-date' })

    const ticks = getReminderTickMetrics().ticks
    assert.equal(ticks[0].startedAt, '2026-10-25T06:15:00.000Z')
    assert.equal(ticks[1].startedAt, null)
})

test('ring buffer хранит только последние MAX_REMINDER_TICK_METRICS тиков', () => {
    const total = MAX_REMINDER_TICK_METRICS + 5
    for (let index = 1; index <= total; index += 1) {
        recordReminderTick({
            startedAt: new Date(Date.UTC(2026, 9, 25, 6, index)),
            durationMs: index
        })
    }

    const snapshot = getReminderTickMetrics()
    assert.equal(snapshot.count, MAX_REMINDER_TICK_METRICS)
    assert.equal(snapshot.ticks.length, MAX_REMINDER_TICK_METRICS)
    assert.equal(snapshot.ticks[0].durationMs, total - MAX_REMINDER_TICK_METRICS + 1)
    assert.equal(snapshot.ticks.at(-1).durationMs, total)
})

test('getReminderTickMetrics отдаёт копию, а не ссылку на буфер', () => {
    recordReminderTick({ durationMs: 5 })

    const snapshot = getReminderTickMetrics()
    snapshot.ticks[0].durationMs = 999

    assert.equal(getReminderTickMetrics().ticks[0].durationMs, 5)
})

test('getReminderTickMetrics: пустой буфер', () => {
    const snapshot = getReminderTickMetrics()
    assert.deepEqual(snapshot, {
        maxTicks: MAX_REMINDER_TICK_METRICS,
        count: 0,
        lastTickAt: null,
        ticks: []
    })
})

test('resetReminderTickMetrics очищает буфер', () => {
    recordReminderTick({ durationMs: 1 })
    assert.equal(getReminderTickMetrics().count, 1)

    resetReminderTickMetrics()
    assert.equal(getReminderTickMetrics().count, 0)
})
