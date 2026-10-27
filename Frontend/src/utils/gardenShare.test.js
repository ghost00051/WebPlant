import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SITE_ORIGIN,
  SHARE_TOKEN_STORAGE_KEY,
  SHARE_TOKEN_TTL_MS,
  buildRegistrationPath,
  buildSharePath,
  buildShareUrl,
  clearShareToken,
  isValidShareToken,
  readShareToken,
  readUtmShareToken,
  rememberShareToken
} from './gardenShare.js'

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt1234'
const TOKEN_2 = 'ZzYyXxWwVvUuTtSsRrQq0987'
const OTHER_TOKEN = 'MnOpQrStUvWxYzAbCdEf5678'

function withLocalStorage (run) {
  const store = new Map()
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    }
  }

  try {
    run(store)
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
}

test('isValidShareToken: принимает токены 16-64 символов [A-Za-z0-9_-]', () => {
  assert.equal(isValidShareToken(TOKEN), true)
  assert.equal(isValidShareToken('a'.repeat(16)), true)
  assert.equal(isValidShareToken('a'.repeat(64)), true)
  assert.equal(isValidShareToken('a_b-C9'.repeat(3)), true)
})

test('isValidShareToken: отклоняет пустые, короткие, длинные и мусор', () => {
  assert.equal(isValidShareToken(''), false)
  assert.equal(isValidShareToken('a'.repeat(15)), false)
  assert.equal(isValidShareToken('a'.repeat(65)), false)
  assert.equal(isValidShareToken('токен-с-кириллицей'), false)
  assert.equal(isValidShareToken('abcdefghij klmnopq'), false)
  assert.equal(isValidShareToken('abcdefghij/klmnopq'), false)
  assert.equal(isValidShareToken(null), false)
  assert.equal(isValidShareToken(undefined), false)
  assert.equal(isValidShareToken(1234567890123456), false)
})

test('buildSharePath: путь публичной страницы или null для невалидного токена', () => {
  assert.equal(buildSharePath(TOKEN), `/garden/${TOKEN}`)
  assert.equal(buildSharePath('short'), null)
  assert.equal(buildSharePath(undefined), null)
})

test('buildShareUrl: абсолютная ссылка с utm-метками шаринга', () => {
  assert.equal(
    buildShareUrl(TOKEN),
    `${DEFAULT_SITE_ORIGIN}/garden/${TOKEN}?utm_source=share&utm_medium=garden&utm_campaign=${TOKEN}`
  )
  assert.equal(
    buildShareUrl(TOKEN, 'http://localhost:5173/'),
    `http://localhost:5173/garden/${TOKEN}?utm_source=share&utm_medium=garden&utm_campaign=${TOKEN}`
  )
  assert.equal(buildShareUrl('short'), null)
})

test('buildShareUrl: origin не нужен — ссылка на каноническом домене', () => {
  const url = buildShareUrl(TOKEN)
  assert.ok(url.startsWith('https://checktheplants.ru/garden/'))
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('utm_source'), 'share')
  assert.equal(parsed.searchParams.get('utm_medium'), 'garden')
  assert.equal(parsed.searchParams.get('utm_campaign'), TOKEN)
})

test('buildRegistrationPath: ref-метки переносятся в регистрацию', () => {
  assert.equal(
    buildRegistrationPath(TOKEN),
    `/register?utm_source=share&utm_medium=garden&utm_campaign=${TOKEN}`
  )
  assert.equal(buildRegistrationPath('short'), '/register')
})

test('readUtmShareToken: токен берётся из utm_campaign при utm_source=share', () => {
  const query = `?utm_source=share&utm_medium=garden&utm_campaign=${TOKEN}`
  assert.equal(readUtmShareToken(query), TOKEN)
  assert.equal(
    readUtmShareToken(new URLSearchParams(query.slice(1))),
    TOKEN
  )
  assert.equal(
    readUtmShareToken(`utm_source=share&utm_campaign=${TOKEN}`),
    TOKEN
  )
})

test('readUtmShareToken: чужие источники и невалидные кампании игнорируются', () => {
  assert.equal(
    readUtmShareToken(`?utm_source=telegram&utm_medium=garden&utm_campaign=${TOKEN}`),
    null
  )
  assert.equal(
    readUtmShareToken(`?utm_source=share&utm_medium=social&utm_campaign=${TOKEN}`),
    null
  )
  assert.equal(
    readUtmShareToken('?utm_source=share&utm_medium=garden&utm_campaign=short'),
    null
  )
  assert.equal(readUtmShareToken('?utm_source=share&utm_medium=garden'), null)
  assert.equal(readUtmShareToken(''), null)
  assert.equal(readUtmShareToken(undefined), null)
  assert.equal(readUtmShareToken(null), null)
})

test('rememberShareToken/readShareToken: в localStorage попадают только валидные токены', () => {
  withLocalStorage(store => {
    assert.equal(rememberShareToken('short'), false)
    assert.equal(rememberShareToken(undefined), false)
    assert.equal(store.size, 0)
    assert.equal(readShareToken(), null)

    assert.equal(rememberShareToken(TOKEN), true)
    const record = JSON.parse(store.get(SHARE_TOKEN_STORAGE_KEY))
    assert.equal(record.token, TOKEN)
    assert.ok(Number.isFinite(record.savedAt))
    assert.equal(readShareToken(), TOKEN)

    store.set(SHARE_TOKEN_STORAGE_KEY, 'испорченное значение')
    assert.equal(readShareToken(), null)
  })
})

test('readShareToken: токен действует 7 дней, затем удаляется как протухший (INT-06)', () => {
  withLocalStorage(store => {
    store.set(SHARE_TOKEN_STORAGE_KEY, JSON.stringify({
      token: TOKEN,
      savedAt: Date.now() - SHARE_TOKEN_TTL_MS - 1000
    }))
    assert.equal(readShareToken(), null)
    assert.equal(store.has(SHARE_TOKEN_STORAGE_KEY), false)

    store.set(SHARE_TOKEN_STORAGE_KEY, JSON.stringify({
      token: TOKEN,
      savedAt: Date.now() - SHARE_TOKEN_TTL_MS + 60_000
    }))
    assert.equal(readShareToken(), TOKEN)
  })
})

test('readShareToken: старый строковый формат читается и мигрирует в запись с TTL', () => {
  withLocalStorage(store => {
    store.set(SHARE_TOKEN_STORAGE_KEY, TOKEN)
    assert.equal(readShareToken(), TOKEN)
    const migrated = JSON.parse(store.get(SHARE_TOKEN_STORAGE_KEY))
    assert.equal(migrated.token, TOKEN)
    assert.ok(Number.isFinite(migrated.savedAt))
  })
})

test('readShareToken: без localStorage не падает и возвращает null', () => {
  const previousWindow = globalThis.window
  globalThis.window = undefined
  try {
    assert.equal(readShareToken(), null)
    assert.equal(rememberShareToken(TOKEN), false)
    assert.equal(clearShareToken(), false)
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})

test('clearShareToken: удаляет запомненный токен', () => {
  withLocalStorage(store => {
    rememberShareToken(TOKEN)
    assert.equal(store.has(SHARE_TOKEN_STORAGE_KEY), true)
    assert.equal(clearShareToken(), true)
    assert.equal(store.has(SHARE_TOKEN_STORAGE_KEY), false)
    assert.equal(readShareToken(), null)

    rememberShareToken(TOKEN_2)
    assert.equal(readShareToken(), TOKEN_2)
    rememberShareToken(OTHER_TOKEN)
    assert.equal(readShareToken(), OTHER_TOKEN)
  })
})
