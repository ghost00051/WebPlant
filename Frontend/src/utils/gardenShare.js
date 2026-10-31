export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
export const SHARE_TOKEN_STORAGE_KEY = 'webplant-garden-share-token'
export const SHARE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SHARE_UTM_SOURCE = 'share'
export const SHARE_UTM_MEDIUM = 'garden'
export const SHARE_UTM_CAMPAIGN_PARAM = 'utm_campaign'
export const DEFAULT_SITE_ORIGIN = 'https://checktheplants.ru'
export const GARDEN_PATH_PREFIX = '/garden'
export const REGISTER_PATH = '/register'
export const GARDEN_SHARE_TITLE = 'Сад в «Лейке» — коллекция растений'

export function isValidShareToken (value) {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value)
}

export function buildSharePath (token) {
  if (!isValidShareToken(token)) return null
  return `${GARDEN_PATH_PREFIX}/${token}`
}

export function buildShareUrl (token, origin = DEFAULT_SITE_ORIGIN) {
  const path = buildSharePath(token)
  if (!path) return null

  const base = typeof origin === 'string' && origin.trim()
    ? origin.trim().replace(/\/+$/, '')
    : DEFAULT_SITE_ORIGIN

  return `${base}${path}?utm_source=${SHARE_UTM_SOURCE}` +
    `&utm_medium=${SHARE_UTM_MEDIUM}` +
    `&utm_campaign=${encodeURIComponent(token)}`
}

export function buildRegistrationPath (token) {
  if (!isValidShareToken(token)) return REGISTER_PATH
  return `${REGISTER_PATH}?utm_source=${SHARE_UTM_SOURCE}` +
    `&utm_medium=${SHARE_UTM_MEDIUM}` +
    `&utm_campaign=${encodeURIComponent(token)}`
}

