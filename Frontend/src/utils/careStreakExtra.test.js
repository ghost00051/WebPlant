import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeStreakBreak,
  findBrokenDay,
  formatStreakDayLabel,
  freezeDaysLabel,
  hasStreakFreezeSupport,
  normalizeStreakFreeze
} from './careStreakExtra.js'

const WEEK = {
  current: 0,
  best: 4,
  days: [
    { date: '2026-10-21', status: 'on_time' },
    { date: '2026-10-22', status: 'on_time' },
    { date: '2026-10-23', status: 'late' },
    { date: '2026-10-24', status: 'skipped' },
    { date: '2026-10-25', status: 'none' }
  ]
}

test('hasStreakFreezeSupport: определяет поддержку заморозки по разным формам ответа', () => {
  assert.equal(hasStreakFreezeSupport({ current: 1 }), false)
  assert.equal(hasStreakFreezeSupport(null), false)
  assert.equal(hasStreakFreezeSupport({ freeze: { available: true } }), true)
  assert.equal(hasStreakFreezeSupport({ freezeState: {} }), true)
  assert.equal(hasStreakFreezeSupport({ freezeAvailable: true }), true)
})

test('normalizeStreakFreeze: приводит состояние заморозки', () => {
  const freeze = normalizeStreakFreeze({
    freeze: { available: true, used: false, daysLeft: 2, frozenDates: ['2026-10-24'] }
  })
  assert.deepEqual(
    {
      available: freeze.available,
      canFreeze: freeze.canFreeze,
      used: freeze.used,
      daysLeft: freeze.daysLeft,
      frozenDates: freeze.frozenDates
    },
    {
      available: true,
      canFreeze: true,
      used: false,
      daysLeft: 2,
      frozenDates: ['2026-10-24']
    }
  )
  assert.equal(normalizeStreakFreeze({}), null)

  const used = normalizeStreakFreeze({ freezeAvailable: true, freezeUsedAt: '2026-10-24T09:00:00Z' })
  assert.equal(used.used, true)
  assert.equal(used.canFreeze, false)
})

test('findBrokenDay: берёт последний пропущенный день недели', () => {
  assert.deepEqual(findBrokenDay(WEEK), { date: '2026-10-24', status: 'skipped' })
  assert.equal(findBrokenDay({ days: [] }), null)
  assert.equal(findBrokenDay(null), null)
})

test('describeStreakBreak: объясняет, почему серия прервалась', () => {
  const result = describeStreakBreak({ week: WEEK, current: 0, best: 4 })
  assert.equal(result.kind, 'broken')
  assert.equal(result.iso, '2026-10-24')
  assert.match(result.text, /Серия прервалась 24 октября/)
  assert.match(result.text, /полив не был отмечен/)
})

test('describeStreakBreak: заморозка сохраняет день', () => {
  const result = describeStreakBreak({
    week: WEEK,
    current: 0,
    best: 4,
    freeze: { frozenDates: ['2026-10-24'] }
  })
  assert.equal(result.kind, 'frozen')
  assert.match(result.text, /сохранена заморозкой/)
})

test('describeStreakBreak: без пропусков или при живой серии объяснения нет', () => {
  assert.equal(
    describeStreakBreak({ week: { days: [{ date: '2026-10-25', status: 'on_time' }] }, current: 2 }),
    null
  )
  assert.equal(describeStreakBreak({ week: WEEK, current: 3, best: 4 }), null)
  assert.equal(describeStreakBreak({}), null)
  assert.equal(
    describeStreakBreak({ week: { days: [] }, current: 0, best: 0, breakReason: 'Был перерыв' }).text,
    'Был перерыв'
  )
})

test('formatStreakDayLabel и freezeDaysLabel: русские подписи', () => {
  assert.equal(formatStreakDayLabel('2026-10-24'), '24 октября')
  assert.equal(formatStreakDayLabel(''), '')
  assert.equal(freezeDaysLabel(1), '1 день')
  assert.equal(freezeDaysLabel(3), '3 дня')
  assert.equal(freezeDaysLabel(0), '0 дней')
})
