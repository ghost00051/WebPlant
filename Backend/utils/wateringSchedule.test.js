import test from 'node:test'
import assert from 'node:assert/strict'
import {
    generateWateringOccurrences,
    findFirstWateringAfter,
    isReminderWeekday,
    parseWateringSlot,
    pickWateringLogForSlot,
    resolveMissedLateness,
    resolvePastWatering,
    utcDayRange,
    weekdayRestrictionApplies
} from './wateringSchedule.js'

test('watering calendar projects interval dates throughout its forecast range', () => {
    const occurrences = generateWateringOccurrences(
        '2026-10-05T08:00:00.000Z',
        2,
        {
            now: new Date('2026-10-03T08:00:00.000Z'),
            daysAhead: 8
        }
    )

    assert.deepEqual(
        occurrences.map(date => date.toISOString().slice(0, 10)),
        ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11']
    )
})

test('watering calendar preserves the current overdue occurrence and resumes its interval', () => {
    const occurrences = generateWateringOccurrences(
        '2026-10-01T08:00:00.000Z',
        2,
        {
            now: new Date('2026-10-03T09:00:00.000Z'),
            daysAhead: 4
        }
    )

    assert.deepEqual(
        occurrences.map(date => date.toISOString().slice(0, 10)),
        ['2026-10-01', '2026-10-05', '2026-10-07']
    )
})

test('watering reminders use the scheduled watering weekday, not the current weekday', () => {
    assert.equal(
        isReminderWeekday([1, 3, 4, 6], '2026-10-05T08:00:00.000Z'),
        true
    )
    assert.equal(
        isReminderWeekday([1, 3, 4, 6], '2026-10-09T08:00:00.000Z'),
        false
    )
    assert.equal(isReminderWeekday([], '2026-10-09T08:00:00.000Z'), true)
})

test('missed watering is closed by the first watering after the slot, not the last one', () => {
    const times = [
        '2026-09-01T10:00:00.000Z',
        '2026-09-08T16:00:00.000Z',
        '2026-10-10T09:00:00.000Z'
    ]

    const resolution = findFirstWateringAfter(times, '2026-09-01T16:00:00.000Z')
    assert.equal(resolution, new Date('2026-09-08T16:00:00.000Z').getTime())

    const lateness = resolveMissedLateness('2026-09-01T16:00:00.000Z', {
        now: new Date('2026-10-20T09:00:00.000Z'),
        wateredAt: resolution
    })
    assert.deepEqual(lateness, { hoursLate: 168, daysLate: 7 })
})

test('watering before the slot does not close the missed one', () => {
    assert.equal(
        findFirstWateringAfter(['2026-09-01T10:00:00.000Z'], '2026-09-01T16:00:00.000Z'),
        null
    )
    assert.equal(findFirstWateringAfter([], '2026-09-01T16:00:00.000Z'), null)
    assert.equal(findFirstWateringAfter(undefined, '2026-09-01T16:00:00.000Z'), null)
    assert.equal(findFirstWateringAfter(['не дата'], '2026-09-01T16:00:00.000Z'), null)
})

test('watering exactly on time closes the miss without lateness', () => {
    const resolution = findFirstWateringAfter(
        ['2026-09-01T16:00:00.000Z'],
        '2026-09-01T16:00:00.000Z'
    )

    assert.deepEqual(
        resolveMissedLateness('2026-09-01T16:00:00.000Z', {
            now: new Date('2026-09-05T16:00:00.000Z'),
            wateredAt: resolution
        }),
        { hoursLate: 0, daysLate: 0 }
    )
})

test('missed watering keeps growing while the plant is still dry', () => {
    const lateness = resolveMissedLateness('2026-10-07T16:00:00.000Z', {
        now: new Date('2026-10-10T13:05:00.000Z'),
        wateredAt: new Date('2026-10-05T16:00:00.000Z')
    })

    assert.deepEqual(lateness, { hoursLate: 69, daysLate: 2 })
})

