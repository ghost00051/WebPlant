export const PLANT_COUNT_STORAGE_KEY = 'webplant_registration_plant_count'
export const ADD_PLANT_PATH = '/add-plant'
export const ADD_PLANT_MULTI_PATH = '/add-plant?multi=1'

export const PLANT_COUNT_PRESETS = Object.freeze([
  { id: 'one-three', label: '1–3', description: 'Пара любимых растений' },
  { id: 'four-ten', label: '4–10', description: 'Небольшая коллекция' },
  { id: 'many', label: 'Много', description: 'Больше 10 — целый сад' }
])

const PRESET_IDS = new Set(PLANT_COUNT_PRESETS.map(preset => preset.id))

export function normalizePlantCountPreset (value) {
  return PRESET_IDS.has(value) ? value : ''
}

export function getPlantCountPreset (value) {
  const id = normalizePlantCountPreset(value)
  return PLANT_COUNT_PRESETS.find(preset => preset.id === id) ?? null
}

export function buildOnboardingAddPlantPath (preset) {
  const id = normalizePlantCountPreset(preset)
  return id === 'many' ? ADD_PLANT_MULTI_PATH : ADD_PLANT_PATH
}

export function readPlantCountPreset ({ storage } = {}) {
  return readPlantCountRecord({ storage })?.preset ?? ''
}

export function buildPlantCountRecord ({ preset, now = Date.now() } = {}) {
  const id = normalizePlantCountPreset(preset)
  const savedAt = Number(now)
  if (!id) return null
  if (!Number.isFinite(savedAt) || savedAt <= 0) return null
  return { preset: id, savedAt }
}

export function parsePlantCountRecord (raw) {
  if (typeof raw !== 'string' || !raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const preset = normalizePlantCountPreset(parsed.preset)
  const savedAt = Number(parsed.savedAt)
  if (!preset || !Number.isFinite(savedAt) || savedAt <= 0) return null
  return { preset, savedAt }
}

function resolveStorage (storage) {
  if (
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage
  }

  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null
  } catch {
    return null
  }
}

export function savePlantCountPreset (preset, { storage, now = Date.now() } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  const record = buildPlantCountRecord({ preset, now })
  if (!record) return false

  try {
    target.setItem(PLANT_COUNT_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch (error) {
    console.warn('Не удалось сохранить количество растений:', error)
    return false
  }
}

export function readPlantCountRecord ({ storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return null

  try {
    return parsePlantCountRecord(target.getItem(PLANT_COUNT_STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearPlantCountRecord ({ storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  try {
    target.removeItem(PLANT_COUNT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
