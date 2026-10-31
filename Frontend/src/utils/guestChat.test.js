import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GUEST_CHAT_MAX_MESSAGES,
  GUEST_CHAT_STORAGE_KEY,
  GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS,
  appendGuestChatMessage,
  clearGuestChatHistory,
  countGuestChatAnswers,
  countGuestChatQuestions,
  hasGuestChatHistory,
  normalizeGuestChatHistory,
  normalizeGuestChatMessage,
  readGuestChatHistory,
  readGuestLinkResult,
  saveGuestChatHistory,
  shouldSuggestSavingGuestChat
} from './guestChat.js'

function createMemoryStorage (initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  }
}

test('normalizeGuestChatMessage: принимает только пары role+text', () => {
  assert.deepEqual(
    normalizeGuestChatMessage({ role: 'assistant', text: '  Поливайте раз в неделю.  ' }),
    { role: 'assistant', text: 'Поливайте раз в неделю.' }
  )
  assert.equal(normalizeGuestChatMessage({ role: 'system', text: 'нет' }), null)
  assert.equal(normalizeGuestChatMessage({ role: 'user', text: '   ' }), null)
  assert.equal(normalizeGuestChatMessage(null), null)
})

test('normalizeGuestChatHistory: отбрасывает мусор и обрезает хвост', () => {
  const raw = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    messages: [
      { role: 'user', text: 'Почему желтеют листья?' },
      { role: 'assistant', text: 'Из-за перелива.' },
      { role: 'narrator', text: 'лишнее' },
      { role: 'user', text: '' }
    ]
  }

  const history = normalizeGuestChatHistory(raw)
  assert.equal(history.messages.length, 2)
  assert.equal(history.sessionId, '11111111-1111-4111-8111-111111111111')

  const long = { messages: Array.from({ length: GUEST_CHAT_MAX_MESSAGES + 5 }, (_, index) => ({ role: 'user', text: `вопрос ${index}` })) }
  const trimmed = normalizeGuestChatHistory(long)
  assert.equal(trimmed.messages.length, GUEST_CHAT_MAX_MESSAGES)
  assert.equal(trimmed.messages[0].text, 'вопрос 5')
})

test('countGuestChatAnswers/Questions и подсказка «сохранить» считают корректно', () => {
  const history = normalizeGuestChatHistory({
    messages: [
      { role: 'user', text: 'раз' },
      { role: 'assistant', text: 'ответ 1' },
      { role: 'user', text: 'два' },
      { role: 'assistant', text: 'ответ 2' }
    ]
  })

  assert.equal(countGuestChatAnswers(history), 2)
  assert.equal(countGuestChatQuestions(history), 2)
  assert.equal(shouldSuggestSavingGuestChat(history), false)
  assert.equal(GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS, 3)

  const withThree = appendGuestChatMessage(history, { role: 'assistant', text: 'ответ 3' })
  assert.equal(shouldSuggestSavingGuestChat(withThree), true)
})

test('appendGuestChatMessage: не ломается на мусоре и сохраняет порядок', () => {
  const base = normalizeGuestChatHistory(null)
  const next = appendGuestChatMessage(base, { role: 'user', text: 'Когда поливать монстеру?' })
  assert.equal(next.messages.length, 1)
  assert.deepEqual(next.messages[0], { role: 'user', text: 'Когда поливать монстеру?' })

  assert.equal(appendGuestChatMessage(base, null).messages.length, 0)
})

test('save/read/clear: гостевой чат переживает перезагрузку страницы', () => {
  const storage = createMemoryStorage()

  assert.equal(hasGuestChatHistory({ storage }), false)
  assert.equal(readGuestChatHistory({ storage }).messages.length, 0)

  const history = normalizeGuestChatHistory({
    sessionId: '22222222-2222-4222-8222-222222222222',
    messages: [
      { role: 'user', text: 'Почему желтеет фикус?' },
      { role: 'assistant', text: 'Проверьте полив и свет.' }
    ]
  })

  assert.equal(saveGuestChatHistory(history, { storage }), true)
  assert.equal(storage.getItem(GUEST_CHAT_STORAGE_KEY) !== null, true)

  const restored = readGuestChatHistory({ storage })
  assert.equal(restored.messages.length, 2)
  assert.equal(restored.sessionId, '22222222-2222-4222-8222-222222222222')
  assert.equal(countGuestChatAnswers(restored), 1)
  assert.equal(hasGuestChatHistory({ storage }), true)

  assert.equal(clearGuestChatHistory({ storage }), true)
  assert.equal(hasGuestChatHistory({ storage }), false)
})

test('readGuestChatHistory: битый localStorage не роняет приложение', () => {
  const storage = createMemoryStorage({ [GUEST_CHAT_STORAGE_KEY]: '{не json' })
  const history = readGuestChatHistory({ storage })
  assert.deepEqual(history.messages, [])
})

test('saveGuestChatHistory: пустая история не пишется', () => {
  const storage = createMemoryStorage()
  assert.equal(saveGuestChatHistory({ messages: [] }, { storage }), false)
  assert.equal(storage.getItem(GUEST_CHAT_STORAGE_KEY), null)
})

test('readGuestLinkResult: перенос подтверждается только guestLink.linked === true', () => {
  assert.deepEqual(
    readGuestLinkResult({ guestLink: { linked: true, chatMessages: 3, consents: 1 } }),
    { supported: true, linked: true, chatMessages: 3, consents: 1, chatCountKnown: true }
  )
  assert.deepEqual(
    readGuestLinkResult({ guestLink: { linked: false, chatMessages: 0 } }),
    { supported: true, linked: false, chatMessages: 0, consents: 0, chatCountKnown: true }
  )
  assert.deepEqual(
    readGuestLinkResult({ guestLink: { chatMessages: 2 } }),
    { supported: true, linked: false, chatMessages: 2, consents: 0, chatCountKnown: true }
  )
  assert.deepEqual(
    readGuestLinkResult({ user: { id: 1 } }),
    { supported: false, linked: false, chatMessages: 0, consents: 0, chatCountKnown: false }
  )
  assert.equal(readGuestLinkResult(null).supported, false)
  assert.equal(readGuestLinkResult(null).linked, false)
})
