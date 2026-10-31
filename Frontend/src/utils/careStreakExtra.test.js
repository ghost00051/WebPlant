import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeStreakBreak,
  findBrokenDay,
  formatStreakDayLabel,
  freezeDaysLabel,
  hasStreakFreezeSupport,
  normalizeBreakReason,
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

test('normalizeStreakFreeze: новые поля бэкенда freeze.available/canFreeze/used/frozenDates', () => {
  const available = normalizeStreakFreeze({
    freeze: { available: true, canFreeze: true, used: false, frozenDates: [] }
  })
  assert.equal(available.available, true)
  assert.equal(available.canFreeze, true)
  assert.equal(available.used, false)
  assert.deepEqual(available.frozenDates, [])

  const used = normalizeStreakFreeze({
    freeze: { available: true, canFreeze: false, used: true, frozenDates: ['2026-10-24'] }
  })
  assert.equal(used.used, true)
  assert.equal(used.canFreeze, false)
  assert.deepEqual(used.frozenDates, ['2026-10-24'])

  const disabled = normalizeStreakFreeze({ freeze: { available: false, used: false } })
  assert.equal(disabled.available, false)
  assert.equal(disabled.canFreeze, false)

  const backendShape = normalizeStreakFreeze({
    freeze: {
      available: false,
      canFreeze: false,
      used: true,
      daysLeft: 0,
      usedFreezes: [{ localDate: '2026-10-24' }],
      frozenDates: []
    }
  })
  assert.equal(backendShape.used, true)
  assert.equal(backendShape.available, false)
  assert.deepEqual(backendShape.frozenDates, ['2026-10-24'])
})

test('normalizeStreakFreeze: обратная совместимость со старой формой ответа', () => {
  const legacy = normalizeStreakFreeze({
    freeze: {
      enabled: true,
      perWeek: 1,
      usedThisWeek: 1,
      availableThisWeek: 0,
      usedTotal: 2,
      used: [
        { localDate: '2026-10-24', at: '2026-10-24T09:00:00Z' },
        { localDate: '2026-10-17', at: '2026-10-17T09:00:00Z' }
      ]
    }
  })

  assert.equal(legacy.available, true)
  assert.equal(legacy.used, true)
  assert.equal(legacy.canFreeze, false)
  assert.equal(legacy.daysLeft, 0)
  assert.deepEqual(legacy.frozenDates, ['2026-10-24', '2026-10-17'])

  const freshWeek = normalizeStreakFreeze({
    freeze: { enabled: true, perWeek: 1, usedThisWeek: 0, availableThisWeek: 1, used: [] }
  })
  assert.equal(freshWeek.used, false)
  assert.equal(freshWeek.daysLeft, 1)

  const disabled = normalizeStreakFreeze({ freeze: { enabled: false, perWeek: 0 } })
  assert.equal(disabled.available, false)
})

test('normalizeBreakReason: понимает breakReason и старый streakBreak', () => {
  assert.equal(normalizeBreakReason({ breakReason: ' Был перерыв ' }), 'Был перерыв')
  assert.equal(normalizeBreakReason({ breakReason: 'late_watering' }), 'Полив с опозданием')
  assert.equal(
    normalizeBreakReason({ streakBreak: { reason: 'skipped', localDate: '2026-10-24' } }),
    'Пропущен полив 24 октября'
  )
  assert.equal(normalizeBreakReason({ streakBreak: { message: 'Серия сброшена' } }), 'Серия сброшена')
  assert.equal(normalizeBreakReason({ streakBreak: 'Был перерыв' }), 'Был перерыв')
  assert.equal(normalizeBreakReason({ streakBreak: null }), '')
  assert.equal(normalizeBreakReason(null), '')
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
  assert.match(result.text, /первый пропуск в неделю прощается автоматически/i)
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
  assert.match(result.text, /прощается автоматически/)
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
