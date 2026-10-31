import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeekDays,
  describeWeekProgress,
  formatRecapDate,
  hasCareStreakData,
  normalizeWeekDayStatus,
  pluralRu,
  streakCountLabel,
  weekProgressPercent
} from './careStreak.js'

test('pluralRu: выбирает форму по числу', () => {
  assert.equal(pluralRu(1, ['полив', 'полива', 'поливов']), 'полив')
  assert.equal(pluralRu(3, ['полив', 'полива', 'поливов']), 'полива')
  assert.equal(pluralRu(11, ['полив', 'полива', 'поливов']), 'поливов')
  assert.equal(pluralRu(21, ['полив', 'полива', 'поливов']), 'полив')
  assert.equal(pluralRu(0, ['полив', 'полива', 'поливов']), 'поливов')
})

test('streakCountLabel: подписывает число поливов', () => {
  assert.equal(streakCountLabel(5), '5 поливов')
  assert.equal(streakCountLabel(1), '1 полив')
  assert.equal(streakCountLabel(null), '0 поливов')
})

test('describeWeekProgress: формат «3 из 4 поливов, 2 фото»', () => {
  assert.equal(
    describeWeekProgress({ scheduled: 4, wateredOnTime: 2, wateredLate: 1, photos: 2 }),
    '3 из 4 поливов, 2 фото'
  )
})

test('describeWeekProgress: без плана показывает число поливов', () => {
  assert.equal(
    describeWeekProgress({ scheduled: 0, wateredOnTime: 2 }),
    '2 полива'
  )
})

test('describeWeekProgress: учитывает уход и пропуски', () => {
  assert.equal(
    describeWeekProgress({ scheduled: 2, wateredOnTime: 2, careActions: 3, skipped: 1 }),
    '2 из 2 поливов, 3 действия ухода, 1 пропуск'
  )
})

test('describeWeekProgress: пустая неделя даёт пустую строку', () => {
  assert.equal(describeWeekProgress({}), '')
  assert.equal(describeWeekProgress(null), '')
})

test('weekProgressPercent: считает долю выполненных поливов', () => {
  assert.equal(weekProgressPercent({ scheduled: 4, wateredOnTime: 1 }), 25)
  assert.equal(weekProgressPercent({ scheduled: 4, wateredOnTime: 4 }), 100)
  assert.equal(weekProgressPercent({ scheduled: 0, wateredOnTime: 2 }), 100)
  assert.equal(weekProgressPercent({}), 0)
})

test('normalizeWeekDayStatus: понимает разные статусы бэкенда', () => {
  assert.equal(normalizeWeekDayStatus('on_time'), 'on-time')
  assert.equal(normalizeWeekDayStatus('watered'), 'on-time')
  assert.equal(normalizeWeekDayStatus('late'), 'late')
  assert.equal(normalizeWeekDayStatus('watered_late'), 'late')
  assert.equal(normalizeWeekDayStatus('skipped'), 'skipped')
  assert.equal(normalizeWeekDayStatus('missed'), 'skipped')
  assert.equal(normalizeWeekDayStatus('scheduled'), 'planned')
  assert.equal(normalizeWeekDayStatus('unknown-value'), 'none')
  assert.equal(normalizeWeekDayStatus(null), 'none')
})

test('buildWeekDays: подписывает дни недели и статусы', () => {
  const days = [
    { date: '2026-10-19', status: 'on_time' },
    { date: '2026-10-20', status: 'late' },
    { date: '2026-10-21', status: 'skipped' },
    { date: '2026-10-22', status: 'scheduled' }
  ]
  const result = buildWeekDays(days, new Date('2026-10-21T12:00:00'))

  assert.equal(result.length, 4)
  assert.equal(result[0].label, 'пн')
  assert.equal(result[0].status, 'on-time')
  assert.equal(result[1].status, 'late')
  assert.equal(result[2].status, 'skipped')
  assert.equal(result[3].status, 'planned')
  assert.equal(result[2].isToday, true)
  assert.equal(result[0].isToday, false)
  assert.match(result[0].title, /Понедельник.*полив вовремя/)
})

test('buildWeekDays: ограничивает неделю семью днями', () => {
  const days = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-10-${String(19 + index).padStart(2, '0')}`,
    status: 'on_time'
  }))
  assert.equal(buildWeekDays(days).length, 7)
  assert.deepEqual(buildWeekDays(null), [])
})

test('formatRecapDate: форматирует дату итогов недели', () => {
  const now = new Date()
  const sameYear = new Date(now.getFullYear(), 9, 19, 10, 0, 0)
  assert.equal(formatRecapDate(sameYear.toISOString()), '19 октября')

  const otherYear = new Date(now.getFullYear() - 1, 9, 19, 10, 0, 0)
  assert.equal(
    formatRecapDate(otherYear.toISOString()),
    `19 октября ${now.getFullYear() - 1}`
  )
  assert.equal(formatRecapDate(''), '')
  assert.equal(formatRecapDate('не дата'), '')
})

test('hasCareStreakData: отличает пустое состояние от данных', () => {
  assert.equal(hasCareStreakData(null), false)
  assert.equal(hasCareStreakData({ current: 0, best: 0, week: {} }), false)
  assert.equal(hasCareStreakData({ current: 3, best: 5, week: {} }), true)
  assert.equal(
    hasCareStreakData({ current: 0, best: 0, week: { photos: 2 } }),
    true
  )
  assert.equal(
    hasCareStreakData({ current: 0, best: 0, week: {}, latestRecap: { title: 'Итоги' } }),
    true
  )
})
