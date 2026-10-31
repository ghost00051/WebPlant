import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeekSummary,
  pluralRu,
  weekSummaryAriaLabel,
  weekSummaryDateLabel,
  weekSummaryWindow
} from './weekSummary.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-10-27T12:00:00+03:00')

function plant(id, isMissed) {
  return { id, is_missed: Boolean(isMissed) }
}

test('weekSummaryWindow: окно — сегодня и следующие шесть дней', () => {
  const window = weekSummaryWindow(NOW, MSK)
  assert.equal(window.startIso, '2026-10-27')
  assert.equal(window.endIso, '2026-11-02')
  assert.equal(weekSummaryDateLabel(window), '27 октября — 2 ноября')
  assert.equal(weekSummaryWindow('не дата', MSK), null)
})

test('buildWeekSummary: считает поливы, подкормки и осмотры в окне недели', () => {
  const summary = buildWeekSummary({
    schedule: [
      { date: '2026-10-27', plants: [plant(1)] },
      { date: '2026-10-30', plants: [plant(2), plant(3)] },
      { date: '2026-11-02', plants: [plant(4)] },
      { date: '2026-11-04', plants: [plant(5)] }
    ],
    careItems: [
      { date: '2026-10-28', action_code: 'fertilize', title: 'Подкормка' },
      { date: '2026-10-29', action_code: 'pest_check', title: 'Осмотр на вредителей' },
      { date: '2026-10-31', action_code: 'spray', title: 'Опрыскивание' },
      { date: '2026-11-01', action_code: 'leaf_clean', title: 'Протирание листьев' },
      { date: '2026-11-03', action_code: 'fertilize', title: 'Подкормка' },
      { date: '2026-11-10', action_code: 'rotate', title: 'Поворот к свету' }
    ],
    now: NOW,
    timeZone: MSK
  })

  assert.equal(summary.waterings, 4)
  assert.equal(summary.feedings, 1)
  assert.equal(summary.inspections, 1)
  assert.equal(summary.sprays, 1)
  assert.equal(summary.other, 1)
  assert.equal(summary.total, 8)
  assert.equal(
    summary.summaryText,
    '4 полива · 1 подкормка · 1 осмотр'
  )
  assert.equal(summary.extraText, 'Ещё на неделе: 1 опрыскивание и 1 уход')
  assert.equal(
    weekSummaryAriaLabel(summary),
    'На неделю: 4 полива · 1 подкормка · 1 осмотр'
  )
})

test('buildWeekSummary: пропущенные поливы не попадают в план недели', () => {
  const summary = buildWeekSummary({
    schedule: [
      { date: '2026-10-27', plants: [plant(1, true), plant(2)] },
      { date: '2026-10-28', plants: [plant(3, true)] }
    ],
    careItems: [],
    now: NOW,
    timeZone: MSK
  })
  assert.equal(summary.waterings, 1)
  assert.equal(summary.feedings, 0)
  assert.equal(summary.inspections, 0)
  assert.equal(summary.total, 1)
})

test('buildWeekSummary: пустые данные дают нулевую сводку', () => {
  const summary = buildWeekSummary({ now: NOW, timeZone: MSK })
  assert.equal(summary.total, 0)
  assert.equal(summary.summaryText, '0 поливов · 0 подкормок · 0 осмотров')
  assert.equal(summary.extraText, '')
  assert.equal(weekSummaryAriaLabel(summary), 'На неделю планов нет')
})

test('buildWeekSummary: битые элементы не роняют расчёт', () => {
  const summary = buildWeekSummary({
    schedule: [null, { date: null, plants: [plant(1)] }, { date: '2026-10-27' }],
    careItems: [null, { date: '2026-10-27', action_code: null }],
    now: NOW,
    timeZone: MSK
  })
  assert.equal(summary.waterings, 0)
  assert.equal(summary.total, 0)
})

test('pluralRu: формы русских слов', () => {
  assert.equal(pluralRu(1, ['полив', 'полива', 'поливов']), 'полив')
  assert.equal(pluralRu(3, ['полив', 'полива', 'поливов']), 'полива')
  assert.equal(pluralRu(11, ['полив', 'полива', 'поливов']), 'поливов')
  assert.equal(pluralRu(0, ['полив', 'полива', 'поливов']), 'поливов')
  assert.equal(pluralRu('не число', ['полив', 'полива', 'поливов']), 'поливов')
})
