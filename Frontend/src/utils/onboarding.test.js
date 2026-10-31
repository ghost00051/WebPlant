import test from 'node:test'
import assert from 'node:assert/strict'
import { PLANTS } from '../data/plants.js'
import {
  DEFAULT_ONBOARDING_INTERVAL_DAYS,
  FIRST_PLANT_PENDING_STORAGE_KEY,
  FIRST_PLANT_PENDING_TTL_MS,
  MAX_WATERING_INTERVAL_DAYS,
  POPULAR_PLANTS_COUNT,
  PUSH_PROMPT_AFTER_FIRST_WATERING_GRACE_MS,
  PUSH_PROMPT_AFTER_PLANT_MS,
  buildFirstPlantPending,
  buildQuickPlantPayload,
  clearFirstPlantPending,
  deriveOnboardingChecklist,
  derivePushPromptDelay,
  describeCreatePlantError,
  normalizePopularPlant,
  parseFirstPlantPending,
  parseIntervalDays,
  pickPopularPlants,
  readFirstPlantPending,
  saveFirstPlantPending
} from './onboarding.js'

test('parseIntervalDays: диапазон из data/plants.js берёт первое число', () => {
  assert.equal(parseIntervalDays('7–10'), 7)
  assert.equal(parseIntervalDays('14–21'), 14)
  assert.equal(parseIntervalDays('каждые 5 дней'), 5)
  assert.equal(parseIntervalDays(9), 9)
})

test('parseIntervalDays: значения зажимаются в допустимые бэкендом 1..365', () => {
  assert.equal(parseIntervalDays(0), 1)
  assert.equal(parseIntervalDays(-5), 1)
  assert.equal(parseIntervalDays(400), MAX_WATERING_INTERVAL_DAYS)
  assert.equal(parseIntervalDays('400'), MAX_WATERING_INTERVAL_DAYS)
})

test('parseIntervalDays: мусор и пустые значения дают фолбэк', () => {
  assert.equal(parseIntervalDays(undefined), DEFAULT_ONBOARDING_INTERVAL_DAYS)
  assert.equal(parseIntervalDays(null), DEFAULT_ONBOARDING_INTERVAL_DAYS)
  assert.equal(parseIntervalDays(''), DEFAULT_ONBOARDING_INTERVAL_DAYS)
  assert.equal(parseIntervalDays('нет данных'), DEFAULT_ONBOARDING_INTERVAL_DAYS)
  assert.equal(parseIntervalDays('', 10), 10)
})

test('normalizePopularPlant: отбрасывает записи без slug или name', () => {
  assert.equal(normalizePopularPlant(null), null)
  assert.equal(normalizePopularPlant({ name: 'Без слага' }), null)
  assert.equal(normalizePopularPlant({ slug: 'bez-imeni' }), null)

  const plant = normalizePopularPlant({
    slug: ' monstera ',
    name: ' Монстера ',
    latin: 'Monstera deliciosa',
    intervalDays: '7–10',
    intervalLabel: 'раз в 7–10 дней',
    image: '/plants/monstera.svg',
    imageAlt: ''
  })
  assert.equal(plant.slug, 'monstera')
  assert.equal(plant.name, 'Монстера')
  assert.equal(plant.intervalDays, 7)
  assert.equal(plant.image, '/plants/monstera.svg')
  assert.equal(plant.imageAlt, 'Монстера')
})

test('pickPopularPlants: из data/plants.js получается 6 карточек с валидным интервалом', () => {
  const popular = pickPopularPlants(PLANTS)
  assert.equal(popular.length, POPULAR_PLANTS_COUNT)
  assert.equal(popular[0].slug, 'monstera')
  assert.equal(new Set(popular.map(plant => plant.slug)).size, popular.length)

  for (const plant of popular) {
    assert.equal(typeof plant.name, 'string')
    assert.ok(plant.name.length > 0)
    assert.ok(Number.isInteger(plant.intervalDays))
    assert.ok(plant.intervalDays >= 1 && plant.intervalDays <= 365)
    assert.match(plant.image, /^\/plants\/.+\.svg$/)
  }
})

test('pickPopularPlants: slugs задаёт порядок, count ограничивает, дубли пропускаются', () => {
  const popular = pickPopularPlants(PLANTS, {
    count: 3,
    slugs: ['zamioculcas', 'monstera', 'zamioculcas', 'unknown', 'ficus-benjamina']
  })
  assert.deepEqual(popular.map(plant => plant.slug), [
    'zamioculcas',
    'monstera',
    'ficus-benjamina'
  ])

  const short = pickPopularPlants(PLANTS, { count: 2 })
  assert.equal(short.length, 2)

  assert.deepEqual(pickPopularPlants(null), [])
  assert.deepEqual(pickPopularPlants([{ name: 'Без слага' }]), [])
})

