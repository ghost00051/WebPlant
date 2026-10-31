import { fetchWithTimeout } from './fetchWithTimeout.js'

const DEFAULT_API_URL = 'https://server.checktheplants.ru/api'
const REQUEST_TIMEOUT_MS = 15000
const DB_VERSION = 1

export const WATERING_QUEUE_DB_NAME = 'webplant-offline'
export const WATERING_QUEUE_STORE_NAME = 'watering-queue'
export const WATERING_QUEUE_SYNC_TAG = 'watering-queue'
export const WATERING_QUEUE_CHANGED_MESSAGE = 'watering-queue-changed'
export const WATERING_QUEUE_MAX_ATTEMPTS = 5
export const WATERING_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const CLEAR_API_CACHE_MESSAGE = 'CLEAR_API_CACHE'

const SCHEDULED_FOR_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const SCHEDULED_FOR_WITH_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i
const PLANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const MIN_PLANT_YEAR = 2000
const MAX_PLANT_YEAR = 2100

let apiBaseCache = null
let databasePromise = null
let autoSyncInstalled = false
let flushPromise = null
let queueMutation = Promise.resolve()
const pendingListeners = new Set()

export function resolveApiBase () {
    if (apiBaseCache) return apiBaseCache

    let base = DEFAULT_API_URL

    try {
        if (import.meta.env.VITE_API_URL) {
            base = import.meta.env.VITE_API_URL
        } else if (import.meta.env.DEV) {
            base = '/api'
        }
    } catch {
        base = DEFAULT_API_URL
    }

    apiBaseCache = String(base).trim().replace(/\/+$/, '')
    return apiBaseCache
}

export function normalizePlantId (value) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value <= 0) return null
        return String(value)
    }

    if (typeof value !== 'string') return null

    const trimmed = value.trim()
    if (!PLANT_ID_PATTERN.test(trimmed)) return null
    return trimmed
}

export function normalizeScheduledFor (value) {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string') return null

    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 64) return null

    const dateOnly = SCHEDULED_FOR_DATE_ONLY.exec(trimmed)
    if (dateOnly) {
        const year = Number(dateOnly[1])
        const month = Number(dateOnly[2])
        const day = Number(dateOnly[3])
        if (year < MIN_PLANT_YEAR || year > MAX_PLANT_YEAR) return null

        const utc = new Date(Date.UTC(year, month - 1, day))
        if (
            utc.getUTCFullYear() !== year ||
            utc.getUTCMonth() !== month - 1 ||
            utc.getUTCDate() !== day
        ) {
            return null
        }

        return trimmed
    }

    if (!SCHEDULED_FOR_WITH_TIMEZONE.test(trimmed)) return null

    const parsed = new Date(trimmed)
    if (!Number.isFinite(parsed.getTime())) return null
    const year = parsed.getUTCFullYear()
    if (year < MIN_PLANT_YEAR || year > MAX_PLANT_YEAR) return null

    return trimmed
}

export function buildWateringRequestBody (scheduledFor = null) {
    const normalized = normalizeScheduledFor(scheduledFor)
    if (!normalized) return {}
    return { scheduled_for: normalized }
}

export function wateringQueueDedupeKey (plantId, scheduledFor = null) {
    const normalizedPlantId = normalizePlantId(plantId)
    const normalizedScheduledFor = normalizeScheduledFor(scheduledFor)
    return `${normalizedPlantId ?? ''}::${normalizedScheduledFor ?? ''}`
}

export function isDuplicateWateringEntry (entries, plantId, scheduledFor = null) {
    if (!Array.isArray(entries) || !entries.length) return false

    const key = wateringQueueDedupeKey(plantId, scheduledFor)
    if (key === '::') return false

    return entries.some(entry =>
        wateringQueueDedupeKey(entry?.plantId, entry?.scheduledFor ?? null) === key
    )
}

export function normalizeQueueEntry (input, now = Date.now()) {
    if (!input || typeof input !== 'object') return null

    const plantId = normalizePlantId(input.plantId)
    if (!plantId) return null

    const rawScheduledFor = input.scheduledFor
    const scheduledFor = normalizeScheduledFor(rawScheduledFor)
    const hasScheduledFor = rawScheduledFor !== null &&
        rawScheduledFor !== undefined &&
        rawScheduledFor !== ''
    if (hasScheduledFor && scheduledFor === null) return null

    const createdAt = Number(input.createdAt)
    const attempts = Number(input.attempts)

    return {
        plantId,
        scheduledFor,
        onTime: typeof input.onTime === 'boolean' ? input.onTime : null,
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
        attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : 0
    }
}

export function isQueueEntryStale (entry, now = Date.now(), ttlMs = WATERING_QUEUE_TTL_MS) {
    const createdAt = Number(entry?.createdAt)
    if (!Number.isFinite(createdAt) || createdAt <= 0) return false
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false
    return now - createdAt > ttlMs
}

