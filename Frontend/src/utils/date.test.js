import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diffInDays,
  toDate,
  toISODate
} from './date.js'

function localDateParts(value) {
  return [value.getFullYear(), value.getMonth(), value.getDate()]
}

test('toDate: дата без времени остаётся локальным календарным днём', () => {
  const date = toDate('2026-10-19')
  assert.deepEqual(localDateParts(date), [2026, 9, 19])
  assert.equal(toISODate(date), '2026-10-19')
})

test('toDate: ISO-дата со временем берёт локальный день того же момента', () => {
  const localMidnight = new Date(2026, 9, 19, 0, 30, 0)
  const parsed = toDate(localMidnight.toISOString())

  assert.deepEqual(localDateParts(parsed), [2026, 9, 19])
  assert.equal(toISODate(parsed), '2026-10-19')
})

test('toDate: поздний вечер по UTC не съезжает на предыдущий день', () => {
  const localLateEvening = new Date(2026, 11, 31, 23, 45, 0)
  const parsed = toDate(localLateEvening.toISOString())

  assert.deepEqual(localDateParts(parsed), [2026, 11, 31])
  assert.equal(toISODate(parsed), '2026-12-31')
})

test('toDate: Date и timestamp не меняют поведение', () => {
  const date = new Date(2026, 9, 19, 12, 0, 0)
  assert.equal(toISODate(toDate(date)), '2026-10-19')
  assert.equal(toISODate(toDate(date.getTime())), '2026-10-19')
})

test('toDate: нестандартная строка с датой использует фолбэк', () => {
  const parsed = toDate('2026-10-19T25:00:00.000Z')
  assert.equal(Number.isNaN(parsed.getTime()), false)
  assert.equal(toISODate(parsed), '2026-10-19')
})

test('diffInDays: уведомление в 00:30 того же дня считается «сегодня»', () => {
  const now = new Date(2026, 9, 19, 10, 0, 0)
  const createdAt = new Date(2026, 9, 19, 0, 30, 0).toISOString()

  assert.equal(diffInDays(createdAt, now), 0)
})

test('diffInDays: date-only строки считаются как раньше', () => {
  const now = new Date(2026, 9, 19, 10, 0, 0)

  assert.equal(diffInDays('2026-10-19', now), 0)
  assert.equal(diffInDays('2026-10-18', now), -1)
  assert.equal(diffInDays('2026-10-20', now), 1)
})
