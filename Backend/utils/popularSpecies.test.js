import test from 'node:test'
import assert from 'node:assert/strict'
import {
  POPULAR_SPECIES_DEFAULT_LIMIT,
  POPULAR_SPECIES_MAX_LIMIT,
  buildPopularSpeciesPayload,
  normalizePopularSpeciesRows,
  parsePopularSpeciesLimit
} from './popularSpecies.js'

test('parsePopularSpeciesLimit: дефолт, границы и мусор', () => {
  assert.equal(parsePopularSpeciesLimit(undefined), POPULAR_SPECIES_DEFAULT_LIMIT)
  assert.equal(parsePopularSpeciesLimit(''), POPULAR_SPECIES_DEFAULT_LIMIT)
  assert.equal(parsePopularSpeciesLimit('0'), POPULAR_SPECIES_DEFAULT_LIMIT)
  assert.equal(parsePopularSpeciesLimit('-4'), POPULAR_SPECIES_DEFAULT_LIMIT)
  assert.equal(parsePopularSpeciesLimit('abc'), POPULAR_SPECIES_DEFAULT_LIMIT)
  assert.equal(parsePopularSpeciesLimit('5'), 5)
  assert.equal(parsePopularSpeciesLimit(999), POPULAR_SPECIES_MAX_LIMIT)
})

test('normalizePopularSpeciesRows: отбрасывает пустые, короткие и слишком длинные виды', () => {
  const rows = [
    { species: 'Monstera deliciosa', added_count: 4, users_count: 3 },
    { species: '  ', added_count: 10, users_count: 10 },
    { species: 'A', added_count: 5, users_count: 5 },
    { species: null, added_count: 7, users_count: 6 },
    { species: 'x'.repeat(200), added_count: 2, users_count: 2 },
    null,
    'not-an-object'
  ]

  const items = normalizePopularSpeciesRows(rows)
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    species: 'Monstera deliciosa',
    addedCount: 4,
    usersCount: 3,
    avgIntervalDays: null
  })
})

test('normalizePopularSpeciesRows: дедупликация по регистру и максимумы счётчиков', () => {
  const items = normalizePopularSpeciesRows([
    { species: 'Ficus benjamina', added_count: 2, users_count: 2, avg_interval_days: 6 },
    { species: '  ficus benjamina ', added_count: 5, users_count: 4, avg_interval_days: 7 }
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].species, 'Ficus benjamina')
  assert.equal(items[0].addedCount, 5)
  assert.equal(items[0].usersCount, 4)
  assert.equal(items[0].avgIntervalDays, 6)
})

test('normalizePopularSpeciesRows: сортировка по уникальным пользователям, затем по добавлениям', () => {
  const items = normalizePopularSpeciesRows([
    { species: 'Monstera', added_count: 50, users_count: 1 },
    { species: 'Ficus', added_count: 5, users_count: 5 },
    { species: 'Sansevieria', added_count: 5, users_count: 5 }
  ])

  assert.deepEqual(items.map(item => item.species), ['Ficus', 'Sansevieria', 'Monstera'])
})

test('normalizePopularSpeciesRows: limit ограничивает и клампится к максимуму', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    species: `Species ${index}`,
    added_count: 30 - index,
    users_count: 30 - index
  }))

  assert.equal(normalizePopularSpeciesRows(rows, { limit: 3 }).length, 3)
  assert.equal(
    normalizePopularSpeciesRows(rows, { limit: 999 }).length,
    POPULAR_SPECIES_MAX_LIMIT
  )
  assert.deepEqual(normalizePopularSpeciesRows(null), [])
  assert.deepEqual(normalizePopularSpeciesRows('oops'), [])
})

test('buildPopularSpeciesPayload: стабильный контракт items/totalSpecies/generatedAt', () => {
  const payload = buildPopularSpeciesPayload(
    [
      { species: 'Phalaenopsis', added_count: 8, users_count: 6, avg_interval_days: 9 },
      { species: 'Kalanchoe', added_count: 3, users_count: 2, avg_interval_days: 12 }
    ],
    { limit: 8, generatedAt: new Date('2026-10-25T09:00:00Z') }
  )

  assert.equal(payload.totalSpecies, 2)
  assert.equal(payload.generatedAt, '2026-10-25T09:00:00.000Z')
  assert.deepEqual(payload.items[0], {
    species: 'Phalaenopsis',
    addedCount: 8,
    usersCount: 6,
    avgIntervalDays: 9
  })

  const fallbackDate = buildPopularSpeciesPayload([], { generatedAt: 'broken' })
  assert.equal(fallbackDate.totalSpecies, 0)
  assert.ok(Number.isFinite(new Date(fallbackDate.generatedAt).getTime()))
})