export function nextWateringAttempts (entry) {
    const attempts = Number(entry?.attempts)
    if (!Number.isInteger(attempts) || attempts < 0) return 1
    return attempts + 1
}

export function canRetryWateringEntry (
    entry,
    maxAttempts = WATERING_QUEUE_MAX_ATTEMPTS
) {
    const attempts = Number(entry?.attempts)
    const normalizedAttempts = Number.isInteger(attempts) && attempts >= 0 ? attempts : 0
    return normalizedAttempts < maxAttempts
}

export function classifyWateringResponse (status) {
    if (!Number.isInteger(status) || status < 100 || status > 599) return 'unknown'
    if (status >= 200 && status < 300) return 'success'
    if (status === 409) return 'conflict'
    if (status === 401) return 'auth'
    if (status >= 400 && status < 500) return 'client-error'
    if (status >= 500) return 'server-error'
    return 'unknown'
}

export function resolveWateringQueueAction (classification) {
    if (classification === 'success' || classification === 'conflict') return 'remove'
    if (classification === 'client-error') return 'drop'
    return 'retry'
}

export function parseJsonBody (text) {
    if (typeof text !== 'string' || !text.trim()) return {}

    try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return parsed
    } catch {
        return {}
    }
}

function getIndexedDb () {
    if (typeof indexedDB === 'undefined') return null
    return indexedDB
}

function openDatabase () {
    const idb = getIndexedDb()
    if (!idb) return Promise.resolve(null)
    if (databasePromise) return databasePromise

    databasePromise = new Promise(resolve => {
        let request
        try {
            request = idb.open(WATERING_QUEUE_DB_NAME, DB_VERSION)
        } catch (error) {
            console.warn('Не удалось открыть офлайн-хранилище отметок полива:', error)
            resolve(null)
            return
        }

        request.onupgradeneeded = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(WATERING_QUEUE_STORE_NAME)) {
                database.createObjectStore(WATERING_QUEUE_STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                })
            }
        }
        request.onsuccess = () => {
            const database = request.result
            database.onversionchange = () => database.close()
            resolve(database)
        }
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
    }).then(database => {
        if (!database) databasePromise = null
        return database
    })

    return databasePromise
}

function withQueueStore (mode, run) {
    return openDatabase().then(database => {
        if (!database) return null

        return new Promise(resolve => {
            let transaction
            try {
                transaction = database.transaction(WATERING_QUEUE_STORE_NAME, mode)
            } catch (error) {
                console.warn('Не удалось открыть транзакцию офлайн-очереди:', error)
                resolve(null)
                return
            }

            let settled = false
            const finish = value => {
                if (settled) return
                settled = true
                try {
                    resolve(value)
                } catch (error) {
                    console.warn('Ошибка завершения транзакции офлайн-очереди:', error)
                }
            }

            transaction.onabort = () => finish(null)
            transaction.onerror = () => finish(null)

            try {
                run(transaction.objectStore(WATERING_QUEUE_STORE_NAME), finish)
            } catch (error) {
                console.warn('Ошибка чтения/записи офлайн-очереди:', error)
                finish(null)
            }
        })
    })
}

async function readQueueEntries () {
    const result = await withQueueStore('readonly', (store, finish) => {
        const request = store.getAll()
        request.onsuccess = () => {
            finish(Array.isArray(request.result) ? request.result : [])
        }
        request.onerror = () => finish([])
    })
    return Array.isArray(result) ? result : []
}

function addQueueEntry (record) {
    return withQueueStore('readwrite', (store, finish) => {
        const request = store.add(record)
        request.onsuccess = () => finish(request.result)
        request.onerror = () => finish(null)
    })
}

function putQueueEntry (record) {
    return withQueueStore('readwrite', (store, finish) => {
        const request = store.put(record)
        request.onsuccess = () => finish(true)
        request.onerror = () => finish(false)
    })
}

function deleteQueueEntry (id) {
    return withQueueStore('readwrite', (store, finish) => {
        const request = store.delete(id)
        request.onsuccess = () => finish(true)
        request.onerror = () => finish(false)
    })
}

function runQueueMutation (task) {
    const run = queueMutation.then(task, task)
    queueMutation = run.then(() => {}, () => {})
    return run
}

async function enqueueWatering ({ plantId, scheduledFor, onTime, now = Date.now() }) {
    return runQueueMutation(async () => {
        const entry = normalizeQueueEntry(
            { plantId, scheduledFor, onTime, createdAt: now, attempts: 0 },
            now
        )
        if (!entry) return { ok: false, queued: false, duplicate: false }

        const entries = await readQueueEntries()
        if (isDuplicateWateringEntry(entries, entry.plantId, entry.scheduledFor)) {
            return { ok: true, queued: true, duplicate: true }
        }

        const id = await addQueueEntry({ ...entry })
        if (id === null || id === undefined) {
            return { ok: false, queued: false, duplicate: false }
        }

        emitPendingChange()
        return { ok: true, queued: true, duplicate: false }
    })
}

