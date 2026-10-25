export const DEFAULT_ONBOARDING_INTERVAL_DAYS = 7
export const MIN_WATERING_INTERVAL_DAYS = 1
export const MAX_WATERING_INTERVAL_DAYS = 365
export const POPULAR_PLANTS_COUNT = 6
export const DEFAULT_WATERING_TIME_OF_DAY = 'morning'
export const WATERING_TIME_OF_DAY_OPTIONS = Object.freeze(['morning', 'day', 'evening'])

export const PUSH_PROMPT_AFTER_PLANT_MS = 2000
export const PUSH_PROMPT_AFTER_FIRST_WATERING_GRACE_MS = 30000

export const ONBOARDING_STEP_STATUSES = Object.freeze({
  done: 'done',
  current: 'current',
  pending: 'pending',
  unavailable: 'unavailable'
})

export const ONBOARDING_REMINDER_STATES = Object.freeze({
  granted: 'granted',
  denied: 'denied',
  unsupported: 'unsupported',
  default: 'default'
})

const CHECKLIST_STEP_IDS = Object.freeze({
  plant: 'plant',
  reminder: 'reminder',
  watering: 'watering'
})

function clampIntervalDays(value) {
  if (!Number.isInteger(value)) return DEFAULT_ONBOARDING_INTERVAL_DAYS
  if (value < MIN_WATERING_INTERVAL_DAYS) return MIN_WATERING_INTERVAL_DAYS
  if (value > MAX_WATERING_INTERVAL_DAYS) return MAX_WATERING_INTERVAL_DAYS
  return value
}

export function parseIntervalDays(value, fallback = DEFAULT_ONBOARDING_INTERVAL_DAYS) {
  let candidate = NaN

  if (typeof value === 'number') {
    candidate = value
  } else if (typeof value === 'string') {
    const match = value.match(/\d+/)
    if (match) candidate = Number(match[0])
  }

  if (!Number.isFinite(candidate)) return clampIntervalDays(fallback)
  return clampIntervalDays(Math.round(candidate))
}

function cleanText(value, maxLength = 255) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function normalizePopularPlant(entry) {
  if (!entry || typeof entry !== 'object') return null

  const slug = cleanText(entry.slug, 80)
  const name = cleanText(entry.name)
  if (!slug || !name) return null

  return {
    slug,
    name,
    latin: cleanText(entry.latin),
    intervalDays: parseIntervalDays(entry.intervalDays),
    intervalLabel: cleanText(entry.intervalLabel),
    image: cleanText(entry.image, 300),
    imageAlt: cleanText(entry.imageAlt) || name
  }
}

export function pickPopularPlants(plants, { count = POPULAR_PLANTS_COUNT, slugs = null } = {}) {
  const limit = Number.isInteger(count) && count > 0 ? count : POPULAR_PLANTS_COUNT
  const source = Array.isArray(plants) ? plants : []
  const normalized = []
  const seen = new Set()

  const push = entry => {
    const plant = normalizePopularPlant(entry)
    if (!plant || seen.has(plant.slug)) return
    seen.add(plant.slug)
    normalized.push(plant)
  }

  if (Array.isArray(slugs) && slugs.length) {
    const bySlug = new Map()
    for (const entry of source) {
      const plant = normalizePopularPlant(entry)
      if (plant) bySlug.set(plant.slug, plant)
    }
    for (const slug of slugs) {
      if (seen.size >= limit) break
      const plant = bySlug.get(String(slug))
      if (plant && !seen.has(plant.slug)) {
        seen.add(plant.slug)
        normalized.push(plant)
      }
    }
  }

  for (const entry of source) {
    if (normalized.length >= limit) break
    push(entry)
  }

  return normalized.slice(0, limit)
}

export function buildQuickPlantPayload(popularPlant, { timeOfDay = DEFAULT_WATERING_TIME_OF_DAY } = {}) {
  if (!popularPlant || typeof popularPlant !== 'object') return null

  const name = cleanText(popularPlant.name)
  if (!name) return null

  const wateringTime = WATERING_TIME_OF_DAY_OPTIONS.includes(timeOfDay)
    ? timeOfDay
    : DEFAULT_WATERING_TIME_OF_DAY

  return {
    name,
    species: cleanText(popularPlant.latin),
    watering_interval_days: parseIntervalDays(popularPlant.intervalDays),
    watering_time_of_day: wateringTime
  }
}

export function describeCreatePlantError({ status = 0, data = null, fallback = '' } = {}) {
  const serverMessage = typeof data?.message === 'string' ? data.message.trim() : ''
  if (serverMessage) return serverMessage

  const code = Number(status) || 0
  if (code === 401 || code === 403) {
    return 'Сессия истекла. Войдите снова, чтобы добавить растение.'
  }
  if (code === 409) {
    return 'Такое растение уже добавлено. Обновите страницу и попробуйте ещё раз.'
  }
  if (code === 429) {
    return 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  }
  if (code === 400 || code === 422) {
    return 'Сервер не принял данные растения. Попробуйте другое растение.'
  }
  if (code >= 500) {
    return 'Сервер не смог сохранить растение. Попробуйте ещё раз через минуту.'
  }

  return fallback || 'Не удалось добавить растение. Проверьте подключение и попробуйте ещё раз.'
}

