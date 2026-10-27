import { API_URL } from './api.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

export const DELIVERY_MODE_DIGEST = 'digest'
export const DELIVERY_MODE_PER_PLANT = 'per_plant'

export const DELIVERY_MODES = [DELIVERY_MODE_DIGEST, DELIVERY_MODE_PER_PLANT]

export const DEFAULT_QUIET_HOURS = Object.freeze({
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: ''
})

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  deliveryMode: DELIVERY_MODE_DIGEST,
  quietHours: DEFAULT_QUIET_HOURS
})

export const DELIVERY_MODE_STORAGE_KEY = 'lejka_notification_delivery_mode'
export const QUIET_HOURS_STORAGE_KEY = 'lejka_notification_quiet_hours'

const PREFERENCES_PATH = '/users/me/notification-preferences'
const PREFERENCES_TIMEOUT_MS = 12000
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const UNAVAILABLE_STATUSES = new Set([404, 405, 501, 502, 503, 504])

export const LOCAL_ONLY_NOTICE =
  'Только на этом устройстве: на доставку уведомлений это не влияет, пока сервер не подтвердит настройку.'

function storage () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function isTimeValue (value) {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

export function normalizeDeliveryMode (value) {
  return DELIVERY_MODES.includes(value) ? value : ''
}

function pickDeliveryMode (payload) {
  if (!payload || typeof payload !== 'object') return ''
  const direct = normalizeDeliveryMode(payload.delivery_mode) ||
    normalizeDeliveryMode(payload.deliveryMode)
  if (direct) return direct
  if (payload.digest_mode === 'per_plant') return DELIVERY_MODE_PER_PLANT
  if (payload.digest_mode === 'digest') return DELIVERY_MODE_DIGEST
  if (typeof payload.digest_enabled === 'boolean') {
    return payload.digest_enabled ? DELIVERY_MODE_DIGEST : DELIVERY_MODE_PER_PLANT
  }
  if (typeof payload.notification_mode === 'string') {
    return normalizeDeliveryMode(payload.notification_mode)
  }
  return ''
}

function pickTime (payload, keys, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  for (const key of keys) {
    if (isTimeValue(payload[key])) return payload[key]
  }
  return fallback
}

function pickBoolean (payload, keys, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  for (const key of keys) {
    if (typeof payload[key] === 'boolean') return payload[key]
  }
  return fallback
}

export function normalizeNotificationPreferences (payload, fallback = DEFAULT_NOTIFICATION_PREFERENCES) {
  const base = fallback || DEFAULT_NOTIFICATION_PREFERENCES
  const deliveryMode = pickDeliveryMode(payload) || normalizeDeliveryMode(base.deliveryMode) || DELIVERY_MODE_DIGEST
  const enabled = pickBoolean(
    payload,
    ['quiet_hours_enabled', 'quietHoursEnabled'],
    Boolean(base.quietHours?.enabled)
  )
  const start = pickTime(
    payload,
    ['quiet_hours_start', 'quietHoursStart'],
    base.quietHours?.start || DEFAULT_QUIET_HOURS.start
  )
  const end = pickTime(
    payload,
    ['quiet_hours_end', 'quietHoursEnd'],
    base.quietHours?.end || DEFAULT_QUIET_HOURS.end
  )
  const timezone = typeof payload?.quiet_hours_timezone === 'string'
    ? payload.quiet_hours_timezone
    : (base.quietHours?.timezone || '')

  const hasDeliveryField = Boolean(
    payload && typeof payload === 'object' &&
    (payload.delivery_mode !== undefined ||
      payload.deliveryMode !== undefined ||
      payload.digest_enabled !== undefined ||
      payload.digest_mode !== undefined ||
      payload.notification_mode !== undefined)
  )
  const hasQuietField = Boolean(
    payload && typeof payload === 'object' &&
    (payload.quiet_hours_enabled !== undefined || payload.quietHoursEnabled !== undefined)
  )

  return {
    deliveryMode,
    quietHours: { enabled, start, end, timezone },
    serverSupports: {
      deliveryMode: hasDeliveryField,
      quietHours: hasQuietField
    }
  }
}

export function validateQuietHours ({ enabled, start, end }) {
  if (!enabled) return ''
  if (!isTimeValue(start) || !isTimeValue(end)) {
    return 'Укажите время начала и конца в формате ЧЧ:ММ.'
  }
  if (start === end) {
    return 'Начало и конец тихих часов не должны совпадать.'
  }
  return ''
}

export function readLocalNotificationPreferences () {
  const store = storage()
  if (!store) return DEFAULT_NOTIFICATION_PREFERENCES
  let deliveryMode
  const quietHours = { ...DEFAULT_QUIET_HOURS }

  try {
    deliveryMode = normalizeDeliveryMode(store.getItem(DELIVERY_MODE_STORAGE_KEY)) ||
      DELIVERY_MODE_DIGEST
  } catch {
    deliveryMode = DELIVERY_MODE_DIGEST
  }

  try {
    const raw = store.getItem(QUIET_HOURS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        quietHours.enabled = parsed.enabled === true
        quietHours.start = isTimeValue(parsed.start) ? parsed.start : quietHours.start
        quietHours.end = isTimeValue(parsed.end) ? parsed.end : quietHours.end
        quietHours.timezone = typeof parsed.timezone === 'string' ? parsed.timezone : ''
      }
    }
  } catch {
    return { deliveryMode, quietHours }
  }

  return { deliveryMode, quietHours }
}

