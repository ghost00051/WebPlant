import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDailyInsight,
  homeInsightAriaLabel,
  homeInsightSeenKey
} from './homeInsight.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-10-27T12:00:00+03:00')

test('buildDailyInsight: сезонный совет упоминает растения пользователя', () => {
  const insight = buildDailyInsight({
    plants: [{ id: 1, name: 'Монстера' }, { id: 2, name: 'Фикус' }],
    seasonInfo: { season: 'autumn' },
    now: NOW,
    timeZone: MSK
  })

  assert.equal(insight.title, 'Что нового')
  assert.equal(insight.dateLabel, '27 октября')
  assert.equal(insight.items[0].id, 'season-autumn')
  assert.match(insight.items[0].text, /«Монстера» и «Фикус»/)
  assert.match(insight.items[0].text, /поливайте реже/)
  assert.equal(insight.items.length, 3)
})

test('buildDailyInsight: остальные советы не пустые и не повторяются', () => {
  const insight = buildDailyInsight({
    plants: [],
    seasonInfo: { season: 'winter' },
    now: NOW,
    timeZone: MSK
  })

  const ids = insight.items.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const item of insight.items) {
    assert.ok(item.title.length > 0)
    assert.ok(item.text.length > 10)
  }
  assert.match(insight.items[0].text, /Ваши растения/)
})

test('buildDailyInsight: совет дня меняется в зависимости от даты', () => {
  const first = buildDailyInsight({
    plants: [],
    seasonInfo: { season: 'autumn' },
    now: '2026-10-27T12:00:00+03:00',
    timeZone: MSK
  })
  const second = buildDailyInsight({
    plants: [],
    seasonInfo: { season: 'autumn' },
    now: '2026-10-28T12:00:00+03:00',
    timeZone: MSK
  })
  assert.notEqual(first.items[2].id, second.items[2].id)
})

test('buildDailyInsight: без данных отдаёт осенний совет и дату', () => {
  const insight = buildDailyInsight({})
  assert.ok(insight.items.length >= 2)
  assert.equal(insight.items[0].id, 'season-autumn')
})

test('homeInsightSeenKey: ключ на текущий день в часовом поясе', () => {
  assert.equal(
    homeInsightSeenKey(NOW, MSK),
    'webplant.homeInsightSeen.2026-10-27'
  )
})

test('homeInsightAriaLabel: перечисляет заголовки советов', () => {
  const insight = buildDailyInsight({
    plants: [{ id: 1, name: 'Орхидея' }],
    seasonInfo: { season: 'summer' },
    now: NOW,
    timeZone: MSK
  })
  assert.match(homeInsightAriaLabel(insight), /^Что нового: /)
  assert.equal(homeInsightAriaLabel(null), 'Что нового')
})
