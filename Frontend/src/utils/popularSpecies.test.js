import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_POPULAR_SPECIES_SLUGS,
  POPULAR_SPECIES_LIMIT,
  buildFallbackPopularSpecies,
  findPopularPlant,
  mapPopularSpecies,
  normalizeSpecies,
  popularSpeciesLabel,
  speciesKey
} from './popularSpecies.js'

const PLANTS_FIXTURE = [
  { slug: 'monstera', name: 'Монстера', latin: 'Monstera deliciosa' },
  { slug: 'ficus-benjamina', name: 'Фикус Бенджамина', latin: 'Ficus benjamina' },
  { slug: 'sansevieria', name: 'Сансевиерия', latin: 'Sansevieria trifasciata' },
  { slug: 'spathiphyllum', name: 'Спатифиллум', latin: 'Spathiphyllum wallisii' },
  { slug: 'broken-card' }
]

test('normalizeSpecies/speciesKey: обрезает, схлопывает пробелы и ё', () => {
  assert.equal(normalizeSpecies('  Monstera deliciosa  '), 'Monstera deliciosa')
  assert.equal(normalizeSpecies(null), '')
  assert.equal(normalizeSpecies('x'.repeat(300)).length, 160)
  assert.equal(speciesKey('  ФИКУС   Бенджамина '), 'фикус бенджамина')
  assert.equal(speciesKey('Клён ёлка'), 'клен елка')
})

test('findPopularPlant: точное совпадение по латыни, затем по имени, затем по роду', () => {
  assert.equal(findPopularPlant('Monstera deliciosa', PLANTS_FIXTURE).slug, 'monstera')
  assert.equal(findPopularPlant('  monstera DELICIOSA ', PLANTS_FIXTURE).slug, 'monstera')
  assert.equal(findPopularPlant('Сансевиерия', PLANTS_FIXTURE).slug, 'sansevieria')
  assert.equal(findPopularPlant('Monstera', PLANTS_FIXTURE).slug, 'monstera')
  assert.equal(findPopularPlant('Ficus', PLANTS_FIXTURE).slug, 'ficus-benjamina')
  assert.equal(findPopularPlant('Monstera', []), null)
  assert.equal(findPopularPlant('', PLANTS_FIXTURE), null)
})

test('popularSpeciesLabel: русское имя из справочника, иначе исходный species', () => {
  assert.equal(popularSpeciesLabel('Monstera deliciosa', PLANTS_FIXTURE), 'Монстера')
  assert.equal(popularSpeciesLabel('Phalaenopsis', PLANTS_FIXTURE), 'Phalaenopsis')
  assert.equal(popularSpeciesLabel('', PLANTS_FIXTURE), '')
})

test('mapPopularSpecies: нормализует ответ API, дедуплицирует и ограничивает', () => {
  const items = [
    { species: ' Monstera deliciosa ', addedCount: 5, usersCount: 4 },
    { species: 'monstera DELICIOSA', addedCount: 9, usersCount: 7 },
    { species: 'Ficus', addedCount: 3, usersCount: 2 },
    { species: 'A', addedCount: 100, usersCount: 100 },
    { species: null, addedCount: 10, usersCount: 10 }
  ]

  const mapped = mapPopularSpecies(items, { plants: PLANTS_FIXTURE, limit: 3 })
  assert.equal(mapped.length, 2)
  assert.deepEqual(mapped[0], {
    species: 'Monstera deliciosa',
    label: 'Монстера',
    addedCount: 5,
    usersCount: 4
  })
  assert.equal(mapped[1].species, 'Ficus')
  assert.equal(mapped[1].label, 'Фикус Бенджамина')

  const limited = mapPopularSpecies(
    [
      { species: 'Monstera', addedCount: 1, usersCount: 1 },
      { species: 'Ficus', addedCount: 1, usersCount: 1 },
      { species: 'Sansevieria', addedCount: 1, usersCount: 1 }
    ],
    { plants: PLANTS_FIXTURE, limit: 2 }
  )
  assert.equal(limited.length, 2)
})

test('mapPopularSpecies: пустой ответ API даёт резервный список из справочника', () => {
  const fallback = mapPopularSpecies([], { plants: PLANTS_FIXTURE })
  assert.equal(fallback.length, FALLBACK_POPULAR_SPECIES_SLUGS.length)
  assert.deepEqual(
    fallback.map(item => item.species),
    ['Monstera deliciosa', 'Ficus benjamina', 'Sansevieria trifasciata', 'Spathiphyllum wallisii']
  )
  assert.ok(fallback.every(item => item.fallback === true && item.addedCount === 0))
  assert.equal(fallback[0].label, 'Монстера')

  const broken = mapPopularSpecies(null, { plants: PLANTS_FIXTURE })
  assert.equal(broken.length, FALLBACK_POPULAR_SPECIES_SLUGS.length)

  const withoutPlants = mapPopularSpecies([], { plants: [] })
  assert.ok(withoutPlants.length > 0)
  assert.equal(withoutPlants[0].label, 'Монстера')
  assert.ok(withoutPlants.every(item => item.fallback === true))
})

test('buildFallbackPopularSpecies: limit и порядок слагов', () => {
  const result = buildFallbackPopularSpecies({
    plants: PLANTS_FIXTURE,
    limit: 2,
    slugs: ['unknown', 'sansevieria', 'monstera']
  })
  assert.deepEqual(result.map(item => item.species), [
    'Sansevieria trifasciata',
    'Monstera deliciosa'
  ])

  assert.equal(POPULAR_SPECIES_LIMIT, 6)
})