export function writeLocalNotificationPreferences (preferences) {
  const store = storage()
  if (!store) return false
  const deliveryMode = normalizeDeliveryMode(preferences?.deliveryMode) || DELIVERY_MODE_DIGEST
  const quietHours = preferences?.quietHours || DEFAULT_QUIET_HOURS
  try {
    store.setItem(DELIVERY_MODE_STORAGE_KEY, deliveryMode)
    store.setItem(QUIET_HOURS_STORAGE_KEY, JSON.stringify({
      enabled: quietHours.enabled === true,
      start: isTimeValue(quietHours.start) ? quietHours.start : DEFAULT_QUIET_HOURS.start,
      end: isTimeValue(quietHours.end) ? quietHours.end : DEFAULT_QUIET_HOURS.end,
      timezone: typeof quietHours.timezone === 'string' ? quietHours.timezone : ''
    }))
    return true
  } catch {
    return false
  }
}

async function requestPreferences (options, init) {
  const response = await fetchWithTimeout(
    `${API_URL}${PREFERENCES_PATH}`,
    { credentials: 'include', ...init },
    PREFERENCES_TIMEOUT_MS
  )
  const data = await response.json().catch(() => null)
  return { response, data }
}

function serverErrorMessage (data, status) {
  if (data && typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim()
  }
  return `Сервер не принял настройку уведомлений: HTTP ${status}`
}

export async function loadNotificationPreferences (fallback = readLocalNotificationPreferences()) {
  try {
    const { response, data } = await requestPreferences({}, { method: 'GET' })
    if (!response.ok) {
      const unavailable = UNAVAILABLE_STATUSES.has(response.status)
      return {
        ok: false,
        unavailable,
        localOnly: unavailable,
        status: response.status,
        error: new Error(serverErrorMessage(data, response.status)),
        preferences: normalizeNotificationPreferences(null, fallback)
      }
    }
    const preferences = normalizeNotificationPreferences(data, fallback)
    writeLocalNotificationPreferences(preferences)
    return { ok: true, unavailable: false, localOnly: false, status: response.status, preferences }
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      localOnly: true,
      error,
      preferences: normalizeNotificationPreferences(null, fallback)
    }
  }
}

export async function saveNotificationPreferences (patch, fallback = readLocalNotificationPreferences()) {
  const body = {}
  if (Object.hasOwn(patch || {}, 'deliveryMode')) {
    body.delivery_mode = normalizeDeliveryMode(patch.deliveryMode) || DELIVERY_MODE_DIGEST
  }
  if (Object.hasOwn(patch || {}, 'quietHours')) {
    const quietHours = patch.quietHours || {}
    body.quiet_hours_enabled = quietHours.enabled === true
    body.quiet_hours_start = isTimeValue(quietHours.start) ? quietHours.start : DEFAULT_QUIET_HOURS.start
    body.quiet_hours_end = isTimeValue(quietHours.end) ? quietHours.end : DEFAULT_QUIET_HOURS.end
  }

  const local = [
    Object.hasOwn(body, 'delivery_mode') ? body.delivery_mode : null,
    Object.hasOwn(body, 'quiet_hours_enabled') ? body.quiet_hours_enabled : null,
    Object.hasOwn(body, 'quiet_hours_start') ? body.quiet_hours_start : null,
    Object.hasOwn(body, 'quiet_hours_end') ? body.quiet_hours_end : null
  ]
  const localPreferences = {
    deliveryMode: local[0] || fallback.deliveryMode,
    quietHours: {
      enabled: local[1] === null ? fallback.quietHours.enabled : local[1],
      start: local[2] || fallback.quietHours.start,
      end: local[3] || fallback.quietHours.end,
      timezone: fallback.quietHours.timezone
    }
  }

  try {
    const { response, data } = await requestPreferences({}, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      if (UNAVAILABLE_STATUSES.has(response.status)) {
        writeLocalNotificationPreferences(localPreferences)
        return {
          ok: false,
          localOnly: true,
          unavailable: true,
          status: response.status,
          error: new Error(serverErrorMessage(data, response.status)),
          preferences: localPreferences
        }
      }

      return {
        ok: false,
        localOnly: false,
        unavailable: false,
        status: response.status,
        error: new Error(serverErrorMessage(data, response.status)),
        preferences: fallback
      }
    }

    const normalized = normalizeNotificationPreferences(data, localPreferences)
    const deliveryEchoed = Object.hasOwn(body, 'delivery_mode')
      ? normalized.serverSupports.deliveryMode
      : true
    const quietEchoed = Object.hasOwn(body, 'quiet_hours_enabled')
      ? normalized.serverSupports.quietHours
      : true

    if (!deliveryEchoed || !quietEchoed) {
      writeLocalNotificationPreferences(localPreferences)
      return {
        ok: false,
        localOnly: true,
        unavailable: false,
        ignored: true,
        status: response.status,
        error: new Error('Сервер не применил настройку — возможно, он ещё не обновлён.'),
        preferences: localPreferences
      }
    }

    writeLocalNotificationPreferences(normalized)
    return {
      ok: true,
      localOnly: false,
      unavailable: false,
      status: response.status,
      preferences: normalized
    }
  } catch (error) {
    writeLocalNotificationPreferences(localPreferences)
    return {
      ok: false,
      localOnly: true,
      unavailable: true,
      error,
      preferences: localPreferences
    }
  }
}
