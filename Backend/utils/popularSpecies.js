export const POPULAR_SPECIES_DEFAULT_LIMIT = 8
export const POPULAR_SPECIES_MAX_LIMIT = 20
export const POPULAR_SPECIES_MIN_SPECIES_LENGTH = 2
export const POPULAR_SPECIES_MAX_SPECIES_LENGTH = 160

export const POPULAR_SPECIES_SQL = `
    SELECT
        lower(btrim(species)) AS species_key,
        (array_agg(btrim(species) ORDER BY created_at DESC))[1] AS species,
        COUNT(*)::int AS added_count,
        COUNT(DISTINCT user_id)::int AS users_count,
        ROUND(AVG(watering_interval_days))::int AS avg_interval_days
    FROM plants
    WHERE is_active = TRUE
      AND species IS NOT NULL
      AND btrim(species) <> ''
      AND char_length(btrim(species)) BETWEEN :minLength AND :maxLength
    GROUP BY lower(btrim(species))
    ORDER BY users_count DESC, added_count DESC, species ASC
    LIMIT :limit
`

export function parsePopularSpeciesLimit(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return POPULAR_SPECIES_DEFAULT_LIMIT
  return Math.min(parsed, POPULAR_SPECIES_MAX_LIMIT)
}

function cleanSpecies(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed)
}

function toIntervalDays(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.min(365, Math.round(parsed))
}

export function normalizePopularSpeciesRows(rows, { limit = POPULAR_SPECIES_DEFAULT_LIMIT } = {}) {
  if (!Array.isArray(rows)) return []

  const max = parsePopularSpeciesLimit(limit)
  const byKey = new Map()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue

    const species = cleanSpecies(row.species ?? row.species_key)
    if (
      species.length < POPULAR_SPECIES_MIN_SPECIES_LENGTH ||
      species.length > POPULAR_SPECIES_MAX_SPECIES_LENGTH
    ) {
      continue
    }

    const key = species.toLowerCase()
    const entry = {
      species,
      addedCount: toCount(row.added_count ?? row.addedCount),
      usersCount: toCount(row.users_count ?? row.usersCount),
      avgIntervalDays: toIntervalDays(row.avg_interval_days ?? row.avgIntervalDays)
    }

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, entry)
      continue
    }

    byKey.set(key, {
      species: existing.species,
      addedCount: Math.max(existing.addedCount, entry.addedCount),
      usersCount: Math.max(existing.usersCount, entry.usersCount),
      avgIntervalDays: existing.avgIntervalDays ?? entry.avgIntervalDays
    })
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        b.usersCount - a.usersCount ||
        b.addedCount - a.addedCount ||
        a.species.localeCompare(b.species, 'ru')
    )
    .slice(0, max)
}

export function buildPopularSpeciesPayload(rows, { limit, generatedAt = new Date() } = {}) {
  const items = normalizePopularSpeciesRows(rows, { limit })
  const date = generatedAt instanceof Date && Number.isFinite(generatedAt.getTime())
    ? generatedAt
    : new Date()

  return {
    items,
    totalSpecies: items.length,
    generatedAt: date.toISOString()
  }
}

export default {
  POPULAR_SPECIES_DEFAULT_LIMIT,
  POPULAR_SPECIES_MAX_LIMIT,
  POPULAR_SPECIES_SQL,
  normalizePopularSpeciesRows,
  buildPopularSpeciesPayload,
  parsePopularSpeciesLimit
}