test('buildQuickPlantPayload: тело POST /plants проходит требования бэкенда', () => {
  const payload = buildQuickPlantPayload({
    name: 'Монстера',
    latin: 'Monstera deliciosa',
    intervalDays: 8
  })
  assert.deepEqual(payload, {
    name: 'Монстера',
    species: 'Monstera deliciosa',
    watering_interval_days: 8,
    watering_time_of_day: 'morning'
  })

  assert.equal(buildQuickPlantPayload(null), null)
  assert.equal(buildQuickPlantPayload({ name: '   ' }), null)

  const withoutLatin = buildQuickPlantPayload({ name: 'Фикус', intervalDays: '5–7' })
  assert.equal(withoutLatin.species, '')
  assert.equal(withoutLatin.watering_interval_days, 5)

  assert.equal(
    buildQuickPlantPayload({ name: 'Фикус' }, { timeOfDay: 'evening' }).watering_time_of_day,
    'evening'
  )
  assert.equal(
    buildQuickPlantPayload({ name: 'Фикус' }, { timeOfDay: 'ночью' }).watering_time_of_day,
    'morning'
  )
})

test('describeCreatePlantError: сообщение сервера в приоритете, затем статусы', () => {
  assert.equal(
    describeCreatePlantError({ status: 400, data: { message: 'Название обязательно' } }),
    'Название обязательно'
  )
  assert.match(describeCreatePlantError({ status: 400, data: { message: '  ' } }), /не принял данные/)
  assert.match(describeCreatePlantError({ status: 401 }), /Войдите снова/)
  assert.match(describeCreatePlantError({ status: 409 }), /уже добавлено/)
  assert.match(describeCreatePlantError({ status: 429 }), /Слишком много попыток/)
  assert.match(describeCreatePlantError({ status: 500 }), /Сервер не смог/)
  assert.match(
    describeCreatePlantError({ status: 0, fallback: 'Свой текст' }),
    /^Свой текст$/
  )
})

test('deriveOnboardingChecklist: после создания растения текущий шаг — напоминания', () => {
  const checklist = deriveOnboardingChecklist({ plantName: 'Монстера' })
  assert.equal(checklist.totalCount, 3)
  assert.equal(checklist.completedCount, 1)
  assert.equal(checklist.isComplete, false)
  assert.equal(checklist.steps[0].id, 'plant')
  assert.equal(checklist.steps[0].status, 'done')
  assert.equal(checklist.steps[0].description, 'Монстера')
  assert.equal(checklist.steps[1].status, 'current')
  assert.deepEqual(checklist.currentStep.action, {
    type: 'enable-reminders',
    label: 'Включить напоминания'
  })
  assert.equal(checklist.steps[2].status, 'current')
  assert.equal(checklist.nextAction.type, 'enable-reminders')
})

test('deriveOnboardingChecklist: кнопка «Уже полил(а)» закрывает шаг первого полива', () => {
  const checklist = deriveOnboardingChecklist({
    plantName: 'Монстера',
    reminderState: 'granted',
    hasWatered: true
  })
  assert.equal(checklist.completedCount, 3)
  assert.equal(checklist.isComplete, true)
  assert.equal(checklist.currentStep, null)
  assert.equal(checklist.nextAction, null)
  assert.equal(checklist.steps[2].status, 'done')
})

test('deriveOnboardingChecklist: запрещённые уведомления не блокируют чек-лист', () => {
  const denied = deriveOnboardingChecklist({ plantName: 'Фикус', reminderState: 'denied' })
  assert.equal(denied.steps[1].status, 'unavailable')
  assert.equal(denied.steps[1].action, null)
  assert.match(denied.steps[1].description, /настройках браузера/)
  assert.equal(denied.steps[2].status, 'current')

  const unsupported = deriveOnboardingChecklist({
    plantName: 'Фикус',
    reminderState: 'unsupported'
  })
  assert.equal(unsupported.steps[1].status, 'unavailable')
  assert.match(unsupported.steps[1].description, /не поддерживает/)
})

test('deriveOnboardingChecklist: пустой чек-лист начинается с выбора растения', () => {
  const checklist = deriveOnboardingChecklist()
  assert.equal(checklist.completedCount, 0)
  assert.equal(checklist.steps[0].status, 'current')
  assert.equal(checklist.steps[0].action.type, 'pick-plant')
  assert.equal(checklist.steps[2].status, 'pending')
})

