import {
  CARE_ACTION_CODES,
  CARE_METHOD_LABELS,
  careTitleFor
} from './careEvents.js'

export const PRODUCT_SUGGESTIONS = Object.freeze([
  'Покон',
  'Фаско',
  'Агрикола',
  'Bona Forte'
])

export const OTHER_CARE_ACTIONS = Object.freeze([
  { code: 'leaf_clean', label: careTitleFor('leaf_clean') },
  { code: 'rotate', label: careTitleFor('rotate') },
  { code: 'pest_check', label: careTitleFor('pest_check') },
  { code: 'humidity_support', label: careTitleFor('humidity_support') }
])

export const careActionTabs = Object.freeze([
  { id: 'fertilize', label: careTitleFor('fertilize') },
  { id: 'spray', label: careTitleFor('spray') },
  { id: 'other', label: 'Другой уход' }
])

const PRODUCT_MAX_LENGTH = 160
const DOSE_MAX_LENGTH = 120
const NOTE_MAX_LENGTH = 500
const RECENT_PRODUCTS_LIMIT = 10

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toPositiveInt(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!/^[1-9]\d*$/.test(normalized)) return null
    const parsed = Number(normalized)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  return null
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function careDateValue(date) {
  const parsed = parseDate(date) ?? new Date()
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

export function buildPerformedAt(dateValue, now = new Date()) {
  if (dateValue instanceof Date) {
    return Number.isFinite(dateValue.getTime()) ? dateValue.toISOString() : null
  }
  if (typeof dateValue !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  const current = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const isToday =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  if (isToday) return current.toISOString()

  return date.toISOString()
}

export function formatCareDate(value) {
  let parsed
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const iso = buildPerformedAt(value)
    parsed = iso ? new Date(iso) : null
  } else {
    parsed = parseDate(value)
  }
  if (!parsed) return ''
  return `${parsed.getDate()} ${MONTHS_GENITIVE[parsed.getMonth()]}`
}

export function formatCareSummary(item) {
  if (!item || typeof item !== 'object') return ''
  const title = careTitleFor(trimmedText(item.action_code) || trimmedText(item.actionCode))
  const product = trimmedText(item.product_name ?? item.productName)
  const date = formatCareDate(item.performed_at ?? item.performedAt)
  return [title, product, date].filter(Boolean).join(' · ')
}

export function recentProductsFromLatest(items) {
  const products = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const product = trimmedText(item?.product_name ?? item?.productName)
    if (!product) continue
    const key = product.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    products.push(product)
    if (products.length >= RECENT_PRODUCTS_LIMIT) break
  }
  return products
}

function resolvePerformedAt(value, now = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const iso = buildPerformedAt(value, now)
    return iso ? new Date(iso) : null
  }
  return parseDate(value)
}

export function buildCareActionPayload(input = {}, options = {}) {
  const plantId = toPositiveInt(input.plantId)
  if (!plantId) {
    return { ok: false, error: 'Выберите растение.' }
  }

  const actionCode = trimmedText(input.actionCode)
  if (!CARE_ACTION_CODES.includes(actionCode)) {
    return { ok: false, error: 'Выберите тип ухода.' }
  }

  const rawProduct = trimmedText(input.product)
  if (actionCode === 'fertilize' && !rawProduct) {
    return { ok: false, error: 'Укажите, чем подкармливали.' }
  }
  if (rawProduct.length > PRODUCT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Название средства должно быть короче ${PRODUCT_MAX_LENGTH} символов.`
    }
  }

  const dose = trimmedText(input.dose)
  if (dose.length > DOSE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Дозировка должна быть короче ${DOSE_MAX_LENGTH} символов.`
    }
  }

  const note = trimmedText(input.note)
  if (note.length > NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Заметка должна быть короче ${NOTE_MAX_LENGTH} символов.`
    }
  }

  const method = trimmedText(input.method)
  if (method && !Object.hasOwn(CARE_METHOD_LABELS, method)) {
    return { ok: false, error: 'Неизвестный способ опрыскивания.' }
  }

  const performedAtSource = input.performedAt ?? input.performed_at
  const fallbackNow = parseDate(options.now) ?? new Date()
  const performedAt = performedAtSource
    ? resolvePerformedAt(performedAtSource, fallbackNow)
    : fallbackNow
  if (!performedAt) {
    return { ok: false, error: 'Укажите корректную дату ухода.' }
  }

  let notificationId = null
  const rawNotificationId = input.notificationId ?? input.notification_id
  if (rawNotificationId !== null && rawNotificationId !== undefined && rawNotificationId !== '') {
    notificationId = toPositiveInt(rawNotificationId)
    if (!notificationId) {
      return { ok: false, error: 'Некорректная ссылка на уведомление.' }
    }
  }

  const isSpray = actionCode === 'spray'
  const keepsProduct = actionCode === 'fertilize' || actionCode === 'spray'

  const value = {
    action_code: actionCode,
    plant_id: plantId,
    product_name: keepsProduct ? rawProduct || null : null,
    dose: dose || null,
    method: isSpray ? method || null : null,
    note: note || null,
    performed_at: performedAt.toISOString(),
    notification_id: notificationId
  }

  return { ok: true, value }
}