function reminderStep({ reminderState }) {
  const state = ONBOARDING_REMINDER_STATES

  if (reminderState === state.granted) {
    return {
      id: CHECKLIST_STEP_IDS.reminder,
      title: 'Напоминания о поливе',
      status: ONBOARDING_STEP_STATUSES.done,
      description: 'Уведомления включены — напомним, когда пора полить.',
      action: null
    }
  }

  if (reminderState === state.denied || reminderState === state.unsupported) {
    const description = reminderState === state.denied
      ? 'Уведомления отключены в настройках браузера. Их можно включить для этого сайта позже.'
      : 'Браузер не поддерживает push-уведомления — полив останется в «Сегодня».'

    return {
      id: CHECKLIST_STEP_IDS.reminder,
      title: 'Напоминания о поливе',
      status: ONBOARDING_STEP_STATUSES.unavailable,
      description,
      action: null
    }
  }

  return {
    id: CHECKLIST_STEP_IDS.reminder,
    title: 'Напоминания о поливе',
    status: ONBOARDING_STEP_STATUSES.current,
    description: 'Включите уведомления — напомним, когда пора полить.',
    action: { type: 'enable-reminders', label: 'Включить напоминания' }
  }
}

export function deriveOnboardingChecklist({
  plantName = '',
  reminderState = ONBOARDING_REMINDER_STATES.default,
  hasWatered = false
} = {}) {
  const statuses = ONBOARDING_STEP_STATUSES
  const name = cleanText(plantName)

  const plantStep = {
    id: CHECKLIST_STEP_IDS.plant,
    title: 'Растение добавлено',
    status: name ? statuses.done : statuses.current,
    description: name
      ? name
      : 'Выберите растение из подборки — остальное настроится само.',
    action: name ? null : { type: 'pick-plant', label: 'Выбрать растение' }
  }

  const reminder = reminderStep({ reminderState })

  const wateringStep = {
    id: CHECKLIST_STEP_IDS.watering,
    title: 'Первый полив',
    status: hasWatered
      ? statuses.done
      : name
        ? statuses.current
        : statuses.pending,
    description: hasWatered
      ? 'Отлично! Дальше приложение само подскажет следующий полив.'
      : name
        ? 'Отметьте «Уже полил(а)» в блоке «Сегодня» — график пересчитается.'
        : 'Станет доступно после первого растения.',
    action: !hasWatered && name
      ? { type: 'mark-watering', label: 'Отметить первый полив' }
      : null
  }

  const steps = [plantStep, reminder, wateringStep]
  const completedCount = steps.filter(step => step.status === statuses.done).length
  const currentStep = steps.find(step => step.status === statuses.current) ?? null

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    currentStep,
    nextAction: currentStep?.action ?? null,
    isComplete: completedCount === steps.length
  }
}

export function derivePushPromptDelay({
  plantCount = 0,
  hasWateringHistory = false,
  afterPlantMs = PUSH_PROMPT_AFTER_PLANT_MS,
  afterFirstWateringGraceMs = PUSH_PROMPT_AFTER_FIRST_WATERING_GRACE_MS
} = {}) {
  const count = Number(plantCount)
  if (!Number.isFinite(count) || count < 1) return null

  return hasWateringHistory ? afterPlantMs : afterFirstWateringGraceMs
}

export const FIRST_PLANT_PENDING_STORAGE_KEY = 'webplant_first_plant_pending'

export const FIRST_PLANT_PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000

function resolveStorage(storage) {
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

export function buildFirstPlantPending(
  { id, name, intervalDays } = {},
  { now = Date.now() } = {}
) {
  const plantId = Number(id)
  const savedAt = Number(now)
  if (!Number.isInteger(plantId) || plantId <= 0) return null
  if (!Number.isFinite(savedAt) || savedAt <= 0) return null

  return {
    id: plantId,
    name: cleanText(name),
    intervalDays: parseIntervalDays(intervalDays),
    savedAt
  }
}

export function parseFirstPlantPending(
  raw,
  { now = Date.now(), ttlMs = FIRST_PLANT_PENDING_TTL_MS } = {}
) {
  if (typeof raw !== 'string' || !raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const plantId = Number(parsed.id)
  if (!Number.isInteger(plantId) || plantId <= 0) return null

  const savedAt = Number(parsed.savedAt) || 0
  const ttl = Number(ttlMs)
  if (!savedAt || !Number.isFinite(ttl) || ttl <= 0) return null
  if (Number(now) - savedAt > ttl) return null

  return {
    id: plantId,
    name: cleanText(parsed.name),
    intervalDays: parseIntervalDays(parsed.intervalDays),
    savedAt
  }
}

export function saveFirstPlantPending(pending, { storage, now = Date.now() } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  const record = buildFirstPlantPending(pending, { now })
  if (!record) return false

  try {
    target.setItem(FIRST_PLANT_PENDING_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch (error) {
    console.warn('Не удалось сохранить состояние первого растения:', error)
    return false
  }
}

export function readFirstPlantPending({
  storage,
  now = Date.now(),
  ttlMs = FIRST_PLANT_PENDING_TTL_MS
} = {}) {
  const target = resolveStorage(storage)
  if (!target) return null

  try {
    const raw = target.getItem(FIRST_PLANT_PENDING_STORAGE_KEY)
    if (!raw) return null

    const parsed = parseFirstPlantPending(raw, { now, ttlMs })
    if (!parsed) {
      target.removeItem(FIRST_PLANT_PENDING_STORAGE_KEY)
      return null
    }
    return parsed
  } catch (error) {
    console.warn('Не удалось прочитать состояние первого растения:', error)
    return null
  }
}

export function clearFirstPlantPending({ storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  try {
    target.removeItem(FIRST_PLANT_PENDING_STORAGE_KEY)
    return true
  } catch (error) {
    console.warn('Не удалось очистить состояние первого растения:', error)
    return false
  }
}
