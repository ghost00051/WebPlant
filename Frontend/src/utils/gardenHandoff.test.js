import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADD_PLANT_DRAFT_STORAGE_KEY,
  MAX_PLANT_INTERVAL_DAYS,
  WANTED_PLANTS_LIMIT,
  WANTED_PLANTS_QUERY_PARAM,
  WANTED_PLANTS_STORAGE_KEY,
  buildAddPlantDraft,
  buildGardenHandoffPath,
  buildWantedPlantsQuery,
  clearAddPlantDraft,
  clearWantedPlants,
  matchWantedPlantWithGuide,
  matchWantedPlantsWithGuide,
  normalizeWantedPlant,
  pickWantedPlants,
  readAddPlantDraft,
  readWantedPlants,
  rememberAddPlantDraft,
  rememberWantedPlants,
  removeWantedPlants
} from './gardenHandoff.js'

const GARDEN_PLANTS = [
  { name: 'Монстера', species: 'Monstera deliciosa', intervalDays: 7 },
  { name: 'Фикус Бенджамина', species: 'Ficus benjamina', intervalDays: 5 },
  { name: 'Орхидея', species: 'Phalaenopsis', intervalDays: 10 },
  { name: 'Сансевиерия', species: 'Sansevieria trifasciata', intervalDays: 14 }
]

function withStorage (run) {
  const local = new Map()
  const session = new Map()
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: key => (local.has(key) ? local.get(key) : null),
      setItem: (key, value) => local.set(key, String(value)),
      removeItem: key => local.delete(key)
    },
    sessionStorage: {
      getItem: key => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: key => session.delete(key)
    }
  }

  try {
    return run({ local, session })
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
}

test('normalizeWantedPlant: имя обязательно, интервал клампится', () => {
  assert.deepEqual(
    normalizeWantedPlant({ name: '  Монстера ', species: ' Monstera deliciosa ', intervalDays: '7' }),
    { name: 'Монстера', species: 'Monstera deliciosa', intervalDays: 7 }
  )
  assert.deepEqual(
    normalizeWantedPlant({ name: 'Кактус', intervalDays: 0 }),
    { name: 'Кактус', species: '', intervalDays: null }
  )
  assert.equal(normalizeWantedPlant({ name: '', species: 'Ficus' }), null)
  assert.equal(normalizeWantedPlant(null), null)
  assert.equal(normalizeWantedPlant({ name: 42 }), null)
})

test('normalizeWantedPlant: обрезает длинные строки и выкидывает управляющие символы', () => {
  const normalized = normalizeWantedPlant({
    name: 'А'.repeat(200),
    species: 'B\u0000C',
    intervalDays: MAX_PLANT_INTERVAL_DAYS + 10
  })

  assert.equal(normalized.name.length, 120)
  assert.equal(normalized.species, 'BC')
  assert.equal(normalized.intervalDays, null)
})

test('pickWantedPlants: берёт не больше трёх растений и пропускает мусор', () => {
  const wanted = pickWantedPlants([...GARDEN_PLANTS, { name: '' }, null, undefined])

  assert.equal(wanted.length, WANTED_PLANTS_LIMIT)
  assert.deepEqual(wanted.map(plant => plant.name), [
    'Монстера',
    'Фикус Бенджамина',
    'Орхидея'
  ])
  assert.deepEqual(pickWantedPlants(GARDEN_PLANTS, 1).map(plant => plant.species), ['Monstera deliciosa'])
  assert.deepEqual(pickWantedPlants(null), [])
})

test('buildWantedPlantsQuery: компактная utf-метка для регистрации', () => {
  const query = buildWantedPlantsQuery(GARDEN_PLANTS)

  assert.ok(query.startsWith(`${WANTED_PLANTS_QUERY_PARAM}=`))
  const decoded = decodeURIComponent(query.split('=').slice(1).join('='))
  assert.equal(decoded, 'Monstera deliciosa,Ficus benjamina,Phalaenopsis')
  assert.equal(buildWantedPlantsQuery([]), '')
  assert.equal(buildWantedPlantsQuery([{ name: '' }]), '')
})

