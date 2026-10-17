import test from 'node:test'
import assert from 'node:assert/strict'

import {
    appTimeZone,
    describePlantDay,
    diffLocalDays,
    formatLocalDay,
    localDayKey
} from './localDay.js'

const TZ = 'Europe/Moscow'

test('appTimeZone: значение из env, иначе Москва', () => {
    assert.equal(appTimeZone({ APP_TIME_ZONE: 'Asia/Novosibirsk' }), 'Asia/Novosibirsk')
    assert.equal(appTimeZone({}), 'Europe/Moscow')
    assert.equal(appTimeZone({ APP_TIME_ZONE: '' }), 'Europe/Moscow')
})

test('localDayKey: сутки считаются в переданном поясе', () => {
    const lateEveningUtc = new Date('2026-10-16T21:30:00Z')
    assert.equal(localDayKey(lateEveningUtc, TZ), '2026-10-17')
    assert.equal(localDayKey(lateEveningUtc, 'UTC'), '2026-10-16')
    assert.equal(localDayKey('не дата', TZ), null)
})

test('diffLocalDays: календарные сутки, а не разница в миллисекундах', () => {
    const now = new Date('2026-10-17T06:00:00Z')

    // Регресс: раньше «сырые» миллисекунды давали −1 (просрочен на 1 день) для растения,
    // которое пора полить сегодня.
    assert.equal(diffLocalDays('2026-10-17T05:00:00Z', now, TZ), 0)
    // И наоборот: полив завтра утром поздно вечером считался «сегодня».
    assert.equal(
        diffLocalDays('2026-10-18T05:00:00Z', new Date('2026-10-17T20:00:00Z'), TZ),
        1
    )
    assert.equal(diffLocalDays('2026-10-20T05:00:00Z', now, TZ), 3)
    assert.equal(diffLocalDays('2026-10-10T05:00:00Z', now, TZ), -7)
    assert.equal(diffLocalDays('не дата', now, TZ), null)
})

test('diffLocalDays: часовой пояс пользователя меняет сутки', () => {
    const now = new Date('2026-10-17T20:00:00Z')
    const next = '2026-10-18T05:00:00Z'

    assert.equal(diffLocalDays(next, now, 'Europe/Moscow'), 1)
    // Во Владивостоке в этот момент уже 18 октября, поэтому полив «сегодня».
    assert.equal(diffLocalDays(next, now, 'Asia/Vladivostok'), 0)
})

test('describePlantDay: подписи срока и дальняя дата', () => {
    const now = new Date('2026-10-16T09:00:00Z')
    assert.equal(describePlantDay('2026-10-16T06:00:00Z', { now, timeZone: TZ }), 'сегодня')
    assert.equal(describePlantDay('2026-10-17T06:00:00Z', { now, timeZone: TZ }), 'завтра')
    assert.equal(describePlantDay('2026-10-15T06:00:00Z', { now, timeZone: TZ }), 'вчера')
    assert.equal(describePlantDay('2026-10-01T06:00:00Z', { now, timeZone: TZ }), 'просрочен на 15 дн.')
    assert.equal(describePlantDay('2026-10-21T06:00:00Z', { now, timeZone: TZ }), 'через 5 дн.')
    assert.equal(describePlantDay('2026-11-20T06:00:00Z', { now, timeZone: TZ }), '20 ноября')
    assert.equal(describePlantDay(null, { now, timeZone: TZ }), null)
})

test('formatLocalDay: дата словами в поясе', () => {
    assert.equal(formatLocalDay('2026-11-20T06:00:00Z', TZ), '20 ноября')
    assert.equal(formatLocalDay('не дата', TZ), null)
})

test('сутки не зависят от часового пояса процесса', () => {
    const midday = new Date('2026-10-17T12:00:00Z')
    assert.equal(localDayKey(midday, 'UTC'), '2026-10-17')
    assert.equal(localDayKey(midday, 'America/Los_Angeles'), '2026-10-17')
    assert.equal(localDayKey(midday, 'Pacific/Kiritimati'), '2026-10-18')
})