test('missed watering lateness freezes at the next watering', () => {
    const lateness = resolveMissedLateness('2026-10-07T16:00:00.000Z', {
        now: new Date('2026-10-20T13:05:00.000Z'),
        wateredAt: new Date('2026-10-12T05:00:00.000Z')
    })

    assert.deepEqual(lateness, { hoursLate: 109, daysLate: 4 })
})

test('missed watering is never negative and tolerates missing dates', () => {
    assert.deepEqual(
        resolveMissedLateness('2026-10-07T16:00:00.000Z', {
            now: new Date('2026-10-07T09:00:00.000Z')
        }),
        { hoursLate: 0, daysLate: 0 }
    )
    assert.equal(resolveMissedLateness(undefined, {}), null)
    assert.equal(resolveMissedLateness('не дата', {}), null)
})

test('watering slot accepts both the event timestamp and a bare day', () => {
    const timestamp = parseWateringSlot('2026-10-05T05:00:00.000Z', 8)
    assert.equal(timestamp.toISOString(), '2026-10-05T05:00:00.000Z')

    const day = parseWateringSlot('2026-10-05', 8)
    assert.equal(day.getFullYear(), 2026)
    assert.equal(day.getMonth(), 9)
    assert.equal(day.getDate(), 5)
    assert.equal(day.getHours(), 8)
    assert.equal(day.getMinutes(), 0)
    assert.equal(parseWateringSlot('2026-10-05', 19).getHours(), 19)

    assert.equal(parseWateringSlot('2026-02-31', 8), null)
    assert.equal(parseWateringSlot('', 8), null)
    assert.equal(parseWateringSlot('не дата', 8), null)
    assert.equal(parseWateringSlot(undefined, 8), null)
    assert.equal(parseWateringSlot(1759600000000, 8), null)
})

test('past watering closes the overdue slot and resumes the interval from it', () => {
    const slot = new Date(2026, 9, 5, 8, 0, 0)

    const plan = resolvePastWatering(slot, {
        now: new Date(2026, 9, 10, 12, 0, 0),
        lastWateredAt: new Date(2026, 8, 28, 8, 0, 0),
        nextWateringAt: slot,
        intervalDays: 7,
        timeOfDayHours: 8
    })

    assert.deepEqual(plan.actionAt, slot)
    assert.deepEqual(plan.scheduledFor, slot)
    assert.equal(plan.hoursLate, 0)
    assert.equal(plan.scheduleChanged, true)
    assert.deepEqual(plan.lastWateredAt, slot)
    assert.deepEqual(plan.nextWateringAt, new Date(2026, 9, 12, 8, 0, 0))
})

test('past watering never moves the schedule backwards after an automatic skip', () => {
    const slot = new Date(2026, 9, 5, 8, 0, 0)
    const advanced = new Date(2026, 9, 26, 8, 0, 0)

    const plan = resolvePastWatering(slot, {
        now: new Date(2026, 9, 20, 12, 0, 0),
        lastWateredAt: new Date(2026, 8, 28, 8, 0, 0),
        nextWateringAt: advanced,
        intervalDays: 7,
        timeOfDayHours: 8
    })

    assert.deepEqual(plan.nextWateringAt, advanced)
    assert.equal(plan.scheduleChanged, false)
})

test('past watering keeps the later watering as the last one', () => {
    const later = new Date(2026, 9, 12, 8, 0, 0)

    const plan = resolvePastWatering(new Date(2026, 9, 5, 8, 0, 0), {
        now: new Date(2026, 9, 20, 12, 0, 0),
        lastWateredAt: later,
        nextWateringAt: new Date(2026, 9, 19, 8, 0, 0),
        intervalDays: 7,
        timeOfDayHours: 8
    })

    assert.deepEqual(plan.lastWateredAt, later)
})

test('past watering rejects future and malformed slots', () => {
    const now = new Date(2026, 9, 10, 12, 0, 0)

    assert.equal(resolvePastWatering(new Date(2026, 9, 12, 8, 0, 0), { now }), null)
    assert.equal(resolvePastWatering('не дата', { now }), null)
    assert.equal(resolvePastWatering(null, { now }), null)
    assert.equal(resolvePastWatering(undefined, { now }), null)
})

