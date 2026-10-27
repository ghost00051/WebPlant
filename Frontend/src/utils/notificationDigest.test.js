import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDigestSummary,
  buildPlantSections,
  describeQuietWindow,
  digestActionsFor,
  groupNotificationsByPlant,
  isQuietHoursActive,
  isWateringNotification,
  notificationPlantId,
  resolvePlantName
} from './notificationDigest.js'

const items = [
  { id: 1, type: 'watering_due', plant_id: 11, title: 'Пора полить Монстеру', read_at: null },
  { id: 2, type: 'watering_due', plant_id: 11, title: 'Монстера ждёт полива', read_at: null },
  { id: 3, type: 'care_reminder', plant_id: 11, title: 'Опрыскайте Монстеру', read_at: null, payload: { action_code: 'spray' } },
  { id: 4, type: 'watering_due', plant_id: 12, title: 'Пора полить Фикус', read_at: '2026-10-27T08:00:00.000Z' },
  { id: 5, type: 'system', plant_id: null, title: 'Добро пожаловать', read_at: null }
]

test('notificationPlantId нормализует plant_id и отбрасывает мусор', () => {
  assert.equal(notificationPlantId({ plant_id: 11 }), 11)
  assert.equal(notificationPlantId({ plant_id: '12' }), 12)
  assert.equal(notificationPlantId({ plant_id: null }), null)
  assert.equal(notificationPlantId({ plant_id: 0 }), null)
  assert.equal(notificationPlantId({ plant_id: 'x' }), null)
})

test('resolvePlantName берёт имя из справочника, payload или тела', () => {
  assert.equal(resolvePlantName({ plant_id: 11 }, { 11: 'Монстера' }), 'Монстера')
  assert.equal(
    resolvePlantName({ plant_id: 99, payload: { plant_name: 'Орхидея' } }, {}),
    'Орхидея'
  )
  assert.equal(
    resolvePlantName({ plant_id: 14, body: 'Сансевиерии нужно меньше света' }, { 14: 'Сансевиерия' }),
    'Сансевиерия'
  )
  assert.equal(resolvePlantName({ plant_id: 77, body: 'без имени' }, {}), 'Растение #77')
  assert.equal(resolvePlantName({ plant_id: null }, {}), '')
})

test('groupNotificationsByPlant группирует по растению с сохранением порядка', () => {
  const sections = groupNotificationsByPlant(items, { 11: 'Монстера', 12: 'Фикус Бенджамина' })
  assert.equal(sections.length, 3)
  assert.equal(sections[0].key, 'plant-11')
  assert.equal(sections[0].plantName, 'Монстера')
  assert.equal(sections[0].items.length, 3)
  assert.equal(sections[0].unreadCount, 3)
  assert.equal(sections[0].wateringCount, 2)
  assert.equal(sections[0].careCount, 1)
  assert.equal(sections[1].key, 'plant-12')
  assert.equal(sections[1].unreadCount, 0)
  assert.equal(sections[2].key, 'misc')
  assert.equal(sections[2].items.length, 1)
})

test('buildPlantSections: digest-режим сворачивает несколько уведомлений растения', () => {
  const digest = buildPlantSections(items, {
    plantNames: { 11: 'Монстера', 12: 'Фикус Бенджамина' },
    mode: 'digest'
  })
  assert.equal(digest.plants.length, 2)
  assert.equal(digest.misc.length, 1)
  assert.equal(digest.plants[0].digest, true)
  assert.equal(digest.plants[0].actionable, true)
  assert.deepEqual(digestActionsFor(digest.plants[0]), ['water', 'care'])

  const perPlant = buildPlantSections(items, {
    plantNames: { 11: 'Монстера' },
    mode: 'per_plant'
  })
  assert.equal(perPlant.plants[0].digest, false)
  assert.equal(perPlant.mode, 'per_plant')
})

test('buildDigestSummary считает растения, которым нужен полив и уход', () => {
  const sections = groupNotificationsByPlant(items, { 11: 'Монстера', 12: 'Фикус' })
  const summary = buildDigestSummary(sections)
  assert.equal(summary.plantsToWater, 2)
  assert.equal(summary.plantsToCare, 1)
  assert.match(summary.text, /2 растения/)
  assert.match(summary.text, /полива/)

  assert.deepEqual(buildDigestSummary([]), { plantsToWater: 0, plantsToCare: 0, text: '' })
})

test('isWateringNotification распознаёт типы watering', () => {
  assert.equal(isWateringNotification({ type: 'watering_due' }), true)
  assert.equal(isWateringNotification({ type: 'morning_summary' }), true)
  assert.equal(isWateringNotification({ type: 'care_reminder' }), false)
})

test('describeQuietWindow форматирует окно, isQuietHoursActive учитывает переход через полночь', () => {
  assert.equal(describeQuietWindow({ enabled: false, start: '22:00', end: '08:00' }), '')
  assert.equal(describeQuietWindow({ enabled: true, start: '22:00', end: '08:00' }), '22:00–08:00')

  const quiet = { enabled: true, start: '22:00', end: '08:00' }
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 9, 27, 23, 30)), true)
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 9, 27, 7, 59)), true)
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 9, 27, 8, 0)), false)
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 9, 27, 15, 0)), false)
  assert.equal(isQuietHoursActive({ ...quiet, enabled: false }, new Date(2026, 9, 27, 23, 30)), false)

  const daytime = { enabled: true, start: '13:00', end: '15:00' }
  assert.equal(isQuietHoursActive(daytime, new Date(2026, 9, 27, 14, 0)), true)
  assert.equal(isQuietHoursActive(daytime, new Date(2026, 9, 27, 15, 1)), false)
})
