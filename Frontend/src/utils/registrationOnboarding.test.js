import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLANT_COUNT_PRESETS,
  PLANT_COUNT_STORAGE_KEY,
  buildPlantCountRecord,
  clearPlantCountRecord,
  getPlantCountPreset,
  normalizePlantCountPreset,
  parsePlantCountRecord,
  readPlantCountRecord,
  savePlantCountPreset
} from './registrationOnboarding.js'

function createMemoryStorage (initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  }
}

test('пресеты количества растений: 1–3, 4–10, много', () => {
  assert.deepEqual(PLANT_COUNT_PRESETS.map(preset => preset.id), ['one-three', 'four-ten', 'many'])
  assert.deepEqual(PLANT_COUNT_PRESETS.map(preset => preset.label), ['1–3', '4–10', 'Много'])
  assert.equal(getPlantCountPreset('many')?.description, 'Больше 10 — целый сад')
  assert.equal(getPlantCountPreset('unknown'), null)
})

test('normalizePlantCountPreset: принимает только известные пресеты', () => {
  assert.equal(normalizePlantCountPreset('four-ten'), 'four-ten')
  assert.equal(normalizePlantCountPreset(''), '')
  assert.equal(normalizePlantCountPreset(null), '')
  assert.equal(normalizePlantCountPreset('4-10'), '')
})

test('buildPlantCountRecord: сохраняет пресет и время', () => {
  assert.deepEqual(
    buildPlantCountRecord({ preset: 'many', now: 1700000000000 }),
    { preset: 'many', savedAt: 1700000000000 }
  )
  assert.equal(buildPlantCountRecord({ preset: 'nope', now: 1700000000000 }), null)
  assert.equal(buildPlantCountRecord({ preset: 'many', now: 0 }), null)
})

test('parsePlantCountRecord: битые данные не проходят', () => {
  const valid = JSON.stringify({ preset: 'one-three', savedAt: 1700000000000 })
  assert.deepEqual(parsePlantCountRecord(valid), { preset: 'one-three', savedAt: 1700000000000 })
  assert.equal(parsePlantCountRecord(''), null)
  assert.equal(parsePlantCountRecord('{oops'), null)
  assert.equal(parsePlantCountRecord(JSON.stringify({ preset: 'other', savedAt: 1 })), null)
  assert.equal(parsePlantCountRecord(JSON.stringify({ preset: 'many', savedAt: 0 })), null)
})

test('save/read/clear: выбор переживает перезагрузку, регистрация не блокируется', () => {
  const storage = createMemoryStorage()

  assert.equal(readPlantCountRecord({ storage }), null)
  assert.equal(savePlantCountPreset('four-ten', { storage, now: 1700000000000 }), true)
  assert.deepEqual(readPlantCountRecord({ storage }), {
    preset: 'four-ten',
    savedAt: 1700000000000
  })
  assert.equal(storage.getItem(PLANT_COUNT_STORAGE_KEY) !== null, true)

  assert.equal(savePlantCountPreset('unknown', { storage }), false)
  assert.equal(clearPlantCountRecord({ storage }), true)
  assert.equal(readPlantCountRecord({ storage }), null)
})

test('savePlantCountPreset: недоступный storage не роняет регистрацию', () => {
  assert.equal(savePlantCountPreset('many', { storage: null }), false)
})