function safeNotify (listener, count) {
    try {
        listener(count)
    } catch (error) {
        console.warn('Ошибка подписчика офлайн-очереди полива:', error)
    }
}

function emitPendingChange () {
    if (!pendingListeners.size) return

    getPendingWateringCount()
        .then(count => {
            for (const listener of pendingListeners) safeNotify(listener, count)
        })
        .catch(error => {
            console.warn('Не удалось посчитать офлайн-очередь полива:', error)
        })
}

export function subscribeToPendingWatering (listener) {
    if (typeof listener !== 'function') return () => {}

    pendingListeners.add(listener)

    getPendingWateringCount()
        .then(count => {
            if (pendingListeners.has(listener)) safeNotify(listener, count)
        })
        .catch(() => {})

    return () => {
        pendingListeners.delete(listener)
    }
}

export async function getPendingWateringCount () {
    const entries = await readQueueEntries()
    const now = Date.now()
    return entries.filter(entry => !isQueueEntryStale(entry, now)).length
}

export function canClearOfflineApiCache (navigatorLike) {
    if (!navigatorLike || typeof navigatorLike !== 'object') return false

    const serviceWorker = navigatorLike.serviceWorker
    if (!serviceWorker || typeof serviceWorker !== 'object') return false

    const controller = serviceWorker.controller
    if (!controller || typeof controller.postMessage !== 'function') return false

    return true
}

export async function clearOfflineApiCache (
    navigatorLike = typeof navigator !== 'undefined' ? navigator : null
) {
    if (!canClearOfflineApiCache(navigatorLike)) return false

    try {
        navigatorLike.serviceWorker.controller.postMessage({
            type: CLEAR_API_CACHE_MESSAGE
        })
        return true
    } catch (error) {
        console.warn('Не удалось очистить офлайн-кэш API:', error)
        return false
    }
}

function isNetworkOffline () {
    return typeof navigator !== 'undefined' && navigator.onLine === false
}

async function readResponseData (response) {
    try {
        return parseJsonBody(await response.text())
    } catch {
        return {}
    }
}

function wateringRequestUrl (plantId) {
    return `${resolveApiBase()}/plants/${encodeURIComponent(plantId)}/water`
}

function postWatering (plantId, scheduledFor) {
    return fetchWithTimeout(
        wateringRequestUrl(plantId),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(buildWateringRequestBody(scheduledFor))
        },
        REQUEST_TIMEOUT_MS
    )
}

function queuedResponse (queued) {
    if (queued.ok) {
        return { ok: true, queued: true, status: null, data: {} }
    }
    return {
        ok: false,
        queued: false,
        status: null,
        data: { message: 'Не удалось сохранить отметку офлайн. Попробуйте ещё раз.' }
    }
}

async function markInQueue (plantId, scheduledFor, onTime) {
    const queued = await enqueueWatering({ plantId, scheduledFor, onTime })
    if (queued.ok) requestBackgroundSync()
    return queuedResponse(queued)
}

export async function markWateredWithQueue (plantId, options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {}
    const normalizedPlantId = normalizePlantId(plantId)

    if (!normalizedPlantId) {
        return {
            ok: false,
            queued: false,
            status: null,
            data: { message: 'Некорректный идентификатор растения' }
        }
    }

    const rawScheduledFor = safeOptions.scheduledFor ?? null
    const scheduledFor = normalizeScheduledFor(rawScheduledFor)
    const hasScheduledFor = rawScheduledFor !== null &&
        rawScheduledFor !== undefined &&
        rawScheduledFor !== ''
    if (hasScheduledFor && scheduledFor === null) {
        return {
            ok: false,
            queued: false,
            status: null,
            data: { message: 'Некорректная дата полива' }
        }
    }

    const onTime = typeof safeOptions.onTime === 'boolean' ? safeOptions.onTime : null

    if (isNetworkOffline()) {
        return markInQueue(normalizedPlantId, scheduledFor, onTime)
    }

    try {
        const response = await postWatering(normalizedPlantId, scheduledFor)
        const data = await readResponseData(response)

        if (classifyWateringResponse(response.status) === 'success') {
            return { ok: true, queued: false, status: response.status, data }
        }

        return { ok: false, queued: false, status: response.status, data }
    } catch (error) {
        console.warn(
            'Отметка полива не ушла на сервер, сохраняем в офлайн-очередь:',
            error
        )
        return markInQueue(normalizedPlantId, scheduledFor, onTime)
    }
}

