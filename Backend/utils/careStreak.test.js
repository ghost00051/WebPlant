import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildWeeklyRecap,
    computeCareStreak,
    summarizeWeek,
    weekWindow,
    zonedDateParts,
    ON_TIME_GRACE_HOURS,
    STREAK_WINDOW_DAYS,
    WEEKLY_RECAP_BODY_MAX_LENGTH,
    WEEKLY_RECAP_TITLE,
    WEEKLY_RECAP_TYPE,
    WEEKLY_RECAP_URL,
    WEEK_DAY_STATUS
} from './careStreak.js'

const MSK = 'Europe/Moscow'
const SUNDAY_EVENING = new Date('2026-11-01T16:00:00Z')

const event = (action, iso, hoursLate = 0) => ({
    action,
    action_at: iso,
    hours_late: hoursLate
})

test('константы F10 согласованы с контрактом', () => {
    assert.equal(ON_TIME_GRACE_HOURS, 24)
    assert.equal(STREAK_WINDOW_DAYS, 365)
    assert.equal(WEEKLY_RECAP_TYPE, 'weekly_recap')
    assert.equal(WEEKLY_RECAP_TITLE, '🌿 Итоги недели')
    assert.equal(WEEKLY_RECAP_URL, '/home')
    assert.equal(WEEKLY_RECAP_BODY_MAX_LENGTH, 1000)
    assert.deepEqual(Object.values(WEEK_DAY_STATUS).sort(), ['late', 'none', 'skipped', 'watered'])
})

test('zonedDateParts: локальные части и ISO-день недели', () => {
    const parts = zonedDateParts(SUNDAY_EVENING, MSK)
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 11)
    assert.equal(parts.day, 1)
    assert.equal(parts.hour, 19)
    assert.equal(parts.isoWeekday, 7)

    const monday = zonedDateParts(new Date('2026-10-26T00:00:00+03:00'), MSK)
    assert.equal(monday.isoWeekday, 1)
    assert.equal(monday.day, 26)
})

test('weekWindow: неделя с понедельника 00:00 локального TZ', () => {
    const window = weekWindow(SUNDAY_EVENING, MSK)
    assert.equal(window.startDate, '2026-10-26')
    assert.equal(window.start.toISOString(), '2026-10-25T21:00:00.000Z')
    assert.equal(window.end.toISOString(), '2026-11-01T21:00:00.000Z')

    const mondayStart = new Date('2026-10-26T00:00:00+03:00')
    assert.equal(weekWindow(mondayStart, MSK).startDate, '2026-10-26')

    const sundayLate = new Date('2026-11-01T23:59:00+03:00')
    assert.equal(weekWindow(sundayLate, MSK).startDate, '2026-10-26')
    assert.equal(
        weekWindow(new Date('2026-11-02T00:00:00+03:00'), MSK).startDate,
        '2026-11-02'
    )
})

test('computeCareStreak: «вовремя» = watered и hours_late <= 24', () => {
    const events = [
        event('watered', '2026-10-01T06:00:00Z', 0),
        event('watered', '2026-10-02T06:00:00Z', ON_TIME_GRACE_HOURS),
        event('watered', '2026-10-03T06:00:00Z', null),
        event('skipped', '2026-10-04T06:00:00Z', 24),
        event('watered', '2026-10-05T06:00:00Z', 25),
        event('watered', '2026-10-06T06:00:00Z', 0),
        event('watered', '2026-10-07T06:00:00Z', 1)
    ]

    const result = computeCareStreak(events, { now: SUNDAY_EVENING })
    assert.equal(result.current, 2)
    assert.equal(result.best, 3)
    assert.equal(result.lastWateredAt, '2026-10-07T06:00:00.000Z')
})

test('computeCareStreak: skipped и опоздание >24ч рвут серию', () => {
    const brokenBySkip = computeCareStreak([
        event('watered', '2026-10-01T06:00:00Z', 0),
        event('skipped', '2026-10-02T06:00:00Z', 0)
    ], { now: SUNDAY_EVENING })
    assert.equal(brokenBySkip.current, 0)
    assert.equal(brokenBySkip.best, 1)

    const brokenByLate = computeCareStreak([
        event('watered', '2026-10-01T06:00:00Z', 0),
        event('watered', '2026-10-02T06:00:00Z', 26),
        event('watered', '2026-10-03T06:00:00Z', 0)
    ], { now: SUNDAY_EVENING })
    assert.equal(brokenByLate.current, 1)
    assert.equal(brokenByLate.best, 1)
})

test('computeCareStreak: окно 365 дней, битые и будущие события игнорируются', () => {
    const events = [
        event('watered', '2024-01-01T06:00:00Z', 0),
        event('watered', '2026-11-02T06:00:00Z', 0),
        { action: 'watered', action_at: 'не дата', hours_late: 0 },
        null,
        event('watered', '2026-10-01T06:00:00Z', 0)
    ]

    const result = computeCareStreak(events, { now: SUNDAY_EVENING })
    assert.equal(result.current, 1)
    assert.equal(result.best, 1)
    assert.equal(result.lastWateredAt, '2026-10-01T06:00:00.000Z')
})

test('computeCareStreak: пустая история', () => {
    assert.deepEqual(computeCareStreak([], { now: SUNDAY_EVENING }), {
        current: 0,
        best: 0,
        lastWateredAt: null
    })
    assert.deepEqual(computeCareStreak(undefined, { now: SUNDAY_EVENING }), {
        current: 0,
        best: 0,
        lastWateredAt: null
    })
})

