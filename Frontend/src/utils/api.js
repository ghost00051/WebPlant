import { fetchWithTimeout } from './fetchWithTimeout.js'

const DEFAULT_API_URL = 'https://server.checktheplants.ru/api'

const env = import.meta.env ?? {}

const resolvedApiUrl =
  env.VITE_API_URL ||
  (env.DEV ? '/api' : DEFAULT_API_URL)

export const API_URL = resolvedApiUrl.replace(/\/+$/, '')

const DEFAULT_TIMEOUT_MS = 12_000

export const MESSENGER_CHANNELS = ['telegram', 'max']

const MESSENGER_CHANNEL_TITLES = {
  telegram: 'Telegram',
  max: 'MAX'
}

const UNAVAILABLE_STATUSES = new Set([404, 501, 502, 503, 504])

const STATUS_MESSAGES = {
  400: 'Сервер не принял запрос. Проверьте данные и попробуйте ещё раз.',
  401: 'Нужно снова войти в аккаунт.',
  403: 'Нет доступа к этому действию.',
  404: 'Функция пока недоступна: сервер ещё не обновлён.',
  409: 'Состояние уже изменилось. Обновите страницу и попробуйте ещё раз.',
  429: 'Слишком много попыток. Подождите немного и попробуйте ещё раз.',
  500: 'На сервере произошла ошибка. Попробуйте ещё раз позже.',
  501: 'Функция пока недоступна: сервер ещё не обновлён.',
  502: 'Сервер временно недоступен. Попробуйте ещё раз позже.',
  503: 'Сервис временно недоступен. Попробуйте позже.',
  504: 'Сервер не ответил вовремя. Попробуйте ещё раз позже.'
}

