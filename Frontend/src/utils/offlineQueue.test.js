import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWateringRequestBody,
  canClearOfflineApiCache,
  canRetryWateringEntry,
  classifyWateringResponse,
  clearOfflineApiCache,
  CLEAR_API_CACHE_MESSAGE,
  isDuplicateWateringEntry,
  isQueueEntryStale,
  nextWateringAttempts,
  normalizePlantId,
  normalizeQueueEntry,
  normalizeScheduledFor,
  parseJsonBody,
  resolveApiBase,
  resolveWateringQueueAction,
  wateringQueueDedupeKey,
  WATERING_QUEUE_MAX_ATTEMPTS,
  WATERING_QUEUE_TTL_MS
} from './offlineQueue.js'

test('normalizePlantId: принимает число и строковый id', () => {
  assert.equal(normalizePlantId(42), '42')
  assert.equal(normalizePlantId('42'), '42')
  assert.equal(normalizePlantId(' 42 '), '42')
  assert.equal(normalizePlantId('plant_1-a'), 'plant_1-a')
})

test('normalizePlantId: отбрасывает пустые и небезопасные значения', () => {
  assert.equal(normalizePlantId(null), null)
  assert.equal(normalizePlantId(undefined), null)
  assert.equal(normalizePlantId(''), null)
  assert.equal(normalizePlantId('   '), null)
  assert.equal(normalizePlantId(0), null)
  assert.equal(normalizePlantId(-5), null)
  assert.equal(normalizePlantId(3.5), null)
  assert.equal(normalizePlantId('a b'), null)
  assert.equal(normalizePlantId('a/b'), null)
  assert.equal(normalizePlantId({}), null)
  assert.equal(normalizePlantId('x'.repeat(65)), null)
})

test('normalizeScheduledFor: сохраняет дату-день и ISO-дату с таймзоной', () => {
  assert.equal(normalizeScheduledFor(null), null)
  assert.equal(normalizeScheduledFor(undefined), null)
  assert.equal(normalizeScheduledFor(''), null)
  assert.equal(normalizeScheduledFor('2026-10-19'), '2026-10-19')
  assert.equal(
    normalizeScheduledFor('2026-10-19T08:00:00Z'),
    '2026-10-19T08:00:00Z'
  )
  assert.equal(
    normalizeScheduledFor('2026-10-19T11:00:00+03:00'),
    '2026-10-19T11:00:00+03:00'
  )
})

test('normalizeScheduledFor: отбрасывает несуществующие и «голые» даты', () => {
  assert.equal(normalizeScheduledFor('2026-02-30'), null)
  assert.equal(normalizeScheduledFor('2026-13-01'), null)
  assert.equal(normalizeScheduledFor('19.10.2026'), null)
  assert.equal(normalizeScheduledFor('2026-10-19T08:00:00'), null)
  assert.equal(normalizeScheduledFor(1750000000000), null)
  assert.equal(normalizeScheduledFor('x'.repeat(65)), null)
})

test('buildWateringRequestBody: пустое тело без слота и scheduled_for со слотом', () => {
  assert.deepEqual(buildWateringRequestBody(null), {})
  assert.deepEqual(buildWateringRequestBody(undefined), {})
  assert.deepEqual(buildWateringRequestBody('не дата'), {})
  assert.deepEqual(
    buildWateringRequestBody('2026-10-19'),
    { scheduled_for: '2026-10-19' }
  )
})

test('wateringQueueDedupeKey: ключ учитывает растение и слот', () => {
  assert.equal(
    wateringQueueDedupeKey(1, null),
    wateringQueueDedupeKey('1', undefined)
  )
  assert.notEqual(
    wateringQueueDedupeKey(1, null),
    wateringQueueDedupeKey(1, '2026-10-19')
  )
  assert.notEqual(
    wateringQueueDedupeKey(1, '2026-10-19'),
    wateringQueueDedupeKey(2, '2026-10-19')
  )
})

test('isDuplicateWateringEntry: находит дубль по растению и слоту', () => {
  const entries = [
    { plantId: '1', scheduledFor: null },
    { plantId: 2, scheduledFor: '2026-10-19' }
  ]

  assert.equal(isDuplicateWateringEntry(entries, '1', null), true)
  assert.equal(isDuplicateWateringEntry(entries, 2, '2026-10-19'), true)
  assert.equal(isDuplicateWateringEntry(entries, 1, '2026-10-19'), false)
  assert.equal(isDuplicateWateringEntry(entries, 3, null), false)
  assert.equal(isDuplicateWateringEntry([], 1, null), false)
  assert.equal(isDuplicateWateringEntry(null, 1, null), false)
})

test('normalizeQueueEntry: заполняет запись очередью и значения по умолчанию', () => {
  const now = 1_760_000_000_000
  assert.deepEqual(
    normalizeQueueEntry({ plantId: '7', scheduledFor: '2026-10-19', onTime: false }, now),
    {
      plantId: '7',
      scheduledFor: '2026-10-19',
      onTime: false,
      createdAt: now,
      attempts: 0
    }
  )

  assert.deepEqual(
    normalizeQueueEntry({ plantId: 7, onTime: 'yes', createdAt: 123, attempts: 3 }, now),
    {
      plantId: '7',
      scheduledFor: null,
      onTime: null,
      createdAt: 123,
      attempts: 3
    }
  )
})

test('normalizeQueueEntry: некорректные входы дают null', () => {
  const now = 1_760_000_000_000
  assert.equal(normalizeQueueEntry(null, now), null)
  assert.equal(normalizeQueueEntry({ plantId: '', scheduledFor: null }, now), null)
  assert.equal(
    normalizeQueueEntry({ plantId: 1, scheduledFor: '2026-02-30' }, now),
    null
  )
})

