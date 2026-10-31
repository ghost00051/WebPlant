import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DELIVERY_MODE_DIGEST,
  DELIVERY_MODE_PER_PLANT,
  isTimeValue,
  loadNotificationPreferences,
  normalizeNotificationPreferences,
  readLocalNotificationPreferences,
  saveNotificationPreferences,
  validateQuietHours,
  writeLocalNotificationPreferences
} from './notificationsExtraApi.js'

function withLocalStorage (fn) {
  const store = new Map()
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  }
  const previous = globalThis.window
  globalThis.window = { localStorage }
  try {
    return fn(localStorage, store)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

async function withLocalStorageAsync (fn) {
  const store = new Map()
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  }
  const previous = globalThis.window
  globalThis.window = { localStorage }
  try {
    return await fn(localStorage, store)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

async function withFetchResponse (handler, fn) {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => handler(url, options)
  try {
    return await fn()
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
  }
}

function jsonResponse (status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  }
}

test('isTimeValue принимает только ЧЧ:ММ', () => {
  assert.equal(isTimeValue('00:00'), true)
  assert.equal(isTimeValue('23:59'), true)
  assert.equal(isTimeValue('7:00'), false)
  assert.equal(isTimeValue('24:00'), false)
  assert.equal(isTimeValue('12:60'), false)
  assert.equal(isTimeValue(''), false)
  assert.equal(isTimeValue(null), false)
})

test('normalizeNotificationPreferences читает контракт backend (delivery_mode/quiet_hours_*)', () => {
  const result = normalizeNotificationPreferences({
    delivery_mode: 'per_plant',
    quiet_hours_enabled: true,
    quiet_hours_start: '23:00',
    quiet_hours_end: '07:30',
    quiet_hours_timezone: 'Europe/Moscow'
  })
  assert.equal(result.deliveryMode, DELIVERY_MODE_PER_PLANT)
  assert.deepEqual(result.quietHours, {
    enabled: true,
    start: '23:00',
    end: '07:30',
    timezone: 'Europe/Moscow'
  })
  assert.deepEqual(result.serverSupports, { deliveryMode: true, quietHours: true })
})

test('normalizeNotificationPreferences терпит старые/альтернативные имена полей', () => {
  assert.equal(
    normalizeNotificationPreferences({ digest_enabled: false }).deliveryMode,
    DELIVERY_MODE_PER_PLANT
  )
  assert.equal(
    normalizeNotificationPreferences({ notification_mode: 'digest' }).deliveryMode,
    DELIVERY_MODE_DIGEST
  )
  assert.equal(
    normalizeNotificationPreferences({ deliveryMode: 'digest' }).deliveryMode,
    DELIVERY_MODE_DIGEST
  )
  assert.equal(
    normalizeNotificationPreferences({ quietHoursEnabled: true, quietHoursStart: '21:00' })
      .quietHours.start,
    '21:00'
  )
})

test('normalizeNotificationPreferences устойчив к пустому ответу и fallback', () => {
  const fallback = {
    deliveryMode: DELIVERY_MODE_PER_PLANT,
    quietHours: { enabled: true, start: '21:00', end: '09:00', timezone: 'Europe/Moscow' }
  }
  const result = normalizeNotificationPreferences(null, fallback)
  assert.equal(result.deliveryMode, DELIVERY_MODE_PER_PLANT)
  assert.equal(result.quietHours.start, '21:00')
  assert.deepEqual(result.serverSupports, { deliveryMode: false, quietHours: false })

  const garbage = normalizeNotificationPreferences({ delivery_mode: 'weekly' })
  assert.equal(garbage.deliveryMode, DELIVERY_MODE_DIGEST)
})

test('validateQuietHours проверяет формат, совпадение и выключенный тумблер', () => {
  assert.equal(validateQuietHours({ enabled: false, start: 'bad', end: 'bad' }), '')
  assert.match(
    validateQuietHours({ enabled: true, start: '22:00', end: '' }),
    /формате/
  )
  assert.match(
    validateQuietHours({ enabled: true, start: '22:00', end: '22:00' }),
    /не должны совпадать/
  )
  assert.equal(validateQuietHours({ enabled: true, start: '22:00', end: '08:00' }), '')
})

test('локальные предпочтения: дефолт — дайджест, запись и чтение', () => {
  withLocalStorage(() => {
    const initial = readLocalNotificationPreferences()
    assert.equal(initial.deliveryMode, DELIVERY_MODE_DIGEST)
    assert.equal(initial.quietHours.enabled, false)
    assert.equal(initial.quietHours.start, DEFAULT_NOTIFICATION_PREFERENCES.quietHours.start)

    const saved = writeLocalNotificationPreferences({
      deliveryMode: DELIVERY_MODE_PER_PLANT,
      quietHours: { enabled: true, start: '23:00', end: '07:00', timezone: 'Europe/Moscow' }
    })
    assert.equal(saved, true)

    const restored = readLocalNotificationPreferences()
    assert.equal(restored.deliveryMode, DELIVERY_MODE_PER_PLANT)
    assert.equal(restored.quietHours.enabled, true)
    assert.equal(restored.quietHours.start, '23:00')
    assert.equal(restored.quietHours.end, '07:00')
  })
})

test('локальные предпочтения: без localStorage не падают', () => {
  assert.equal(readLocalNotificationPreferences().deliveryMode, DELIVERY_MODE_DIGEST)
  assert.equal(writeLocalNotificationPreferences({ deliveryMode: DELIVERY_MODE_PER_PLANT }), false)
})

test('saveNotificationPreferences: 400 — ошибка, локально НЕ сохраняем (FE-07/INT-05)', async () => {
  await withLocalStorageAsync(async (localStorage, store) => {
    await withFetchResponse(
      () => jsonResponse(400, { message: 'Начало и конец тихих часов не должны совпадать' }),
      async () => {
        const result = await saveNotificationPreferences({
          quietHours: { enabled: true, start: '22:00', end: '08:00' }
        })
        assert.equal(result.ok, false)
        assert.equal(result.localOnly, false)
        assert.equal(result.unavailable, false)
        assert.equal(result.status, 400)
        assert.match(result.error.message, /не должны совпадать/)
        assert.equal(store.size, 0)
      }
    )
  })
})

test('saveNotificationPreferences: 404 — localOnly-черновик с пометкой', async () => {
  await withLocalStorageAsync(async (localStorage, store) => {
    await withFetchResponse(
      () => jsonResponse(404, { message: 'Маршрут не найден' }),
      async () => {
        const result = await saveNotificationPreferences({
          deliveryMode: DELIVERY_MODE_PER_PLANT
        })
        assert.equal(result.ok, false)
        assert.equal(result.localOnly, true)
        assert.equal(result.unavailable, true)
        assert.ok(store.size > 0)
        assert.equal(
          readLocalNotificationPreferences().deliveryMode,
          DELIVERY_MODE_PER_PLANT
        )
      }
    )
  })
})

test('saveNotificationPreferences: 200 с эхом полей — серверное подтверждение', async () => {
  await withLocalStorageAsync(async () => {
    await withFetchResponse(
      () => jsonResponse(200, { delivery_mode: 'per_plant' }),
      async () => {
        const result = await saveNotificationPreferences({
          deliveryMode: DELIVERY_MODE_PER_PLANT
        })
        assert.equal(result.ok, true)
        assert.equal(result.localOnly, false)
        assert.equal(result.preferences.deliveryMode, DELIVERY_MODE_PER_PLANT)
      }
    )
  })
})

test('loadNotificationPreferences: 500 — ошибка без localOnly; 404 — localOnly', async () => {
  await withLocalStorageAsync(async () => {
    await withFetchResponse(
      () => jsonResponse(500, { message: 'Ошибка сервера' }),
      async () => {
        const result = await loadNotificationPreferences()
        assert.equal(result.ok, false)
        assert.equal(result.unavailable, false)
        assert.equal(result.localOnly, false)
      }
    )

    await withFetchResponse(
      () => jsonResponse(404, { message: 'Маршрут не найден' }),
      async () => {
        const result = await loadNotificationPreferences()
        assert.equal(result.ok, false)
        assert.equal(result.unavailable, true)
        assert.equal(result.localOnly, true)
      }
    )
  })
})
