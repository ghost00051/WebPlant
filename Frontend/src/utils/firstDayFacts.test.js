import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFirstDayFacts,
  daysSinceCreated,
  firstDayDismissKey,
  matchGuidePlant,
  resolveNextWateringAt,
  selectFirstDayPlant
} from './firstDayFacts.js'

const NOW = new Date('2026-10-27T12:00:00+03:00')

test('matchGuidePlant: находит растение справочника по виду и названию', () => {
  assert.equal(matchGuidePlant({ species: 'Monstera deliciosa' })?.slug, 'monstera')
  assert.equal(matchGuidePlant({ name: 'Монстера' })?.slug, 'monstera')
  assert.equal(matchGuidePlant({ name: 'Фикус Бенджамина' })?.slug, 'ficus-benjamina')
  assert.equal(matchGuidePlant({ name: 'Неизвестное растение' }), null)
  assert.equal(matchGuidePlant({}), null)
  assert.equal(matchGuidePlant(null), null)
})

test('daysSinceCreated: считает возраст растения в днях', () => {
  assert.equal(
    daysSinceCreated({ createdAt: '2026-10-27T08:00:00+03:00' }, NOW),
    0
  )
  assert.equal(
    daysSinceCreated({ createdAt: '2026-10-24T08:00:00+03:00' }, NOW),
    3
  )
  assert.equal(daysSinceCreated({ createdAt: 'не дата' }, NOW), null)
  assert.equal(daysSinceCreated({}, NOW), null)
})

test('selectFirstDayPlant: берёт только растение, добавленное за последние сутки', () => {
  const plants = [
    { id: 1, createdAt: '2026-10-01T09:00:00+03:00' },
    { id: 2, createdAt: '2026-10-27T08:00:00+03:00' },
    { id: 3, createdAt: '2026-10-26T14:00:00+03:00' }
  ]
  assert.equal(selectFirstDayPlant(plants, { now: NOW })?.id, 2)
  assert.equal(
    selectFirstDayPlant([plants[0], plants[2]], { now: NOW, maxAgeHours: 48 })?.id,
    3,
    'при окне 48 часов растение вчерашнего дня тоже подходит'
  )
  assert.equal(selectFirstDayPlant([], { now: NOW }), null)
  assert.equal(selectFirstDayPlant([{ id: 4 }], { now: NOW }), null)
})

test('firstDayDismissKey: ключ привязан к растению и дню', () => {
  assert.equal(
    firstDayDismissKey(16, NOW),
    'webplant.firstDayDismissed.16.2026-10-27'
  )
  assert.equal(firstDayDismissKey(null, NOW), '')
})

test('resolveNextWateringAt: плановая дата важнее расчётной', () => {
  const planned = resolveNextWateringAt(
    {
      next_watering_at: '2026-10-30T09:00:00+03:00',
      last_watered_at: '2026-10-20T09:00:00+03:00',
      watering_interval_days: 7
    },
    NOW
  )
  assert.equal(planned.toISOString(), '2026-10-30T06:00:00.000Z')

  const calculated = resolveNextWateringAt(
    {
      last_watered_at: '2026-10-24T09:00:00+03:00',
      watering_interval_days: 7
    },
    NOW
  )
  assert.equal(calculated.getDate(), 31)
  assert.equal(calculated.getMonth(), 9)
  assert.equal(resolveNextWateringAt({}, NOW), null)
})

test('buildFirstDayFacts: первый полив, интервал с сезоном и свет', () => {
  const facts = buildFirstDayFacts({
    plant: {
      id: 16,
      name: 'Монстера',
      species: 'Monstera deliciosa',
      watering_interval_days: 7,
      createdAt: '2026-10-27T08:00:00+03:00',
      next_watering_at: '2026-10-28T09:00:00+03:00'
    },
    now: NOW,
    seasonInfo: { season: 'autumn' }
  })

  assert.equal(facts.length, 3)
  assert.deepEqual(
    facts.map(fact => fact.id),
    ['watering', 'interval', 'light']
  )
  assert.equal(facts[0].title, 'Первый полив')
  assert.match(facts[0].text, /завтра/)
  assert.equal(facts[1].title, 'Почему раз в 7 дней')
  assert.match(facts[1].text, /осенью/i)
  assert.match(facts[1].text, /7–10 дней/i)
  assert.match(facts[2].text, /Яркий рассеянный свет/)
})

test('buildFirstDayFacts: после полива подпись меняется на «Следующий полив»', () => {
  const facts = buildFirstDayFacts({
    plant: {
      id: 17,
      name: 'Орхидея',
      species: 'Phalaenopsis',
      watering_interval_days: 10,
      last_watered_at: '2026-10-25T09:00:00+03:00',
      createdAt: '2026-10-20T09:00:00+03:00'
    },
    now: NOW,
    seasonInfo: { season: 'autumn' }
  })

  assert.equal(facts[0].title, 'Следующий полив')
  assert.match(facts[0].text, /4 ноября/)
  assert.match(facts[0].text, /через 8 дней/)
})

test('buildFirstDayFacts: без растения и интервала не падает', () => {
  assert.deepEqual(buildFirstDayFacts({}), [])
  assert.deepEqual(buildFirstDayFacts(null), [])
  const facts = buildFirstDayFacts({
    plant: { id: 1, name: 'Неизвестное', createdAt: NOW.toISOString() },
    now: NOW,
    seasonInfo: { season: 'winter' }
  })
  assert.ok(facts.length >= 1)
  assert.ok(facts.some(fact => fact.id === 'light'))
  assert.ok(facts.some(fact => fact.id === 'season' || fact.id === 'interval'))
})
