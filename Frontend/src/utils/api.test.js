import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  createMessengerLinkCode,
  getCareStreak,
  getMessengerChannels,
  isApiUnavailable,
  normalizeCareStreakPayload,
  normalizeMessengerChannelsPayload,
  safeExternalUrl,
  unlinkMessenger,
  updateMessengerPreferences
} from './api.js'

function jsonResponse (body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function withFetchMock (handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function expectApiError (promise, check) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ApiError)
    assert.ok(error instanceof Error)
    check?.(error)
    return true
  })
}

test('getMessengerChannels: нормализует каналы и отбрасывает неизвестные', async () => {
  const calls = []

  await withFetchMock(url => {
    calls.push(String(url))
    return jsonResponse({
      channels: [
        {
          channel: 'telegram',
          title: 'Telegram',
          configured: true,
          botUsername: 'leyka_bot',
          botUrl: 'https://t.me/leyka_bot',
          linked: true,
          externalUsername: '@ivan',
          linkedAt: '2026-10-20T10:00:00.000Z',
          notificationsEnabled: false
        },
        { channel: 'max', configured: false },
        { channel: 'vk', configured: true }
      ],
      linkCodeTtlMinutes: 15
    })
  }, async () => {
    const data = await getMessengerChannels()

    assert.equal(data.channels.length, 2)
    assert.equal(data.linkCodeTtlMinutes, 15)

    const telegram = data.channels[0]
    assert.equal(telegram.channel, 'telegram')
    assert.equal(telegram.configured, true)
    assert.equal(telegram.linked, true)
    assert.equal(telegram.externalUsername, '@ivan')
    assert.equal(telegram.notificationsEnabled, false)
    assert.equal(telegram.botUsername, 'leyka_bot')

    const max = data.channels[1]
    assert.equal(max.channel, 'max')
    assert.equal(max.title, 'MAX')
    assert.equal(max.configured, false)
    assert.equal(max.linked, false)
    assert.equal(max.notificationsEnabled, true)
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0], /\/bots$/)
})

test('getMessengerChannels: 404 отдаёт понятную ошибку недоступности', async () => {
  await withFetchMock(
    () => new Response('Not found', { status: 404 }),
    async () => {
      await expectApiError(getMessengerChannels(), error => {
        assert.equal(error.status, 404)
        assert.equal(isApiUnavailable(error), true)
        assert.match(error.message, /недоступн/i)
      })
    }
  )
})

test('getMessengerChannels: 503 с сообщением сервера сохраняет текст', async () => {
  await withFetchMock(
    () => jsonResponse({ message: 'Канал не настроен на сервере' }, 503),
    async () => {
      await expectApiError(getMessengerChannels(), error => {
        assert.equal(error.status, 503)
        assert.equal(error.message, 'Канал не настроен на сервере')
        assert.equal(isApiUnavailable(error), true)
      })
    }
  )
})

test('getMessengerChannels: сетевая ошибка не ломает страницу', async () => {
  await withFetchMock(
    () => Promise.reject(new TypeError('Failed to fetch')),
    async () => {
      await expectApiError(getMessengerChannels(), error => {
        assert.equal(error.code, 'network')
        assert.equal(isApiUnavailable(error), true)
        assert.match(error.message, /связаться с сервером/i)
      })
    }
  )
})

test('getMessengerChannels: таймаут превращается в дружелюбную ошибку', async () => {
  await withFetchMock(
    (url, options = {}) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse({ channels: [] })), 500)
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    async () => {
      await expectApiError(getMessengerChannels({ timeoutMs: 20 }), error => {
        assert.equal(error.code, 'timeout')
        assert.match(error.message, /не ответил вовремя/i)
      })
    }
  )
})

test('getMessengerChannels: некорректный ответ помечается invalid-response', async () => {
  await withFetchMock(() => jsonResponse({ ok: true }), async () => {
    await expectApiError(getMessengerChannels(), error => {
      assert.equal(error.code, 'invalid-response')
    })
  })
})

test('createMessengerLinkCode: отправляет канал и возвращает диплинк с кодом', async () => {
  let capturedUrl = ''
  let capturedOptions = null

  await withFetchMock((url, options) => {
    capturedUrl = String(url)
    capturedOptions = options
    return jsonResponse({
      channel: 'telegram',
      code: 'AB12CD34',
      deepLink: 'https://t.me/leyka_bot?start=AB12CD34',
      botUsername: 'leyka_bot',
      expiresAt: '2026-10-25T12:15:00.000Z'
    })
  }, async () => {
    const data = await createMessengerLinkCode('telegram')

    assert.equal(data.channel, 'telegram')
    assert.equal(data.code, 'AB12CD34')
    assert.equal(data.deepLink, 'https://t.me/leyka_bot?start=AB12CD34')
    assert.equal(data.botUsername, 'leyka_bot')
    assert.match(data.expiresAt, /^2026-10-25/)
  })

  assert.match(capturedUrl, /\/bots\/link-code$/)
  assert.equal(capturedOptions.method, 'POST')
  assert.equal(capturedOptions.credentials, 'include')
  assert.deepEqual(JSON.parse(capturedOptions.body), { channel: 'telegram' })
})