export class ApiError extends Error {
  constructor (message, { status = 0, code = '', cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isApiError (error) {
  return error instanceof ApiError
}

export function isApiUnavailable (error) {
  if (!error) return false
  if (error.code === 'network' || error.code === 'timeout') return true
  return UNAVAILABLE_STATUSES.has(Number(error.status))
}

export function isApiUnauthorized (error) {
  return Number(error?.status) === 401
}

export function safeExternalUrl (value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return ''
  return trimmed
}

export function normalizeMessengerChannel (value) {
  return MESSENGER_CHANNELS.includes(value) ? value : ''
}

function requireMessengerChannel (value) {
  const channel = normalizeMessengerChannel(value)
  if (!channel) {
    throw new ApiError('Неизвестный мессенджер. Обновите страницу и попробуйте ещё раз.', {
      status: 400,
      code: 'invalid-channel'
    })
  }
  return channel
}

function toCount (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

function toOptionalString (value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function toOptionalIsoString (value) {
  if (typeof value !== 'string') return null
  return value.trim() || null
}

async function requestApi (path, {
  method = 'GET',
  body,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let response

  try {
    response = await fetchWithTimeout(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    }, timeoutMs)
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError('Запрос отменён.', { code: 'aborted', cause: error })
    }
    if (/превышено время/i.test(String(error?.message || ''))) {
      throw new ApiError(
        'Сервер не ответил вовремя. Проверьте подключение и попробуйте ещё раз.',
        { code: 'timeout', cause: error }
      )
    }
    throw new ApiError(
      'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.',
      { code: 'network', cause: error }
    )
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const serverMessage = toOptionalString(data?.message)
    const statusMessage =
      STATUS_MESSAGES[response.status] ||
      `Не удалось выполнить запрос (HTTP ${response.status}).`

    throw new ApiError(serverMessage || statusMessage, {
      status: response.status,
      code: toOptionalString(data?.code) || ''
    })
  }

  return data
}

function normalizeMessengerChannelEntry (raw) {
  const channel = normalizeMessengerChannel(raw?.channel)
  if (!channel) return null

  return {
    channel,
    title: toOptionalString(raw?.title) || MESSENGER_CHANNEL_TITLES[channel],
    configured: raw?.configured === true,
    botUsername: toOptionalString(raw?.botUsername),
    botName: toOptionalString(raw?.botName),
    botUrl: safeExternalUrl(raw?.botUrl) || null,
    linked: raw?.linked === true,
    externalUsername: toOptionalString(raw?.externalUsername),
    linkedAt: toOptionalIsoString(raw?.linkedAt),
    notificationsEnabled: raw?.notificationsEnabled !== false,
    lastDeliveryAt: toOptionalIsoString(raw?.lastDeliveryAt),
    lastError: toOptionalString(raw?.lastError)
  }
}

function defaultMessengerChannel (channel) {
  return {
    channel,
    title: MESSENGER_CHANNEL_TITLES[channel],
    configured: false,
    botUsername: null,
    botName: null,
    botUrl: null,
    linked: false,
    externalUsername: null,
    linkedAt: null,
    notificationsEnabled: true,
    lastDeliveryAt: null,
    lastError: null
  }
}

export function normalizeMessengerChannelsPayload (payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.channels)) {
    throw new ApiError('Сервер вернул некорректный список мессенджеров.', {
      code: 'invalid-response'
    })
  }

  const byChannel = new Map()
  for (const raw of payload.channels) {
    const entry = normalizeMessengerChannelEntry(raw)
    if (entry && !byChannel.has(entry.channel)) byChannel.set(entry.channel, entry)
  }

  const channels = MESSENGER_CHANNELS.map(
    channel => byChannel.get(channel) ?? defaultMessengerChannel(channel)
  )

  const ttl = Number(payload.linkCodeTtlMinutes)
  const linkCodeTtlMinutes =
    Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : 15

  return { channels, linkCodeTtlMinutes }
}

export async function getMessengerChannels (options = {}) {
  const data = await requestApi('/bots', { ...options, method: 'GET' })
  return normalizeMessengerChannelsPayload(data)
}

export async function createMessengerLinkCode (channel, options = {}) {
  const normalizedChannel = requireMessengerChannel(channel)
  const data = await requestApi('/bots/link-code', {
    ...options,
    method: 'POST',
    body: { channel: normalizedChannel }
  })

  const code = toOptionalString(data?.code)
  const deepLink = safeExternalUrl(data?.deepLink)

  if (!code || !deepLink) {
    throw new ApiError(
      'Сервер не вернул код подключения. Попробуйте ещё раз или зайдите позже.',
      { code: 'invalid-response' }
    )
  }

  return {
    channel: normalizeMessengerChannel(data?.channel) || normalizedChannel,
    code,
    deepLink,
    botUsername: toOptionalString(data?.botUsername),
    expiresAt: toOptionalIsoString(data?.expiresAt)
  }
}

export async function unlinkMessenger (channel, options = {}) {
  const normalizedChannel = requireMessengerChannel(channel)
  const data = await requestApi('/bots/unlink', {
    ...options,
    method: 'POST',
    body: { channel: normalizedChannel }
  })

  return {
    channel: normalizeMessengerChannel(data?.channel) || normalizedChannel,
    linked: data?.linked === true
  }
}

export async function updateMessengerPreferences (channel, notificationsEnabled, options = {}) {
  const normalizedChannel = requireMessengerChannel(channel)
  const enabled = notificationsEnabled === true

  const data = await requestApi('/bots/preferences', {
    ...options,
    method: 'PATCH',
    body: { channel: normalizedChannel, notificationsEnabled: enabled }
  })

  return {
    channel: normalizeMessengerChannel(data?.channel) || normalizedChannel,
    notificationsEnabled:
      typeof data?.notificationsEnabled === 'boolean'
        ? data.notificationsEnabled
        : enabled
  }
}

export function normalizeCareStreakPayload (payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('Сервер вернул некорректные данные серии ухода.', {
      code: 'invalid-response'
    })
  }

  const weekRaw =
    payload.week && typeof payload.week === 'object' ? payload.week : {}

  const days = Array.isArray(weekRaw.days)
    ? weekRaw.days
        .filter(day => day && typeof day === 'object' && toOptionalIsoString(day.date))
        .map(day => ({
          date: String(day.date).trim(),
          status: typeof day.status === 'string' ? day.status : ''
        }))
    : []

  const recapRaw =
    payload.latestRecap && typeof payload.latestRecap === 'object'
      ? payload.latestRecap
      : null

  return {
    current: toCount(payload.current),
    best: toCount(payload.best),
    lastWateredAt: toOptionalIsoString(payload.lastWateredAt),
    week: {
      wateredOnTime: toCount(weekRaw.wateredOnTime),
      wateredLate: toCount(weekRaw.wateredLate),
      skipped: toCount(weekRaw.skipped),
      scheduled: toCount(weekRaw.scheduled),
      photos: toCount(weekRaw.photos),
      careActions: toCount(weekRaw.careActions),
      startDate: toOptionalIsoString(weekRaw.startDate),
      days
    },
    latestRecap: recapRaw
      ? {
          id: recapRaw.id ?? null,
          title: toOptionalString(recapRaw.title) || 'Итоги недели',
          body: typeof recapRaw.body === 'string' ? recapRaw.body : '',
          createdAt: toOptionalIsoString(recapRaw.createdAt),
          payload:
            recapRaw.payload && typeof recapRaw.payload === 'object'
              ? recapRaw.payload
              : null
        }
      : null,
    updatedAt: toOptionalIsoString(payload.updatedAt)
  }
}

export async function getCareStreak (options = {}) {
  const data = await requestApi('/users/me/care-streak', {
    ...options,
    method: 'GET'
  })
  return normalizeCareStreakPayload(data)
}
