import test from 'node:test'
import assert from 'node:assert/strict'
import { partitionScheduleDates, reminderWeekdaysForInterval, resolveWateringMarkers } from './date.js'

test('просроченная позиция расписания не показывается будущим поливом', () => {
  // Сценарий из жалобы: полив был назначен на 9 октября 19:00 MSK, не сделан,
  // и эта же позиция осталась в расписании как прошедшая. Плюс по дате есть
  // событие «просрочено» из истории.
  const now = new Date('2026-10-10T13:05:00.000Z')
  const schedule = [{
    date: '2026-10-09',
    plants: [{ id: 1, next_watering_at: '2026-10-09T16:00:00.000Z' }]
  }]

  const { planned, missed } = partitionScheduleDates(schedule, now)
  const markers = resolveWateringMarkers({
    isPlanned: planned.has('2026-10-09'),
    hasHistory: true,
    hasMissed: missed.has('2026-10-09')
  })

  assert.deepEqual(markers, { isFuture: false, isPast: false, isOverdue: true })
})

test('ещё не наступившая позиция считается планом', () => {
  const now = new Date('2026-10-10T13:05:00.000Z')
  const schedule = [{
    date: '2026-10-10',
    plants: [{ id: 1, next_watering_at: '2026-10-10T16:00:00.000Z' }]
  }]

  const { planned, missed } = partitionScheduleDates(schedule, now)

  assert.deepEqual([...planned], ['2026-10-10'])
  assert.deepEqual([...missed], [])
  assert.deepEqual(
    resolveWateringMarkers({ isPlanned: true, hasHistory: false, hasMissed: false }),
    { isFuture: true, isPast: false, isOverdue: false }
  )
})

test('на одном дне могут быть и план, и пропуск у разных растений', () => {
  const now = new Date('2026-10-10T13:05:00.000Z')
  const schedule = [{
    date: '2026-10-10',
    plants: [
      { id: 1, next_watering_at: '2026-10-10T16:00:00.000Z' },
      { id: 2, next_watering_at: '2026-10-10T05:00:00.000Z' }
    ]
  }]

  const { planned, missed } = partitionScheduleDates(schedule, now)

  assert.equal(planned.has('2026-10-10'), true)
  assert.equal(missed.has('2026-10-10'), true)
  assert.deepEqual(
    resolveWateringMarkers({ isPlanned: true, hasHistory: false, hasMissed: true }),
    { isFuture: true, isPast: false, isOverdue: true }
  )
})

test('день с завершённым поливом — прошлый полив, но пропуск его перекрывает', () => {
  assert.deepEqual(
    resolveWateringMarkers({ isPlanned: false, hasHistory: true, hasMissed: false }),
    { isFuture: false, isPast: true, isOverdue: false }
  )
  assert.deepEqual(
    resolveWateringMarkers({ isPlanned: false, hasHistory: true, hasMissed: true }),
    { isFuture: false, isPast: false, isOverdue: true }
  )
})

test('день без отметок остаётся пустым', () => {
  assert.deepEqual(
    resolveWateringMarkers({ isPlanned: false, hasHistory: false, hasMissed: false }),
    { isFuture: false, isPast: false, isOverdue: false }
  )
})

test('позиция без времени начала и пустой список не ломают разбор', () => {
  const now = new Date('2026-10-10T13:05:00.000Z')

  assert.deepEqual(
    [...partitionScheduleDates([
      { date: '2026-10-12', plants: [{ id: 1 }] },
      { date: '2026-10-13', plants: [] },
      { plants: [{ id: 2, next_watering_at: '2026-10-01T05:00:00.000Z' }] }
    ], now).planned],
    ['2026-10-12']
  )
  assert.deepEqual([...partitionScheduleDates(null, now).planned], [])
  assert.deepEqual([...partitionScheduleDates([], new Date('не дата')).missed], [])
})

test('дни недели напоминаний подбираются по частоте полива', () => {
  // 7 октября 2026 — среда (getDay() === 3).
  const start = new Date(2026, 9, 7)

  assert.deepEqual(reminderWeekdaysForInterval(7, start), [3])
  assert.deepEqual(reminderWeekdaysForInterval(14, start), [3])
  assert.deepEqual(reminderWeekdaysForInterval(1, start), [0, 1, 2, 3, 4, 5, 6])
})

test('смещающийся график не подсвечивает все дни недели', () => {
  const start = new Date(2026, 9, 7)

  // Раз в 3 дня полив попадает на разные дни недели — ограничение не накладываем.
  assert.deepEqual(reminderWeekdaysForInterval(3, start), [])
  assert.deepEqual(reminderWeekdaysForInterval(4, start), [])
  assert.deepEqual(reminderWeekdaysForInterval(10, start), [])
})

test('некорректный интервал не даёт выбранных дней', () => {
  assert.deepEqual(reminderWeekdaysForInterval(0), [])
  assert.deepEqual(reminderWeekdaysForInterval(-3), [])
  assert.deepEqual(reminderWeekdaysForInterval(2.5), [])
  assert.deepEqual(reminderWeekdaysForInterval('7'), [])
  assert.deepEqual(reminderWeekdaysForInterval(undefined), [])
})