test('summarizeWeek: поливы, фото, действия ухода и дни недели', () => {
    const events = [
        event('watered', '2026-10-27T06:00:00Z', 0),
        event('watered', '2026-10-28T06:00:00Z', 2),
        event('skipped', '2026-10-29T06:00:00Z', 24),
        event('watered', '2026-10-30T06:00:00Z', 30),
        event('watered', '2026-10-31T06:00:00Z', 0),
        event('watered', '2026-11-01T06:00:00Z', 0),
        event('watered', '2026-10-25T20:00:00Z', 0),
        event('watered', '2026-11-01T18:00:00Z', 0)
    ]

    const week = summarizeWeek(events, {
        now: SUNDAY_EVENING,
        timeZone: MSK,
        photos: 2,
        careActions: 3
    })

    assert.equal(week.wateredOnTime, 4)
    assert.equal(week.wateredLate, 1)
    assert.equal(week.skipped, 1)
    assert.equal(week.scheduled, 6)
    assert.equal(week.photos, 2)
    assert.equal(week.careActions, 3)
    assert.equal(week.startDate, '2026-10-26')
    assert.equal(week.days.length, 7)
    assert.deepEqual(week.days.map(day => day.date), [
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01'
    ])
    assert.deepEqual(week.days.map(day => day.status), [
        WEEK_DAY_STATUS.none,
        WEEK_DAY_STATUS.watered,
        WEEK_DAY_STATUS.watered,
        WEEK_DAY_STATUS.skipped,
        WEEK_DAY_STATUS.late,
        WEEK_DAY_STATUS.watered,
        WEEK_DAY_STATUS.watered
    ])
})

test('summarizeWeek: приоритет статуса дня watered > late > skipped, массивы считаются', () => {
    const week = summarizeWeek([
        event('skipped', '2026-10-27T06:00:00Z', 0),
        event('watered', '2026-10-27T08:00:00Z', 30),
        event('watered', '2026-10-27T10:00:00Z', 0)
    ], {
        now: SUNDAY_EVENING,
        timeZone: MSK,
        photos: [1, 2],
        careActions: [1]
    })

    assert.equal(week.photos, 2)
    assert.equal(week.careActions, 1)
    assert.equal(week.days[1].status, WEEK_DAY_STATUS.watered)
})

test('summarizeWeek: пустая неделя', () => {
    const week = summarizeWeek([], { now: SUNDAY_EVENING, timeZone: MSK })
    assert.deepEqual({
        wateredOnTime: week.wateredOnTime,
        wateredLate: week.wateredLate,
        skipped: week.skipped,
        scheduled: week.scheduled,
        photos: week.photos,
        careActions: week.careActions,
        startDate: week.startDate
    }, {
        wateredOnTime: 0,
        wateredLate: 0,
        skipped: 0,
        scheduled: 0,
        photos: 0,
        careActions: 0,
        startDate: '2026-10-26'
    })
    assert.ok(week.days.every(day => day.status === WEEK_DAY_STATUS.none))
})

test('buildWeeklyRecap: текст, заголовок и payload по контракту', () => {
    const recap = buildWeeklyRecap({
        week: {
            wateredOnTime: 2,
            wateredLate: 1,
            skipped: 1,
            scheduled: 4,
            photos: 2,
            careActions: 0,
            startDate: '2026-10-26',
            days: []
        },
        streak: { current: 5, best: 7, lastWateredAt: '2026-11-01T06:00:00.000Z' }
    })

    assert.equal(recap.title, WEEKLY_RECAP_TITLE)
    assert.equal(recap.body, '3 из 4 поливов, 2 фото, серия 5 🔥')
    assert.equal(recap.payload.stats.scheduled, 4)
    assert.equal(recap.payload.stats.photos, 2)
    assert.deepEqual(recap.payload.streak, {
        current: 5,
        best: 7,
        lastWateredAt: '2026-11-01T06:00:00.000Z'
    })
})

test('buildWeeklyRecap: склонения и действия ухода', () => {
    const one = buildWeeklyRecap({
        week: { wateredOnTime: 1, scheduled: 1, careActions: 1 },
        streak: { current: 1 }
    })
    assert.match(one.body, /1 из 1 полива/)
    assert.match(one.body, /1 действие ухода/)
    assert.match(one.body, /серия 1 🔥/)

    const four = buildWeeklyRecap({
        week: { wateredOnTime: 2, wateredLate: 2, skipped: 0, scheduled: 4, careActions: 5 },
        streak: { current: 0 }
    })
    assert.match(four.body, /4 из 4 поливов/)
    assert.match(four.body, /5 действий ухода/)
    assert.doesNotMatch(four.body, /серия/)
})

test('buildWeeklyRecap: пустая статистика даёт дружелюбный fallback', () => {
    const recap = buildWeeklyRecap({})
    assert.equal(recap.title, WEEKLY_RECAP_TITLE)
    assert.equal(recap.body, 'На этой неделе без активности 🌱')
    assert.ok(recap.body.length <= WEEKLY_RECAP_BODY_MAX_LENGTH)
    assert.deepEqual(recap.payload.streak, { current: 0, best: 0, lastWateredAt: null })
})

test('buildWeeklyRecap: не теряет дни недели, переданные в статистике', () => {
    const days = [{ date: '2026-10-26', status: 'watered' }]
    const recap = buildWeeklyRecap({
        week: { wateredOnTime: 1, scheduled: 1, startDate: '2026-10-26', days },
        streak: { current: 1, best: 1 }
    })
    assert.deepEqual(recap.payload.stats.days, days)
    assert.equal(recap.payload.stats.startDate, '2026-10-26')
})
