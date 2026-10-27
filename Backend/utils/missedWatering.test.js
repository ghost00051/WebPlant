import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_MISSED_POLICY,
    MISSED_ACTION,
    MISSED_BACKFILL_WINDOW_DAYS,
    MISSED_POLICY,
    MISSED_REASON,
    WATERING_STATE_STATUS,
    buildMissedWateringNotification,
    buildWateringState,
    countMissedSlots,
    isValidMissedPolicy,
    planMissedWateringHandling,
    resolveMissedPolicy
} from './missedWatering.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-11-01T12:00:00Z')

function plantFixture(overrides = {}) {
    return {
        id: 1,
        name: 'Фикус',
        location: 'Кухня',
        watering_interval_days: 7,
        watering_time_of_day: 'morning',
        next_watering_at: '2026-11-05T06:00:00Z',
        metadata: {},
        ...overrides
    }
}

test('resolveMissedPolicy: preserve по умолчанию и явные значения', () => {
    assert.equal(DEFAULT_MISSED_POLICY, MISSED_POLICY.PRESERVE)
    assert.equal(resolveMissedPolicy({}), MISSED_POLICY.PRESERVE)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: '' }), MISSED_POLICY.PRESERVE)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: 'preserve' }), MISSED_POLICY.PRESERVE)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: 'auto_skip' }), MISSED_POLICY.AUTO_SKIP)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: 'advance' }), MISSED_POLICY.AUTO_SKIP)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: 'off' }), MISSED_POLICY.AUTO_SKIP)
    assert.equal(resolveMissedPolicy({ REMINDER_MISSED_POLICY: 'мусор' }), MISSED_POLICY.PRESERVE)
    assert.equal(isValidMissedPolicy('preserve'), true)
    assert.equal(isValidMissedPolicy('auto_skip'), true)
    assert.equal(isValidMissedPolicy('nope'), false)
})

