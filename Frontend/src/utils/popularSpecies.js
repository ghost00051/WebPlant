export const POPULAR_SPECIES_LIMIT = 6
const MAX_SPECIES_LENGTH = 160
const MIN_SPECIES_LENGTH = 2

export const FALLBACK_POPULAR_SPECIES_SLUGS = Object.freeze([
  'monstera',
  'ficus-benjamina',
  'sansevieria',
  'spathiphyllum'
])

const DEFAULT_FALLBACK = Object.freeze([
  { species: 'Monstera deliciosa', label: 'Монстера' },
  { species: 'Ficus benjamina', label: 'Фикус' },
  { species: 'Sansevieria trifasciata', label: 'Сансевиерия' },
  { species: 'Spathiphyllum wallisii', label: 'Спатифиллум' }
])

export function normalizeSpecies(value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, MAX_SPECIES_LENGTH)
}

export function speciesKey(value) {
  return normalizeSpecies(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function normalizePlantList(plants) {
  if (!Array.isArray(plants)) return []
  return plants.filter(
    plant =>
      plant &&
      typeof plant === 'object' &&
      typeof plant.slug === 'string' &&
      typeof plant.name === 'string' &&
      typeof plant.latin === 'string'
  )
}

function latinGenus(value) {
  const key = speciesKey(value)
  const spaceIndex = key.indexOf(' ')
  return spaceIndex === -1 ? key : key.slice(0, spaceIndex)
}

export function findPopularPlant(species, plants) {
  const key = speciesKey(species)
  if (!key) return null

  const list = normalizePlantList(plants)
  const exact = list.find(plant => speciesKey(plant.latin) === key)
  if (exact) return exact

  const byName = list.find(plant => speciesKey(plant.name) === key)
  if (byName) return byName

  const genus = latinGenus(key)
  if (!genus) return null
  return list.find(plant => latinGenus(plant.latin) === genus) ?? null
}

export function popularSpeciesLabel(species, plants) {
  const normalized = normalizeSpecies(species)
  if (!normalized) return ''
  return findPopularPlant(normalized, plants)?.name ?? normalized
}

function toCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed)
}

function normalizeItem(item, plants) {
  if (!item || typeof item !== 'object') return null

  const species = normalizeSpecies(item.species)
  if (species.length < MIN_SPECIES_LENGTH) return null

  return {
    species,
    label: popularSpeciesLabel(species, plants),
    addedCount: toCount(item.addedCount ?? item.added_count),
    usersCount: toCount(item.usersCount ?? item.users_count)
  }
}

export function buildFallbackPopularSpecies({
  plants = [],
  limit = POPULAR_SPECIES_LIMIT,
  slugs = FALLBACK_POPULAR_SPECIES_SLUGS
} = {}) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : POPULAR_SPECIES_LIMIT
  const list = normalizePlantList(plants)
  const bySlug = new Map(list.map(plant => [plant.slug, plant]))
  const result = []

  for (const slug of Array.isArray(slugs) ? slugs : []) {
    if (result.length >= max) break
    const plant = bySlug.get(slug)
    if (!plant) continue

    const species = normalizeSpecies(plant.latin) || normalizeSpecies(plant.name)
    if (!species) continue
    result.push({
      species,
      label: plant.name,
      addedCount: 0,
      usersCount: 0,
      fallback: true
    })
  }

  if (result.length) return result
  return DEFAULT_FALLBACK.slice(0, max).map(item => ({ ...item, addedCount: 0, usersCount: 0, fallback: true }))
}

export function mapPopularSpecies(items, { plants = [], limit = POPULAR_SPECIES_LIMIT } = {}) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : POPULAR_SPECIES_LIMIT
  const seen = new Set()
  const result = []

  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeItem(item, plants)
    if (!normalized) continue

    const key = speciesKey(normalized.species)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= max) break
  }

  return result.length ? result : buildFallbackPopularSpecies({ plants, limit: max })
}