function toSearchParams (search) {
  if (typeof search === 'string') {
    const raw = search.trim()
    if (!raw) return new URLSearchParams('')
    return new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`)
  }
  if (search && typeof search.get === 'function') return search
  return new URLSearchParams('')
}

export function readUtmShareToken (search) {
  try {
    const params = toSearchParams(search)
    const source = String(params.get('utm_source') || '').trim().toLowerCase()
    if (source !== SHARE_UTM_SOURCE) return null

    const medium = String(params.get('utm_medium') || '').trim().toLowerCase()
    if (medium && medium !== SHARE_UTM_MEDIUM) return null

    const campaign = params.get(SHARE_UTM_CAMPAIGN_PARAM)
    return isValidShareToken(campaign) ? campaign : null
  } catch {
    return null
  }
}

function getStorage () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function parseStoredShare (raw) {
  if (typeof raw !== 'string' || !raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      savedAt: Number(parsed.savedAt)
    }
  }

  return { token: raw, savedAt: Number.NaN }
}

function writeStoredShare (storage, token, savedAt = Date.now()) {
  storage.setItem(SHARE_TOKEN_STORAGE_KEY, JSON.stringify({ token, savedAt }))
}

function isStoredShareExpired (savedAt, now = Date.now()) {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return false
  return now - savedAt > SHARE_TOKEN_TTL_MS
}

export function rememberShareToken (token) {
  if (!isValidShareToken(token)) return false
  const storage = getStorage()
  if (!storage) return false

  try {
    writeStoredShare(storage, token)
    return true
  } catch {
    return false
  }
}

export function readShareToken () {
  const storage = getStorage()
  if (!storage) return null

  try {
    const stored = storage.getItem(SHARE_TOKEN_STORAGE_KEY)
    const record = parseStoredShare(stored)
    if (!record || !isValidShareToken(record.token)) return null

    if (isStoredShareExpired(record.savedAt)) {
      storage.removeItem(SHARE_TOKEN_STORAGE_KEY)
      return null
    }

    if (!Number.isFinite(record.savedAt)) {
      writeStoredShare(storage, record.token)
    }

    return record.token
  } catch {
    return null
  }
}

export function clearShareToken () {
  const storage = getStorage()
  if (!storage) return false

  try {
    storage.removeItem(SHARE_TOKEN_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

async function apiUrl () {
  const { API_URL } = await import('./api.js')
  return API_URL
}

async function apiRequest (path, options = {}) {
  const base = await apiUrl()
  return fetch(`${base}${path}`, {
    credentials: 'include',
    ...options
  })
}

async function readErrorMessage (response, fallback) {
  try {
    const data = await response.json()
    if (data && typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim()
    }
  } catch {
    return fallback
  }
  return fallback
}

async function readJson (response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function normalizeCount (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number)
}

function normalizeShare (raw) {
  if (!raw || typeof raw !== 'object') return null

  const token = typeof raw.token === 'string' ? raw.token : ''
  if (!isValidShareToken(token)) return null

  const path = typeof raw.path === 'string' && raw.path.startsWith('/')
    ? raw.path
    : buildSharePath(token)

  return {
    token,
    path,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    viewCount: normalizeCount(raw.viewCount),
    signupCount: normalizeCount(raw.signupCount)
  }
}

function normalizePlant (raw, index) {
  if (!raw || typeof raw !== 'object') return null

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null

  const species = typeof raw.species === 'string' ? raw.species.trim() : ''
  const intervalDays = Number(raw.intervalDays)

  return {
    id: Number.isInteger(raw.id) ? raw.id : `plant-${index}`,
    name,
    species,
    intervalDays: Number.isFinite(intervalDays) && intervalDays > 0
      ? Math.round(intervalDays)
      : null
  }
}

function normalizeGarden (raw, fallbackToken) {
  if (!raw || typeof raw !== 'object') return null

  const token = isValidShareToken(raw.token) ? raw.token : fallbackToken
  if (!isValidShareToken(token)) return null

  const plants = Array.isArray(raw.plants)
    ? raw.plants.map(normalizePlant).filter(Boolean)
    : []
  const ownerName = typeof raw.ownerName === 'string' && raw.ownerName.trim()
    ? raw.ownerName.trim()
    : 'Садовник'

  const hasPlantCount = Number.isFinite(Number(raw.plantCount)) && Number(raw.plantCount) >= 0
  const plantCount = hasPlantCount ? Math.round(Number(raw.plantCount)) : plants.length

  return {
    token,
    ownerName,
    plantCount,
    plants,
    sharedAt: typeof raw.sharedAt === 'string' ? raw.sharedAt : null,
    viewCount: normalizeCount(raw.viewCount)
  }
}

export async function fetchShareStatus () {
  const response = await apiRequest('/garden/share', { method: 'GET' })
  if (response.status === 401) return null
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Не удалось проверить ссылку сада'))
  }

  const data = await readJson(response)
  return normalizeShare(data && data.share)
}

export async function createGardenShare () {
  const response = await apiRequest('/garden/share', { method: 'POST' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Не удалось создать ссылку на сад'))
  }

  const data = await readJson(response)
  const share = normalizeShare(data && data.share)
  if (!share) throw new Error('Сервер вернул некорректную ссылку на сад')
  return share
}

export async function revokeGardenShare () {
  const response = await apiRequest('/garden/share', { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Не удалось отозвать ссылку на сад'))
  }
  return true
}

export async function fetchPublicGarden (token, options = {}) {
  if (!isValidShareToken(token)) return null

  const response = await apiRequest(`/garden/${encodeURIComponent(token)}`, {
    method: 'GET',
    signal: options.signal
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Не удалось открыть сад'))
  }

  const data = await readJson(response)
  return normalizeGarden(data && data.garden, token)
}

function copyWithFallback (text) {
  try {
    if (typeof document === 'undefined' || !document.body) return false

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    document.body.appendChild(textarea)
    textarea.select()

    const copied = typeof document.execCommand === 'function'
      ? document.execCommand('copy')
      : false
    document.body.removeChild(textarea)
    return Boolean(copied)
  } catch {
    return false
  }
}

export async function copyToClipboard (text) {
  if (typeof text !== 'string' || !text) return false

  try {
    if (typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return copyWithFallback(text)
  }

  return copyWithFallback(text)
}

export async function shareGardenLink (data = {}) {
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  if (!url) return 'cancelled'

  const shareData = { url }
  if (typeof data.title === 'string' && data.title.trim()) {
    shareData.title = data.title.trim()
  }
  if (typeof data.text === 'string' && data.text.trim()) {
    shareData.text = data.text.trim()
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData)
      return 'shared'
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
        return 'cancelled'
      }
    }
  }

  return (await copyToClipboard(url)) ? 'copied' : 'cancelled'
}