test('isQueueEntryStale: запись живёт WATERING_QUEUE_TTL_MS', () => {
  const now = 1_760_000_000_000

  assert.equal(
    isQueueEntryStale({ createdAt: now - WATERING_QUEUE_TTL_MS - 1 }, now),
    true
  )
  assert.equal(
    isQueueEntryStale({ createdAt: now - WATERING_QUEUE_TTL_MS + 1000 }, now),
    false
  )
  assert.equal(isQueueEntryStale({ createdAt: now }, now), false)
  assert.equal(isQueueEntryStale({}, now), false)
  assert.equal(isQueueEntryStale(null, now), false)
})

test('attempts: лимит попыток и инкремент', () => {
  assert.equal(WATERING_QUEUE_MAX_ATTEMPTS, 5)
  assert.equal(canRetryWateringEntry({ attempts: 0 }), true)
  assert.equal(canRetryWateringEntry({ attempts: 4 }), true)
  assert.equal(canRetryWateringEntry({ attempts: 5 }), false)

  assert.equal(nextWateringAttempts({ attempts: 0 }), 1)
  assert.equal(nextWateringAttempts({ attempts: 4 }), 5)
  assert.equal(nextWateringAttempts({ attempts: undefined }), 1)
})

test('classifyWateringResponse: 2xx успех, 409 конфликт, остальное — ошибки', () => {
  assert.equal(classifyWateringResponse(200), 'success')
  assert.equal(classifyWateringResponse(201), 'success')
  assert.equal(classifyWateringResponse(204), 'success')
  assert.equal(classifyWateringResponse(409), 'conflict')
  assert.equal(classifyWateringResponse(401), 'auth')
  assert.equal(classifyWateringResponse(400), 'client-error')
  assert.equal(classifyWateringResponse(404), 'client-error')
  assert.equal(classifyWateringResponse(422), 'client-error')
  assert.equal(classifyWateringResponse(500), 'server-error')
  assert.equal(classifyWateringResponse(503), 'server-error')
  assert.equal(classifyWateringResponse(302), 'unknown')
  assert.equal(classifyWateringResponse(null), 'unknown')
})

test('resolveWateringQueueAction: успех убирает, 4xx отбрасывает, остальное retry', () => {
  assert.equal(resolveWateringQueueAction('success'), 'remove')
  assert.equal(resolveWateringQueueAction('conflict'), 'remove')
  assert.equal(resolveWateringQueueAction('client-error'), 'drop')
  assert.equal(resolveWateringQueueAction('auth'), 'retry')
  assert.equal(resolveWateringQueueAction('server-error'), 'retry')
  assert.equal(resolveWateringQueueAction('unknown'), 'retry')
})

test('parseJsonBody: безопасный разбор тела ответа', () => {
  assert.deepEqual(parseJsonBody(''), {})
  assert.deepEqual(parseJsonBody('   '), {})
  assert.deepEqual(parseJsonBody('не json'), {})
  assert.deepEqual(parseJsonBody('null'), {})
  assert.deepEqual(parseJsonBody('[1,2,3]'), {})
  assert.deepEqual(parseJsonBody('{"message":"Уже полит"}'), {
    message: 'Уже полит'
  })
  assert.deepEqual(parseJsonBody('{"converted_skip":true}'), {
    converted_skip: true
  })
  assert.deepEqual(parseJsonBody(null), {})
})

test('resolveApiBase: в Node без Vite возвращает абсолютный адрес API', () => {
  const base = resolveApiBase()
  assert.equal(typeof base, 'string')
  assert.equal(base.endsWith('/'), false)
  assert.match(base, /\/api$/)
})

test('CLEAR_API_CACHE_MESSAGE: совпадает с обработчиком Service Worker', () => {
  assert.equal(CLEAR_API_CACHE_MESSAGE, 'CLEAR_API_CACHE')
})

test('canClearOfflineApiCache: требуется активный контроллер Service Worker', () => {
  assert.equal(canClearOfflineApiCache(null), false)
  assert.equal(canClearOfflineApiCache(undefined), false)
  assert.equal(canClearOfflineApiCache({}), false)
  assert.equal(canClearOfflineApiCache({ serviceWorker: {} }), false)
  assert.equal(
    canClearOfflineApiCache({ serviceWorker: { controller: {} } }),
    false
  )
  assert.equal(
    canClearOfflineApiCache(
      { serviceWorker: { controller: { postMessage () {} } } }
    ),
    true
  )
})

test('clearOfflineApiCache: no-op без Service Worker и postMessage при контроллере', async () => {
  assert.equal(await clearOfflineApiCache(), false)
  assert.equal(await clearOfflineApiCache(null), false)
  assert.equal(
    await clearOfflineApiCache({ serviceWorker: { controller: null } }),
    false
  )

  const posted = []
  const result = await clearOfflineApiCache({
    serviceWorker: {
      controller: {
        postMessage (message) {
          posted.push(message)
        }
      }
    }
  })

  assert.equal(result, true)
  assert.deepEqual(posted, [{ type: 'CLEAR_API_CACHE' }])
})

test('clearOfflineApiCache: ошибка postMessage не пробрасывается наружу', async () => {
  const result = await clearOfflineApiCache({
    serviceWorker: {
      controller: {
        postMessage () {
          throw new Error('SW недоступен')
        }
      }
    }
  })

  assert.equal(result, false)
})
