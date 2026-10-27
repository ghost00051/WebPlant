export const WANTED_PLANTS_STORAGE_KEY = 'webplant-garden-wanted-plants'
export const WANTED_PLANTS_QUERY_PARAM = 'wanted_plants'
export const WANTED_PLANTS_LIMIT = 3
export const WANTED_PLANTS_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const WANTED_PLANT_TEXT_MAX = 60
export const ADD_PLANT_DRAFT_STORAGE_KEY = 'webplant-add-plant-draft'
export const ADD_PLANT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000
export const MIN_PLANT_INTERVAL_DAYS = 1
export const MAX_PLANT_INTERVAL_DAYS = 365

function sanitizeText (value, maxLength) {
  if (typeof value !== 'string') return ''
  let cleaned = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code >= 32 && code !== 127) cleaned += char
  }
  return cleaned.trim().slice(0, maxLength)
}

function normalizeIntervalDays (value) {
  const days = Number(value)
  if (!Number.isFinite(days)) return null
  const rounded = Math.round(days)
  if (rounded < MIN_PLANT_INTERVAL_DAYS || rounded > MAX_PLANT_INTERVAL_DAYS) return null
  return rounded
}

function getStorage (kind) {
  try {
    if (typeof window === 'undefined') return null
    return window[kind] || null
  } catch {
    return null
  }
}

export function normalizeWantedPlant (raw) {
  if (!raw || typeof raw !== 'object') return null

  const name = sanitizeText(raw.name, 120)
  if (!name) return null

  const species = sanitizeText(raw.species, 160)

  return {
    name,
    species,
    intervalDays: normalizeIntervalDays(raw.intervalDays)
  }
}

export function pickWantedPlants (plants, limit = WANTED_PLANTS_LIMIT) {
  if (!Array.isArray(plants)) return []
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : WANTED_PLANTS_LIMIT
  const wanted = []

  for (const plant of plants) {
    const normalized = normalizeWantedPlant(plant)
    if (!normalized) continue
    wanted.push(normalized)
    if (wanted.length >= safeLimit) break
  }

  return wanted
}

export function buildWantedPlantsQuery (plants) {
  const wanted = pickWantedPlants(plants)
  if (!wanted.length) return ''

  const values = wanted
    .map(plant => sanitizeText(plant.species || plant.name, WANTED_PLANT_TEXT_MAX))
    .filter(Boolean)

  if (!values.length) return ''
  return `${WANTED_PLANTS_QUERY_PARAM}=${encodeURIComponent(values.join(','))}`
}

export function buildGardenHandoffPath (basePath, plants) {
  if (typeof basePath !== 'string' || !basePath.startsWith('/')) return basePath || ''
  const query = buildWantedPlantsQuery(plants)
  if (!query) return basePath
  return `${basePath}${basePath.includes('?') ? '&' : '?'}${query}`
}

function normalizeStoredPlants (value) {
  if (!value || typeof value !== 'object') return []
  const savedAt = Number(value.savedAt)
  if (Number.isFinite(savedAt) && Date.now() - savedAt > WANTED_PLANTS_TTL_MS) return []
  return pickWantedPlants(Array.isArray(value.plants) ? value.plants : [])
}

