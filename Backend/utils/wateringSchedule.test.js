import test from 'node:test'
import assert from 'node:assert/strict'
import {
    generateWateringOccurrences,
    isReminderWeekday
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
