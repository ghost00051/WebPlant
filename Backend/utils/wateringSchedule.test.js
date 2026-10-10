import test from 'node:test'
import assert from 'node:assert/strict'
import {
    generateWateringOccurrences,
    findFirstWateringAfter,
    isReminderWeekday,
    resolveMissedLateness
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

    // Просрочка исторического пропуска не растёт от более поздних поливов.
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
    // Автопропуск 8 октября записал hours_late ≈ 24 («1 день»), но растение так и
    // не полили: 10 октября просрочка должна быть больше одного дня.
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