test('createMessengerLinkCode: отклоняет небезопасную ссылку и неизвестный канал', async () => {
  await withFetchMock(
    () => jsonResponse({
      channel: 'max',
      code: 'ABC',
      deepLink: 'javascript:alert(1)'
    }),
    async () => {
      await expectApiError(createMessengerLinkCode('max'), error => {
        assert.equal(error.code, 'invalid-response')
        assert.match(error.message, /код подключения/i)
      })
    }
  )

  await expectApiError(createMessengerLinkCode('vk'), error => {
    assert.equal(error.code, 'invalid-channel')
  })
})

test('unlinkMessenger: отвязывает канал и возвращает статус', async () => {
  let capturedUrl = ''
  let capturedOptions = null

  await withFetchMock((url, options) => {
    capturedUrl = String(url)
    capturedOptions = options
    return jsonResponse({ channel: 'max', linked: false })
  }, async () => {
    const data = await unlinkMessenger('max')
    assert.deepEqual(data, { channel: 'max', linked: false })
  })

  assert.match(capturedUrl, /\/bots\/unlink$/)
  assert.equal(capturedOptions.method, 'POST')
  assert.deepEqual(JSON.parse(capturedOptions.body), { channel: 'max' })
})

test('updateMessengerPreferences: отправляет тумблер напоминаний', async () => {
  let capturedOptions = null

  await withFetchMock((url, options) => {
    capturedOptions = options
    return jsonResponse({ channel: 'telegram', notificationsEnabled: false })
  }, async () => {
    const data = await updateMessengerPreferences('telegram', false)
    assert.deepEqual(data, { channel: 'telegram', notificationsEnabled: false })
  })

  assert.equal(capturedOptions.method, 'PATCH')
  assert.deepEqual(JSON.parse(capturedOptions.body), {
    channel: 'telegram',
    notificationsEnabled: false
  })
})

test('getCareStreak: нормализует серию, неделю и итоги', async () => {
  await withFetchMock(() => jsonResponse({
    current: 4,
    best: 9,
    lastWateredAt: '2026-10-24T08:00:00.000Z',
    week: {
      wateredOnTime: 3,
      wateredLate: 1,
      skipped: 0,
      scheduled: 4,
      photos: 2,
      careActions: 5,
      startDate: '2026-10-19',
      days: [
        { date: '2026-10-19', status: 'on_time' },
        { date: null },
        { date: '2026-10-20', status: 'late' }
      ]
    },
    latestRecap: {
      id: 42,
      title: '🌿 Итоги недели',
      body: 'Отличная неделя',
      createdAt: '2026-10-19T16:00:00.000Z',
      payload: { stats: { photos: 2 } }
    },
    updatedAt: '2026-10-25T09:00:00.000Z'
  }), async () => {
    const streak = await getCareStreak()

    assert.equal(streak.current, 4)
    assert.equal(streak.best, 9)
    assert.equal(streak.week.wateredOnTime, 3)
    assert.equal(streak.week.wateredLate, 1)
    assert.equal(streak.week.photos, 2)
    assert.equal(streak.week.days.length, 2)
    assert.deepEqual(streak.week.days[0], { date: '2026-10-19', status: 'on_time' })
    assert.equal(streak.latestRecap.id, 42)
    assert.equal(streak.latestRecap.body, 'Отличная неделя')
    assert.deepEqual(streak.latestRecap.payload.stats, { photos: 2 })
  })
})

test('normalizeCareStreakPayload: пустые значения превращаются в нули и null', () => {
  const streak = normalizeCareStreakPayload({ current: '3', best: -1, week: null })

  assert.equal(streak.current, 3)
  assert.equal(streak.best, 0)
  assert.equal(streak.lastWateredAt, null)
  assert.equal(streak.latestRecap, null)
  assert.deepEqual(streak.week, {
    wateredOnTime: 0,
    wateredLate: 0,
    skipped: 0,
    scheduled: 0,
    photos: 0,
    careActions: 0,
    startDate: null,
    days: []
  })
})

test('normalizeCareStreakPayload: без объекта кидает понятную ошибку', () => {
  assert.throws(
    () => normalizeCareStreakPayload(null),
    error => error instanceof ApiError && error.code === 'invalid-response'
  )
})

test('safeExternalUrl: пропускает только http(s) ссылки', () => {
  assert.equal(safeExternalUrl('https://t.me/bot'), 'https://t.me/bot')
  assert.equal(safeExternalUrl(' http://example.com '), 'http://example.com')
  assert.equal(safeExternalUrl('javascript:alert(1)'), '')
  assert.equal(safeExternalUrl('data:text/html,hi'), '')
  assert.equal(safeExternalUrl(null), '')
})

test('normalizeMessengerChannelsPayload: добавляет отсутствующие каналы', () => {
  const data = normalizeMessengerChannelsPayload({
    channels: [{ channel: 'telegram', configured: true }]
  })

  assert.equal(data.channels.length, 2)
  assert.equal(data.channels[0].channel, 'telegram')
  assert.equal(data.channels[1].channel, 'max')
  assert.equal(data.channels[1].configured, false)
  assert.equal(data.linkCodeTtlMinutes, 15)
})