function normalizeMatchText (value) {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function guideLabels (plant) {
  if (!plant || typeof plant !== 'object') return []
  return [plant.name, plant.latin, plant.species]
    .map(normalizeMatchText)
    .filter(Boolean)
}

function wantedLabels (plant) {
  const normalized = normalizeWantedPlant(plant)
  if (!normalized) return []
  return [normalizeMatchText(normalized.name), normalizeMatchText(normalized.species)]
    .filter(Boolean)
}

function wantedPlantKey (plant) {
  const normalized = normalizeWantedPlant(plant)
  if (!normalized) return ''
  return `${normalizeMatchText(normalized.name)}|${normalizeMatchText(normalized.species)}`
}

export function matchWantedPlantWithGuide (wanted, guidePlantsList) {
  const labels = wantedLabels(wanted)
  if (!labels.length || !Array.isArray(guidePlantsList)) return null

  for (const candidate of guidePlantsList) {
    const candidateLabels = guideLabels(candidate)
    if (labels.some(label => candidateLabels.includes(label))) return candidate
  }

  for (const candidate of guidePlantsList) {
    const candidateLabels = guideLabels(candidate)
    const hit = labels.some(label =>
      label.length >= 4 &&
      candidateLabels.some(
        candidateLabel =>
          candidateLabel.length >= 4 &&
          (candidateLabel.includes(label) || label.includes(candidateLabel))
      )
    )
    if (hit) return candidate
  }

  return null
}

export function matchWantedPlantsWithGuide (wantedPlants, guidePlantsList) {
  const matched = []
  const matchedSlugs = []
  const unmatched = []

  for (const wanted of pickWantedPlants(wantedPlants)) {
    const plant = matchWantedPlantWithGuide(wanted, guidePlantsList)
    const slug = typeof plant?.slug === 'string' ? plant.slug : ''
    if (!plant || !slug) {
      unmatched.push(wanted)
      continue
    }
    if (matchedSlugs.includes(slug)) continue
    matchedSlugs.push(slug)
    matched.push({ wanted, plant })
  }

  return { matched, matchedSlugs, unmatched }
}

export function rememberWantedPlants (plants) {
  const wanted = pickWantedPlants(plants)
  if (!wanted.length) return []

  const storage = getStorage('localStorage')
  if (!storage) return wanted

  try {
    storage.setItem(
      WANTED_PLANTS_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), plants: wanted })
    )
  } catch {
    return wanted
  }

  return wanted
}

export function readWantedPlants () {
  const storage = getStorage('localStorage')
  if (!storage) return []

  try {
    const raw = storage.getItem(WANTED_PLANTS_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    const wanted = normalizeStoredPlants(parsed)
    if (!wanted.length) {
      storage.removeItem(WANTED_PLANTS_STORAGE_KEY)
      return []
    }
    return wanted
  } catch {
    return []
  }
}

export function clearWantedPlants () {
  const storage = getStorage('localStorage')
  if (!storage) return false

  try {
    storage.removeItem(WANTED_PLANTS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function removeWantedPlants (plants) {
  const list = Array.isArray(plants) ? plants : []
  const keys = new Set(list.map(wantedPlantKey).filter(Boolean))
  if (!keys.size) return readWantedPlants()

  const remaining = readWantedPlants().filter(plant => !keys.has(wantedPlantKey(plant)))
  if (!remaining.length) {
    clearWantedPlants()
    return []
  }

  const storage = getStorage('localStorage')
  if (!storage) return remaining

  try {
    storage.setItem(
      WANTED_PLANTS_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), plants: remaining })
    )
  } catch {
    return remaining
  }

  return remaining
}

export function buildAddPlantDraft (plant) {
  const normalized = normalizeWantedPlant(plant)
  if (!normalized) return null

  const draft = {
    name: normalized.name,
    species: normalized.species,
    savedAt: Date.now()
  }
  if (normalized.intervalDays !== null) draft.days = normalized.intervalDays
  return draft
}

export function rememberAddPlantDraft (plant) {
  const draft = buildAddPlantDraft(plant)
  if (!draft) return false

  const storage = getStorage('sessionStorage')
  if (!storage) return false

  try {
    storage.setItem(ADD_PLANT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function readAddPlantDraft () {
  const storage = getStorage('sessionStorage')
  if (!storage) return null

  try {
    const raw = storage.getItem(ADD_PLANT_DRAFT_STORAGE_KEY)
    if (!raw) return null

    const draft = JSON.parse(raw)
    if (!draft || typeof draft !== 'object') return null

    const savedAt = Number(draft.savedAt)
    if (Number.isFinite(savedAt) && Date.now() - savedAt > ADD_PLANT_DRAFT_TTL_MS) {
      storage.removeItem(ADD_PLANT_DRAFT_STORAGE_KEY)
      return null
    }

    return draft
  } catch {
    return null
  }
}

export function clearAddPlantDraft () {
  const storage = getStorage('sessionStorage')
  if (!storage) return false

  try {
    storage.removeItem(ADD_PLANT_DRAFT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