test('derivePushPromptDelay: без растений промпт не показывается', () => {
  assert.equal(derivePushPromptDelay(), null)
  assert.equal(derivePushPromptDelay({ plantCount: 0 }), null)
  assert.equal(derivePushPromptDelay({ plantCount: -1 }), null)
  assert.equal(derivePushPromptDelay({ plantCount: 'много' }), null)
})

test('derivePushPromptDelay: после растения с историей полива — базовая задержка', () => {
  assert.equal(
    derivePushPromptDelay({ plantCount: 1, hasWateringHistory: true }),
    PUSH_PROMPT_AFTER_PLANT_MS
  )
})

test('derivePushPromptDelay: без первого полива промпт ждёт первого полива', () => {
  assert.equal(
    derivePushPromptDelay({ plantCount: 1, hasWateringHistory: false }),
    PUSH_PROMPT_AFTER_FIRST_WATERING_GRACE_MS
  )
  assert.equal(
    derivePushPromptDelay({
      plantCount: 1,
      hasWateringHistory: false,
      afterFirstWateringGraceMs: 5000
    }),
    5000
  )
})

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  }
}

test('buildFirstPlantPending: валидирует id и нормализует имя/интервал', () => {
  const record = buildFirstPlantPending(
    { id: 42, name: '  Монстера  ', intervalDays: '7–10' },
    { now: 1000 }
  )
  assert.deepEqual(record, {
    id: 42,
    name: 'Монстера',
    intervalDays: 7,
    savedAt: 1000
  })

  assert.equal(buildFirstPlantPending({ id: 0, name: 'Фикус' }), null)
  assert.equal(buildFirstPlantPending({ id: -3, name: 'Фикус' }), null)
  assert.equal(buildFirstPlantPending({ id: 'abc', name: 'Фикус' }), null)
  assert.equal(buildFirstPlantPending({ id: 1, name: 'Фикус' }, { now: 0 }), null)
})

test('parseFirstPlantPending: битая и просроченная запись не принимаются', () => {
  assert.equal(parseFirstPlantPending(''), null)
  assert.equal(parseFirstPlantPending('{не json'), null)
  assert.equal(parseFirstPlantPending('null'), null)
  assert.equal(parseFirstPlantPending('[1,2]'), null)
  assert.equal(parseFirstPlantPending(JSON.stringify({ id: 0 })), null)

  const fresh = parseFirstPlantPending(
    JSON.stringify({ id: 5, name: ' Фикус ', intervalDays: 3, savedAt: 1000 }),
    { now: 2000 }
  )
  assert.deepEqual(fresh, {
    id: 5,
    name: 'Фикус',
    intervalDays: 3,
    savedAt: 1000
  })

  const expired = parseFirstPlantPending(
    JSON.stringify({ id: 5, name: 'Фикус', savedAt: 1000 }),
    { now: 1000 + FIRST_PLANT_PENDING_TTL_MS + 1 }
  )
  assert.equal(expired, null)
})

test('save/readFirstPlantPending: roundtrip через хранилище и очистка по TTL', () => {
  const storage = createMemoryStorage()

  assert.equal(
    saveFirstPlantPending({ id: 7, name: 'Сансевиерия', intervalDays: 14 }, { storage, now: 1000 }),
    true
  )
  assert.ok(storage.getItem(FIRST_PLANT_PENDING_STORAGE_KEY))

  const read = readFirstPlantPending({ storage, now: 2000 })
  assert.equal(read.id, 7)
  assert.equal(read.name, 'Сансевиерия')
  assert.equal(read.intervalDays, 14)

  const expiredRead = readFirstPlantPending({
    storage,
    now: 1000 + FIRST_PLANT_PENDING_TTL_MS + 1
  })
  assert.equal(expiredRead, null)
  assert.equal(storage.getItem(FIRST_PLANT_PENDING_STORAGE_KEY), null)

  storage.setItem(FIRST_PLANT_PENDING_STORAGE_KEY, '{oops')
  assert.equal(readFirstPlantPending({ storage }), null)
  assert.equal(storage.getItem(FIRST_PLANT_PENDING_STORAGE_KEY), null)
})

test('clearFirstPlantPending: удаляет запись; без хранилища — безопасный no-op', () => {
  const storage = createMemoryStorage()
  saveFirstPlantPending({ id: 3, name: 'Фикус' }, { storage })

  assert.equal(clearFirstPlantPending({ storage }), true)
  assert.equal(storage.getItem(FIRST_PLANT_PENDING_STORAGE_KEY), null)

  assert.equal(clearFirstPlantPending({ storage: null }), false)
  assert.equal(saveFirstPlantPending({ id: 4, name: 'Фикус' }, { storage: null }), false)
  assert.equal(readFirstPlantPending({ storage: null }), null)
})
