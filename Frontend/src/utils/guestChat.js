export const GUEST_CHAT_STORAGE_KEY = 'webplant_guest_chat'
export const GUEST_CHAT_MAX_MESSAGES = 20
export const GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS = 3

const HISTORY_VERSION = 1
const ROLE_USER = 'user'
const ROLE_ASSISTANT = 'assistant'
const ROLES = new Set([ROLE_USER, ROLE_ASSISTANT])

function cleanText (value, maxLength = 2000) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function cleanLongText (value, maxLength = 4000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function normalizeGuestChatMessage (entry) {
  if (!entry || typeof entry !== 'object') return null

  const role = ROLES.has(entry.role) ? entry.role : ''
  const text = cleanLongText(entry.text)
  if (!role || !text) return null

  const message = { role, text }
  const createdAt = cleanText(entry.createdAt, 40)
  if (createdAt) message.createdAt = createdAt
  return message
}

export function normalizeGuestChatHistory (raw, { maxMessages = GUEST_CHAT_MAX_MESSAGES } = {}) {
  const limit = Number.isInteger(maxMessages) && maxMessages > 0 ? maxMessages : GUEST_CHAT_MAX_MESSAGES
  const source = Array.isArray(raw?.messages) ? raw.messages : Array.isArray(raw) ? raw : []

  const messages = []
  for (const entry of source) {
    const message = normalizeGuestChatMessage(entry)
    if (message) messages.push(message)
  }

  return {
    version: HISTORY_VERSION,
    sessionId: cleanText(raw?.sessionId, 60) || null,
    messages: messages.slice(-limit)
  }
}

export function countGuestChatAnswers (history) {
  const messages = Array.isArray(history?.messages) ? history.messages : []
  return messages.filter(message => message?.role === ROLE_ASSISTANT).length
}

export function countGuestChatQuestions (history) {
  const messages = Array.isArray(history?.messages) ? history.messages : []
  return messages.filter(message => message?.role === ROLE_USER).length
}

export function shouldSuggestSavingGuestChat (history) {
  return countGuestChatAnswers(history) >= GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS
}

export function buildGuestChatRecord ({ sessionId = null, messages = [] } = {}) {
  const normalized = normalizeGuestChatHistory({ sessionId, messages })
  if (!normalized.messages.length) return null
  return normalized
}

export function appendGuestChatMessage (history, entry) {
  const base = normalizeGuestChatHistory(history)
  const message = normalizeGuestChatMessage(entry)
  if (!message) return base

  return {
    ...base,
    messages: [...base.messages, message].slice(-GUEST_CHAT_MAX_MESSAGES)
  }
}

function resolveStorage (storage) {
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

export function saveGuestChatHistory (history, { storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  const record = buildGuestChatRecord(history)
  if (!record) return false

  try {
    target.setItem(GUEST_CHAT_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch (error) {
    console.warn('Не удалось сохранить гостевой чат:', error)
    return false
  }
}

export function readGuestChatHistory ({ storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return normalizeGuestChatHistory(null)

  try {
    const raw = target.getItem(GUEST_CHAT_STORAGE_KEY)
    if (!raw) return normalizeGuestChatHistory(null)
    return normalizeGuestChatHistory(JSON.parse(raw))
  } catch {
    return normalizeGuestChatHistory(null)
  }
}

export function hasGuestChatHistory ({ storage } = {}) {
  return readGuestChatHistory({ storage }).messages.length > 0
}

export function clearGuestChatHistory ({ storage } = {}) {
  const target = resolveStorage(storage)
  if (!target) return false

  try {
    target.removeItem(GUEST_CHAT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