test('the day of a converted missed watering stops being overdue', () => {
    const slot = new Date(2026, 9, 5, 8, 0, 0)
    const now = new Date(2026, 9, 10, 12, 0, 0)

    const plan = resolvePastWatering(slot, {
        now,
        nextWateringAt: slot,
        intervalDays: 7,
        timeOfDayHours: 8
    })

    const resolution = findFirstWateringAfter([plan.actionAt], slot)
    assert.equal(resolution, slot.getTime())
    assert.deepEqual(
        resolveMissedLateness(slot, { now, wateredAt: resolution }),
        { hoursLate: 0, daysLate: 0 }
    )

    const occurrences = generateWateringOccurrences(plan.nextWateringAt, 7, {
        now,
        daysAhead: 7
    })
    assert.equal(occurrences.length, 1)
    assert.equal(occurrences[0].getTime(), plan.nextWateringAt.getTime())
    assert.equal(occurrences[0].getTime() > now.getTime(), true)
})

test('watering slot day range covers exactly the UTC day', () => {
    const range = utcDayRange('2026-10-05T05:00:00.000Z')

    assert.equal(range.from.toISOString(), '2026-10-05T00:00:00.000Z')
    assert.equal(range.to.toISOString(), '2026-10-05T23:59:59.999Z')
    assert.equal(utcDayRange('не дата'), null)
    assert.equal(utcDayRange(null), null)
})

test('watering log selection prefers the closed slot over a neighbouring skip', () => {
    const slot = '2026-10-05T05:00:00.000Z'
    const target = {
        id: 1,
        action: 'skipped',
        scheduled_for: new Date('2026-10-05T05:00:00.000Z'),
        action_at: new Date('2026-10-06T05:00:00.000Z')
    }
    const neighbour = {
        id: 2,
        action: 'skipped',
        scheduled_for: new Date('2026-10-04T05:00:00.000Z'),
        action_at: new Date('2026-10-05T09:00:00.000Z')
    }

    assert.equal(pickWateringLogForSlot([neighbour, target], 'skipped', slot), target)
    assert.equal(pickWateringLogForSlot([neighbour], 'skipped', slot), null)
    assert.equal(pickWateringLogForSlot([target], 'watered', slot), null)
})

test('watering log selection falls back to the action date for legacy rows', () => {
    const slot = '2026-10-05T05:00:00.000Z'
    const legacy = {
        id: 3,
        action: 'skipped',
        scheduled_for: null,
        action_at: new Date('2026-10-05T09:00:00.000Z')
    }
    const otherDay = {
        id: 4,
        action: 'skipped',
        scheduled_for: null,
        action_at: new Date('2026-10-07T09:00:00.000Z')
    }

    assert.equal(pickWateringLogForSlot([legacy, otherDay], 'skipped', slot), legacy)
    assert.equal(pickWateringLogForSlot([], 'skipped', slot), null)
    assert.equal(pickWateringLogForSlot(undefined, 'skipped', slot), null)
    assert.equal(pickWateringLogForSlot([legacy], 'skipped', 'не дата'), null)
})

test('weekday reminders apply only to daily and week-multiple intervals', () => {
    assert.equal(weekdayRestrictionApplies(1), true)
    assert.equal(weekdayRestrictionApplies(7), true)
    assert.equal(weekdayRestrictionApplies(14), true)

    assert.equal(weekdayRestrictionApplies(4), false)
    assert.equal(weekdayRestrictionApplies(5), false)
    assert.equal(weekdayRestrictionApplies(6), false)
    assert.equal(weekdayRestrictionApplies(10), false)

    assert.equal(weekdayRestrictionApplies(0), false)
    assert.equal(weekdayRestrictionApplies(2.5), false)
    assert.equal(weekdayRestrictionApplies('7'), false)
    assert.equal(weekdayRestrictionApplies(undefined), false)
})
