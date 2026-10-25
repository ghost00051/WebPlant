import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARE_ACTION_CODES,
  CARE_ACTION_GROUPS,
  CARE_ACTION_TITLES,
  CARE_GROUP_ORDER,
  careEventSummary,
  careFutureMarkersFromSchedule,
  careGroupFor,
  careMarkerTypesFromEvents,
  careMethodLabel,
  carePastMarkersFromTimeline,
  carePlannedEventsByDate,
  careTitleFor,
  hasCareMarkers,
  sortedCareGroups
} from './careEvents.js'

test('careGroups: все коды известны и сгруппированы', () => {
  assert.equal(CARE_ACTION_CODES.length, 6)
  for (const code of CARE_ACTION_CODES) {
    assert.ok(Object.hasOwn(CARE_ACTION_TITLES, code))
    assert.ok(CARE_GROUP_ORDER.includes(CARE_ACTION_GROUPS[code]))
    assert.equal(careGroupFor(code), CARE_ACTION_GROUPS[code])
    assert.ok(careTitleFor(code).length > 0)
  }
  assert.equal(careGroupFor('unknown'), null)
  assert.equal(careGroupFor(null), null)
  assert.equal(careTitleFor('unknown'), 'unknown')
})

test('careGroupFor: подкормка, опрыскивание и прочий уход', () => {
  assert.equal(careGroupFor('fertilize'), 'feed')
  assert.equal(careGroupFor('spray'), 'spray')
  assert.equal(careGroupFor('leaf_clean'), 'other')
  assert.equal(careGroupFor('rotate'), 'other')
  assert.equal(careGroupFor('pest_check'), 'other')
  assert.equal(careGroupFor('humidity_support'), 'other')
})

test('careEventSummary: продукт, дозировка и способ опрыскивания', () => {
  assert.equal(
    careEventSummary({ product_name: 'Агрикола', dose: 'половина колпачка на 1 л' }),
    'Агрикола · половина колпачка на 1 л'
  )
  assert.equal(
    careEventSummary({ product_name: 'Эпин', method: 'spray_bottle' }),
    'Эпин · пульверизатор'
  )
  assert.equal(careEventSummary({ product_name: '  ', dose: '' }), '')
  assert.equal(careEventSummary(null), '')
  assert.equal(careMethodLabel('humidifier'), 'увлажнитель')
  assert.equal(careMethodLabel('unknown'), 'unknown')
})

test('careMarkerTypesFromEvents: уникальные типы точек', () => {
  const types = careMarkerTypesFromEvents([
    { action_code: 'fertilize' },
    { action_code: 'spray' },
    { action_code: 'spray' },
    { action_code: 'leaf_clean' },
    { action_code: 'unknown' },
    null
  ])
  assert.deepEqual([...types].sort(), ['feed', 'other', 'spray'])
  assert.deepEqual(sortedCareGroups(types), ['feed', 'spray', 'other'])
})

test('carePastMarkersFromTimeline: карта дата → типы ухода', () => {
  const map = carePastMarkersFromTimeline([
    {
      date: '2026-10-25',
      events: [
        { kind: 'watered' },
        { kind: 'care', action_code: 'fertilize' },
        { kind: 'care', action_code: 'spray' }
      ]
    },
    {
      date: '2026-10-18',
      events: [{ kind: 'care', action_code: 'rotate' }]
    },
    { date: '2026-10-17', events: [{ kind: 'watered' }] },
    null
  ])

  assert.equal(map.size, 2)
  assert.deepEqual(sortedCareGroups(map.get('2026-10-25')), ['feed', 'spray'])
  assert.deepEqual(sortedCareGroups(map.get('2026-10-18')), ['other'])
  assert.equal(map.has('2026-10-17'), false)
})

test('careFutureMarkersFromSchedule: плановые действия по датам', () => {
  const map = careFutureMarkersFromSchedule([
    { date: '2026-10-29', action_code: 'fertilize', plant_id: 1 },
    { date: '2026-10-29', action_code: 'leaf_clean', plant_id: 2 },
    { date: '2026-11-02', action_code: 'spray', plant_id: 1 },
    { action_code: 'fertilize' },
    null
  ])

  assert.equal(map.size, 2)
  assert.deepEqual(sortedCareGroups(map.get('2026-10-29')), ['feed', 'other'])
  assert.deepEqual(sortedCareGroups(map.get('2026-11-02')), ['spray'])
})

test('carePlannedEventsByDate: плановые действия сгруппированы по датам', () => {
  const map = carePlannedEventsByDate([
    {
      date: '2026-10-28',
      action_code: 'fertilize',
      title: 'Подкормка «Агрикола»',
      plant_id: 1,
      plant_name: 'Монстера'
    },
    {
      date: '2026-10-28',
      action_code: 'leaf_clean',
      plant_id: 2,
      plant_name: 'Фикус'
    },
    {
      date: '2026-11-01',
      action_code: 'spray',
      plant_id: 1,
      plant_name: 'Монстера'
    }
  ])

  assert.equal(map.size, 2)
  assert.equal(map.get('2026-10-28').length, 2)
  assert.deepEqual(map.get('2026-10-28')[0], {
    action_code: 'fertilize',
    title: 'Подкормка «Агрикола»',
    plant_id: 1,
    plant_name: 'Монстера'
  })
  assert.equal(map.get('2026-10-28')[1].title, 'Протирание листьев')
  assert.deepEqual(map.get('2026-11-01'), [
    {
      action_code: 'spray',
      title: 'Опрыскивание',
      plant_id: 1,
      plant_name: 'Монстера'
    }
  ])
})

test('carePlannedEventsByDate: битые элементы отбрасываются', () => {
  const map = carePlannedEventsByDate([
    null,
    'мусор',
    { action_code: 'fertilize' },
    { date: 42, action_code: 'fertilize' },
    { date: '2026-10-28' },
    { date: '2026-10-28', action_code: 'unknown' }
  ])

  assert.equal(map.size, 1)
  assert.equal(map.get('2026-10-28').length, 1)
  assert.equal(map.get('2026-10-28')[0].title, 'unknown')
})

test('carePlannedEventsByDate: пустой и некорректный вход', () => {
  assert.equal(carePlannedEventsByDate([]).size, 0)
  assert.equal(carePlannedEventsByDate(null).size, 0)
  assert.equal(carePlannedEventsByDate(undefined).size, 0)
  assert.equal(carePlannedEventsByDate('2026-10-28').size, 0)
})

test('carePlannedEventsByDate: plant_name fallback', () => {
  const items = carePlannedEventsByDate([
    { date: '2026-10-28', action_code: 'rotate', plant_id: 7, plant_name: '  ' },
    { date: '2026-10-28', action_code: 'rotate', plant_id: null }
  ]).get('2026-10-28')

  assert.equal(items[0].plant_name, '')
  assert.equal(items[1].plant_name, '')
  assert.equal(items[1].plant_id, null)
})

test('hasCareMarkers: пустые карты не включают легенду ухода', () => {
  assert.equal(hasCareMarkers(new Map(), new Map()), false)
  assert.equal(hasCareMarkers(undefined, new Map()), false)
  assert.equal(hasCareMarkers(new Map([['2026-10-25', new Set(['feed'])]]), new Map()), true)
})