test('buildGardenHandoffPath: добавляет растения к пути регистрации', () => {
  const base = '/register?utm_source=share&utm_medium=garden&utm_campaign=token123'
  const path = buildGardenHandoffPath(base, GARDEN_PLANTS)

  assert.ok(path.startsWith(`${base}&${WANTED_PLANTS_QUERY_PARAM}=`))
  assert.equal(
    buildGardenHandoffPath(base, []),
    base
  )
  assert.equal(
    buildGardenHandoffPath('/register', GARDEN_PLANTS).slice(0, 10),
    '/register?'
  )
  assert.equal(buildGardenHandoffPath('', GARDEN_PLANTS), '')
  assert.equal(buildGardenHandoffPath('/garden/token', null), '/garden/token')
})

test('rememberWantedPlants/readWantedPlants: localStorage хранит первые три растения', () => {
  withStorage(({ local }) => {
    assert.deepEqual(readWantedPlants(), [])
    const stored = rememberWantedPlants(GARDEN_PLANTS)

    assert.equal(stored.length, WANTED_PLANTS_LIMIT)
    assert.equal(local.has(WANTED_PLANTS_STORAGE_KEY), true)

    const restored = readWantedPlants()
    assert.deepEqual(restored, stored)
    assert.equal(restored[0].name, 'Монстера')
  })
})

test('readWantedPlants: испорченное и просроченное значение не ломает страницу', () => {
  withStorage(({ local }) => {
    local.set(WANTED_PLANTS_STORAGE_KEY, 'не json')
    assert.deepEqual(readWantedPlants(), [])

    local.set(WANTED_PLANTS_STORAGE_KEY, JSON.stringify({
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      plants: GARDEN_PLANTS
    }))
    assert.deepEqual(readWantedPlants(), [])
    assert.equal(local.has(WANTED_PLANTS_STORAGE_KEY), false)
  })
})

test('clearWantedPlants: удаляет сохранённый список', () => {
  withStorage(({ local }) => {
    rememberWantedPlants(GARDEN_PLANTS)
    assert.equal(clearWantedPlants(), true)
    assert.equal(local.has(WANTED_PLANTS_STORAGE_KEY), false)
    assert.deepEqual(readWantedPlants(), [])
  })
})

const GUIDE_PLANTS = [
  { slug: 'monstera', name: 'Монстера', latin: 'Monstera deliciosa', species: 'Monstera deliciosa' },
  { slug: 'ficus-benjamina', name: 'Фикус Бенджамина', latin: 'Ficus benjamina', species: 'Ficus benjamina' }
]

test('matchWantedPlantWithGuide: совпадает по названию и виду', () => {
  const byName = matchWantedPlantWithGuide(
    { name: 'Монстера', species: '', intervalDays: 7 },
    GUIDE_PLANTS
  )
  assert.equal(byName.slug, 'monstera')

  const bySpecies = matchWantedPlantWithGuide(
    { name: 'Что-то красивое', species: 'Ficus benjamina' },
    GUIDE_PLANTS
  )
  assert.equal(bySpecies.slug, 'ficus-benjamina')

  const byPartialName = matchWantedPlantWithGuide(
    { name: 'Монстера', species: '' },
    [{ slug: 'monstera', name: 'Монстера деликатесная', latin: 'Monstera deliciosa' }]
  )
  assert.equal(byPartialName.slug, 'monstera')

  assert.equal(matchWantedPlantWithGuide({ name: 'Кактус' }, GUIDE_PLANTS), null)
  assert.equal(matchWantedPlantWithGuide(null, GUIDE_PLANTS), null)
  assert.equal(matchWantedPlantWithGuide({ name: 'Монстера' }, null), null)
})