test('buildWateringState: будущий полив — scheduled, без пропуска', () => {
    const state = buildWateringState({
        plant: plantFixture(),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(state.status, WATERING_STATE_STATUS.SCHEDULED)
    assert.equal(state.missed, false)
    assert.equal(state.overdue, false)
    assert.equal(state.grace_hours, 24)
    assert.equal(state.missed_since, null)
    assert.equal(state.missed_slots, 0)
    assert.equal(state.can_backfill, false)
    assert.equal(state.backfill_until, null)
    assert.equal(state.reason, null)
    assert.equal(state.policy, MISSED_POLICY.PRESERVE)
    assert.equal(state.timezone, MSK)
    assert.equal(state.scheduled_for, '2026-11-05T06:00:00.000Z')
})

test('buildWateringState: полив сегодня — due_today', () => {
    const state = buildWateringState({
        plant: plantFixture({ next_watering_at: '2026-11-01T06:00:00Z' }),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(state.status, WATERING_STATE_STATUS.DUE_TODAY)
    assert.equal(state.missed, false)
    assert.equal(state.overdue, false)
})

test('BE-07: просрочен до grace 24ч — status=missed и overdue=true (согласовано с is_missed)', () => {
    const state = buildWateringState({
        plant: plantFixture({ next_watering_at: '2026-11-01T06:00:00Z' }),
        now: new Date('2026-11-02T05:00:00Z'),
        timeZone: MSK
    })

    assert.equal(state.overdue, true)
    assert.equal(state.missed, true)
    assert.equal(state.status, WATERING_STATE_STATUS.MISSED)
    assert.equal(state.missed_since, '2026-11-01T06:00:00.000Z')
    assert.equal(state.missed_slots, 1)
    assert.equal(state.hours_late, 23)
    assert.equal(state.can_backfill, true)
    assert.equal(state.reason, MISSED_REASON.MISSED_SLOT)
    assert.equal(state.grace_hours, 24)
})

test('buildWateringState: пропущенный слот объясним и доступен для backfill', () => {
    const state = buildWateringState({
        plant: plantFixture({ next_watering_at: '2026-10-30T06:00:00Z' }),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(state.status, WATERING_STATE_STATUS.MISSED)
    assert.equal(state.missed, true)
    assert.equal(state.missed_since, '2026-10-30T06:00:00.000Z')
    assert.equal(state.missed_slots, 1)
    assert.equal(state.days_late, 2)
    assert.equal(state.hours_late, 54)
    assert.equal(state.reason, MISSED_REASON.MISSED_SLOT)
    assert.equal(state.can_backfill, true)
    assert.equal(state.backfill_until, '2026-11-29T06:00:00.000Z')
})

test('buildWateringState: старый пропуск вне окна backfill', () => {
    const state = buildWateringState({
        plant: plantFixture({ next_watering_at: '2026-09-20T06:00:00Z' }),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(state.status, WATERING_STATE_STATUS.MISSED)
    assert.equal(state.missed_slots, 6)
    assert.ok(state.days_late > MISSED_BACKFILL_WINDOW_DAYS)
    assert.equal(state.can_backfill, false)
    assert.equal(state.backfill_until, null)
})

test('buildWateringState: после авто-пропуска reason=auto_skipped, но пропуск сохранён', () => {
    const state = buildWateringState({
        plant: plantFixture({
            next_watering_at: '2026-11-06T06:00:00Z',
            metadata: {
                missed_since: '2026-10-30T06:00:00.000Z',
                consecutive_skips: 2
            }
        }),
        now: NOW,
        timeZone: MSK,
        policy: MISSED_POLICY.AUTO_SKIP
    })

    assert.equal(state.status, WATERING_STATE_STATUS.MISSED)
    assert.equal(state.missed, true)
    assert.equal(state.missed_since, '2026-10-30T06:00:00.000Z')
    assert.equal(state.missed_slots, 1)
    assert.equal(state.reason, MISSED_REASON.AUTO_SKIPPED)
    assert.equal(state.consecutive_skips, 2)
    assert.equal(state.policy, MISSED_POLICY.AUTO_SKIP)
    assert.equal(state.can_backfill, true)
})

test('buildWateringState: пауза напоминаний — status paused', () => {
    const state = buildWateringState({
        plant: plantFixture({
            next_watering_at: '2026-10-30T06:00:00Z',
            metadata: { reminders_paused: true, consecutive_skips: 3, missed_since: '2026-10-30T06:00:00.000Z' }
        }),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(state.status, WATERING_STATE_STATUS.PAUSED)
    assert.equal(state.overdue, true)
    assert.equal(state.reminders_paused, true)
    assert.equal(state.reason, MISSED_REASON.REMINDERS_PAUSED)
})

test('buildWateringState: битые входные данные не ломают ответ', () => {
    for (const broken of [
        { plant: null },
        { plant: { next_watering_at: 'не дата', metadata: 'строка' } },
        { plant: { next_watering_at: null, metadata: { missed_since: 'мусор', consecutive_skips: 'x' } } }
    ]) {
        const state = buildWateringState({ ...broken, now: NOW, timeZone: MSK })
        assert.equal(typeof state.status, 'string')
        assert.equal(typeof state.missed, 'boolean')
        assert.equal(state.missed_slots >= 0, true)
        assert.equal(state.consecutive_skips, 0)
    }
})

test('countMissedSlots: количество пропущенных слотов по интервалу', () => {
    const missed = countMissedSlots({
        nextWateringAt: '2026-10-01T06:00:00Z',
        intervalDays: 7,
        hour: 9,
        timeZone: MSK,
        now: NOW
    })
    assert.equal(missed.length, 5)
    assert.equal(missed[0].toISOString(), '2026-10-01T06:00:00.000Z')
    assert.equal(missed.every(slot => slot instanceof Date), true)

    const none = countMissedSlots({
        nextWateringAt: '2026-11-20T06:00:00Z',
        intervalDays: 7,
        hour: 9,
        timeZone: MSK,
        now: NOW
    })
    assert.deepEqual(none, [])
})

test('buildMissedWateringNotification: объясняет пропуск и предлагает решение', () => {
    const { title, body, missed_since: missedSince } = buildMissedWateringNotification(
        { name: 'Фикус', location: 'Кухня' },
        { missedSince: '2026-10-30T06:00:00Z', timeZone: MSK, now: NOW }
    )
    assert.equal(title, '💧 Полив пропущен')
    assert.equal(missedSince, '2026-10-30T06:00:00.000Z')
    assert.match(body, /Фикус/)
    assert.match(body, /30\.10/)
    assert.match(body, /Пропустить/)
    assert.match(body, /2 дня/)
    assert.ok(body.length <= 1000)
})

test('planMissedWateringHandling: preserve не сдвигает план, помечает пропуск один раз', () => {
    const plant = plantFixture({ next_watering_at: '2026-10-30T06:00:00Z' })

    const first = planMissedWateringHandling({
        policy: MISSED_POLICY.PRESERVE,
        plant,
        now: NOW,
        timeZone: MSK
    })
    assert.equal(first.action, MISSED_ACTION.MARK_MISSED)
    assert.equal(first.missed.length, 1)
    assert.equal(first.missedSince.toISOString(), '2026-10-30T06:00:00.000Z')

    const repeated = planMissedWateringHandling({
        policy: MISSED_POLICY.PRESERVE,
        plant: plantFixture({
            next_watering_at: '2026-10-30T06:00:00Z',
            metadata: { missed_since: '2026-10-30T06:00:00.000Z' }
        }),
        now: NOW,
        timeZone: MSK
    })
    assert.equal(repeated.action, MISSED_ACTION.NOOP, 'повторный тик ничего не делает')
})

test('planMissedWateringHandling: auto_skip сдвигает план и отдаёт пропущенные слоты', () => {
    const plan = planMissedWateringHandling({
        policy: MISSED_POLICY.AUTO_SKIP,
        plant: plantFixture({ next_watering_at: '2026-10-30T06:00:00Z' }),
        now: NOW,
        timeZone: MSK
    })

    assert.equal(plan.action, MISSED_ACTION.ADVANCE)
    assert.equal(plan.missed.length, 1)
    assert.ok(plan.next instanceof Date)
    assert.equal(plan.next.toISOString(), '2026-11-06T06:00:00.000Z')
})

test('planMissedWateringHandling: нет пропусков — noop в обеих политиках', () => {
    for (const policy of [MISSED_POLICY.PRESERVE, MISSED_POLICY.AUTO_SKIP]) {
        const plan = planMissedWateringHandling({
            policy,
            plant: plantFixture({ next_watering_at: '2026-11-20T06:00:00Z' }),
            now: NOW,
            timeZone: MSK
        })
        assert.equal(plan.action, MISSED_ACTION.NOOP)
        assert.deepEqual(plan.missed, [])
    }
})

test('buildMissedWateringNotification: свежий пропуск и очень длинное имя', () => {
    const fresh = buildMissedWateringNotification(
        { name: 'Кактус' },
        { missedSince: '2026-10-31T20:00:00Z', timeZone: MSK }
    )
    assert.doesNotMatch(fresh.body, /Пропуск уже/)

    const long = buildMissedWateringNotification(
        { name: 'я'.repeat(200), location: 'л'.repeat(100) },
        { missedSince: '2026-10-01T06:00:00Z', timeZone: MSK }
    )
    assert.ok(long.body.length <= 1000)

    const empty = buildMissedWateringNotification({}, { timeZone: MSK })
    assert.match(empty.body, /Растение/)
})
