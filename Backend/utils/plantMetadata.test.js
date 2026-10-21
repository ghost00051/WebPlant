import test from 'node:test'
import assert from 'node:assert/strict'

import {
    clearWateringProgress,
    hasMissedWatering,
    hasWateringProgress,
    isRemindersPaused,
    markWateringMissed,
    registerAutoSkip,
    resumeReminders,
    sanitizePlantMetadata,
    withNotificationsReset
} from './plantMetadata.js'

const missedAt = new Date('2026-10-19T06:00:00Z')

test('sanitizePlantMetadata: невалидное значение заменяется пустым объектом', () => {
    assert.deepEqual(sanitizePlantMetadata(null), {})
    assert.deepEqual(sanitizePlantMetadata('text'), {})
    assert.deepEqual(sanitizePlantMetadata([1, 2]), {})
    assert.deepEqual(sanitizePlantMetadata({ a: 1 }), { a: 1 })
})

test('markWateringMissed: фиксирует первый пропуск и сбрасывает флаги уведомлений', () => {
    const metadata = markWateringMissed(
        { notifications: { on_day: '2026-10-20T06:00:00.000Z' }, custom: 1 },
        missedAt
    )
    assert.deepEqual(metadata.notifications, {})
    assert.equal(metadata.missed_since, '2026-10-19T06:00:00.000Z')
    assert.equal(metadata.custom, 1)

    const second = markWateringMissed(metadata, new Date('2026-10-20T06:00:00Z'))
    assert.equal(second.missed_since, '2026-10-19T06:00:00.000Z')
})

test('registerAutoSkip: после трёх автопропусков напоминания ставятся на паузу', () => {
    let metadata = {}
    metadata = registerAutoSkip(metadata, { missedSince: missedAt })
    assert.equal(metadata.consecutive_skips, 1)
    assert.equal(metadata.reminders_paused, false)

    metadata = registerAutoSkip(metadata, { missedSince: missedAt })
    metadata = registerAutoSkip(metadata, { missedSince: missedAt })
    assert.equal(metadata.consecutive_skips, 3)
    assert.equal(metadata.reminders_paused, true)
    assert.equal(isRemindersPaused(metadata), true)
})

test('clearWateringProgress: снимает прогресс, но сохраняет пользовательские поля', () => {
    const cleared = clearWateringProgress({
        missed_since: '2026-10-19T06:00:00.000Z',
        reminders_paused: true,
        consecutive_skips: 3,
        notifications: { on_day: '2026-10-20T06:00:00.000Z' },
        note: 'ok'
    })
    assert.deepEqual(cleared, { notifications: { on_day: '2026-10-20T06:00:00.000Z' }, note: 'ok' })
    assert.equal(hasWateringProgress({ missed_since: '2026-10-19T06:00:00.000Z' }), true)
    assert.equal(hasWateringProgress({}), false)
    assert.equal(hasMissedWatering({ missed_since: '2026-10-19T06:00:00.000Z' }), true)
    assert.equal(hasMissedWatering({ missed_since: 'не дата' }), false)
})

test('resumeReminders: снимает паузу и счётчик, но сохраняет missed_since', () => {
    const metadata = {
        missed_since: '2026-10-19T06:00:00.000Z',
        reminders_paused: true,
        consecutive_skips: 3,
        notifications: { on_day: '2026-10-20T06:00:00.000Z' },
        note: 'ok'
    }
    const resumed = resumeReminders(metadata)
    assert.deepEqual(resumed, {
        missed_since: '2026-10-19T06:00:00.000Z',
        notifications: { on_day: '2026-10-20T06:00:00.000Z' },
        note: 'ok'
    })
    assert.equal(isRemindersPaused(resumed), false)

    assert.equal(metadata.reminders_paused, true)
})

test('withNotificationsReset: сбрасывает только notifications', () => {
    const metadata = withNotificationsReset({ notifications: { on_day: 'x' }, a: 1 })
    assert.deepEqual(metadata, { notifications: {}, a: 1 })
})