test('matchWantedPlantsWithGuide: делит список на совпавшие и «из общего сада»', () => {
  const plan = matchWantedPlantsWithGuide(
    [
      { name: 'Монстера', species: 'Monstera deliciosa', intervalDays: 7 },
      { name: 'Кактус', species: 'Echinopsis', intervalDays: 14 },
      { name: 'Фикус', species: '' }
    ],
    GUIDE_PLANTS
  )

  assert.deepEqual(plan.matchedSlugs, ['monstera', 'ficus-benjamina'])
  assert.equal(plan.matched.length, 2)
  assert.equal(plan.matched[0].wanted.name, 'Монстера')
  assert.deepEqual(plan.unmatched.map(plant => plant.name), ['Кактус'])
  assert.equal(plan.unmatched[0].intervalDays, 14)

  assert.deepEqual(matchWantedPlantsWithGuide([], GUIDE_PLANTS), {
    matched: [],
    matchedSlugs: [],
    unmatched: []
  })
  assert.deepEqual(
    matchWantedPlantsWithGuide(GARDEN_PLANTS.slice(0, 3), []).unmatched.length,
    3
  )
})

test('removeWantedPlants: убирает только перенесённые растения и очищает пустой список', () => {
  withStorage(({ local }) => {
    rememberWantedPlants(GARDEN_PLANTS)
    const remaining = removeWantedPlants([
      { name: 'Монстера', species: 'Monstera deliciosa' }
    ])

    assert.deepEqual(remaining.map(plant => plant.name), ['Фикус Бенджамина', 'Орхидея'])
    assert.equal(readWantedPlants().length, 2)
    assert.equal(local.has(WANTED_PLANTS_STORAGE_KEY), true)

    const empty = removeWantedPlants([
      { name: 'Фикус Бенджамина', species: 'Ficus benjamina' },
      { name: 'Орхидея', species: 'Phalaenopsis' }
    ])
    assert.deepEqual(empty, [])
    assert.equal(local.has(WANTED_PLANTS_STORAGE_KEY), false)
    assert.deepEqual(removeWantedPlants([]), [])
  })
})

test('removeWantedPlants: без localStorage не падает', () => {
  const previousWindow = globalThis.window
  globalThis.window = undefined
  try {
    assert.deepEqual(removeWantedPlants([{ name: 'Монстера' }]), [])
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})

test('buildAddPlantDraft: готовит черновик для /add-plant', () => {
  const draft = buildAddPlantDraft(GARDEN_PLANTS[0])

  assert.equal(draft.name, 'Монстера')
  assert.equal(draft.species, 'Monstera deliciosa')
  assert.equal(draft.days, 7)
  assert.ok(Number.isFinite(draft.savedAt))
  assert.equal(buildAddPlantDraft({ name: '' }), null)
})

test('rememberAddPlantDraft/readAddPlantDraft: передают вид в форму добавления', () => {
  withStorage(({ session }) => {
    assert.equal(rememberAddPlantDraft(GARDEN_PLANTS[2]), true)
    assert.equal(session.has(ADD_PLANT_DRAFT_STORAGE_KEY), true)

    const draft = readAddPlantDraft()
    assert.equal(draft.name, 'Орхидея')
    assert.equal(draft.species, 'Phalaenopsis')
    assert.equal(draft.days, 10)

    assert.equal(clearAddPlantDraft(), true)
    assert.equal(readAddPlantDraft(), null)
  })
})

test('readAddPlantDraft: просроченный черновик удаляется', () => {
  withStorage(({ session }) => {
    session.set(ADD_PLANT_DRAFT_STORAGE_KEY, JSON.stringify({
      name: 'Орхидея',
      species: 'Phalaenopsis',
      days: 10,
      savedAt: Date.now() - 13 * 60 * 60 * 1000
    }))

    assert.equal(readAddPlantDraft(), null)
    assert.equal(session.has(ADD_PLANT_DRAFT_STORAGE_KEY), false)
  })
})

test('без localStorage/sessionStorage функции не падают', () => {
  const previousWindow = globalThis.window
  globalThis.window = undefined
  try {
    assert.deepEqual(rememberWantedPlants(GARDEN_PLANTS).length, WANTED_PLANTS_LIMIT)
    assert.deepEqual(readWantedPlants(), [])
    assert.equal(clearWantedPlants(), false)
    assert.equal(rememberAddPlantDraft(GARDEN_PLANTS[0]), false)
    assert.equal(readAddPlantDraft(), null)
    assert.equal(clearAddPlantDraft(), false)
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})