async function sendQueuedEntry (entry) {
    const plantId = normalizePlantId(entry?.plantId)
    if (!plantId) return { action: 'drop' }

    const scheduledFor = normalizeScheduledFor(entry?.scheduledFor)
    let response

    try {
        response = await postWatering(plantId, scheduledFor)
    } catch {
        return { action: 'retry', error: 'network' }
    }

    const classification = classifyWateringResponse(response.status)
    const action = resolveWateringQueueAction(classification)
    return { action, classification, status: response.status }
}

async function runFlush () {
    const database = await openDatabase()
    if (!database) return { sent: 0, failed: 0, remaining: 0 }

    if (isNetworkOffline()) {
        const remaining = await getPendingWateringCount()
        return { sent: 0, failed: 0, remaining }
    }

    const entries = await readQueueEntries()
    const now = Date.now()
    let sent = 0
    let failed = 0

    for (const entry of entries) {
        if (isQueueEntryStale(entry, now)) {
            await deleteQueueEntry(entry.id)
            failed += 1
            continue
        }

        const result = await sendQueuedEntry(entry)

        if (result.action === 'remove') {
            await deleteQueueEntry(entry.id)
            sent += 1
            continue
        }

        if (result.action === 'drop') {
            console.error(
                'Отметка полива отклонена сервером и удалена из очереди:',
                { plantId: entry.plantId, status: result.status ?? null }
            )
            await deleteQueueEntry(entry.id)
            failed += 1
            continue
        }

        const attempts = nextWateringAttempts(entry)
        if (!canRetryWateringEntry({ attempts })) {
            console.error(
                'Отметка полива не отправлена после лимита попыток и удалена из очереди:',
                { plantId: entry.plantId, attempts }
            )
            await deleteQueueEntry(entry.id)
            failed += 1
            continue
        }

        await putQueueEntry({
            ...entry,
            attempts,
            lastAttemptAt: Date.now()
        })
        failed += 1
    }

    emitPendingChange()
    const remaining = await getPendingWateringCount()
    return { sent, failed, remaining }
}

export function flushWateringQueue () {
    if (flushPromise) return flushPromise

    flushPromise = runFlush()
        .catch(error => {
            console.warn('Не удалось отправить офлайн-очередь полива:', error)
            return { sent: 0, failed: 0, remaining: 0 }
        })
        .then(result => {
            flushPromise = null
            return result
        })

    return flushPromise
}

function getServiceWorkerRegistration () {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
        return Promise.resolve(null)
    }
    try {
        if (typeof navigator.serviceWorker.getRegistration !== 'function') {
            return Promise.resolve(null)
        }
        return navigator.serviceWorker.getRegistration()
            .then(registration => registration || null)
            .catch(() => null)
    } catch {
        return Promise.resolve(null)
    }
}

function registerSyncOnRegistration (registration) {
    if (!registration || !registration.sync ||
        typeof registration.sync.register !== 'function') {
        return Promise.resolve(false)
    }

    try {
        return Promise.resolve(registration.sync.register(WATERING_QUEUE_SYNC_TAG))
            .then(() => true)
            .catch(error => {
                console.warn('Не удалось зарегистрировать Background Sync:', error)
                return false
            })
    } catch (error) {
        console.warn('Background Sync недоступен:', error)
        return Promise.resolve(false)
    }
}

function requestBackgroundSync () {
    return getServiceWorkerRegistration()
        .then(registerSyncOnRegistration)
        .catch(() => false)
}

function registerBackgroundSyncWhenReady () {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker ||
        !navigator.serviceWorker.ready) {
        return
    }

    Promise.resolve(navigator.serviceWorker.ready)
        .then(registerSyncOnRegistration)
        .catch(error => {
            console.warn('Service worker не готов для Background Sync:', error)
        })
}

function scheduleInitialSync () {
    const run = () => {
        void flushWateringQueue()
        registerBackgroundSyncWhenReady()
    }

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 3000 })
    } else {
        window.setTimeout(run, 0)
    }
}

function setupAutoSync () {
    if (typeof window === 'undefined' || autoSyncInstalled) return
    autoSyncInstalled = true

    window.addEventListener('online', () => {
        void flushWateringQueue()
        void requestBackgroundSync()
    })

    window.addEventListener('offline', () => {
        emitPendingChange()
    })

    if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
        typeof navigator.serviceWorker.addEventListener === 'function') {
        navigator.serviceWorker.addEventListener('message', event => {
            const data = event && event.data
            if (data && data.type === WATERING_QUEUE_CHANGED_MESSAGE) {
                emitPendingChange()
            }
        })
    }

    scheduleInitialSync()
}

if (typeof window !== 'undefined') {
    setupAutoSync()
}
