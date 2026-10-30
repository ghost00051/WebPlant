const CACHE_VERSION = 'v12'
const CACHE_NAME = `ctp-${CACHE_VERSION}`
const DEFAULT_API_BASE = '/api'
const VALID_API_PROTOCOLS = ['http:', 'https:']

const API_CACHE_NAME = 'ctp-api-v1'
const API_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const API_CACHE_TIMESTAMP_HEADER = 'X-Offline-Cached-At'
const OFFLINE_CACHE_MARKER_HEADER = 'X-Offline-Cache'
const API_CACHEABLE_PATHS = new Set([
    '/plants',
    '/plants/need-watering',
    '/plants/schedule',
    '/plants/timeline',
    '/notifications/unread-count'
])

const WATERING_QUEUE_DB_NAME = 'webplant-offline'
const WATERING_QUEUE_DB_VERSION = 1
const WATERING_QUEUE_STORE_NAME = 'watering-queue'
const WATERING_QUEUE_SYNC_TAG = 'watering-queue'
const WATERING_QUEUE_CHANGED_MESSAGE = 'watering-queue-changed'
const WATERING_QUEUE_MAX_ATTEMPTS = 5

const PRESERVED_CACHE_NAMES = new Set([API_CACHE_NAME])

const GARDEN_PATH_PATTERN = /^\/garden\/[A-Za-z0-9_-]{16,64}\/?$/

const PRECACHE_URLS = [
    '/',
    '/home',
    '/plants',
    '/care',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png',
    '/404.html'
]

const DEFAULT_PUSH = {
    title: 'Лейка',
    body: 'Новое уведомление',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {}
}

function resolveApiBase() {
    try {
        const raw = new URL(self.location.href).searchParams.get('api')
        if (!raw) return DEFAULT_API_BASE
        const parsed = new URL(raw, self.location.origin)
        if (!VALID_API_PROTOCOLS.includes(parsed.protocol)) return DEFAULT_API_BASE
        return parsed.href.replace(/\/+$/, '')
    } catch {
        return DEFAULT_API_BASE
    }
}

const API_BASE = resolveApiBase()

self.addEventListener('install', (event) => {
    console.log('🔧 SW: install', { apiBase: API_BASE, cache: CACHE_NAME })
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(
                PRECACHE_URLS.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`⚠️ Не удалось закешировать ${url}:`, err)
                    )
                )
            )
        )
    )
})

self.addEventListener('message', (event) => {
    const data = event.data || {}

    if (data.type === 'SKIP_WAITING') {
        console.log('🔧 SW: SKIP_WAITING — активируем новую версию', { cache: CACHE_NAME })
        self.skipWaiting()
        return
    }

    if (data.type === 'GET_VERSION' && event.source) {
        try {
            event.source.postMessage({
                type: 'SW_VERSION',
                version: CACHE_VERSION,
                cacheName: CACHE_NAME
            })
        } catch (error) {
            console.warn('⚠️ SW: не удалось отправить версию клиенту:', error)
        }
    }

    if (data.type === 'CLEAR_API_CACHE') {
        event.waitUntil((async () => {
            await clearApiCache()

            if (!event.source) return
            try {
                event.source.postMessage({ type: 'API_CACHE_CLEARED' })
            } catch (error) {
                console.warn('⚠️ SW: не удалось подтвердить очистку кэша API:', error)
            }
        })())
    }
})

self.addEventListener('activate', (event) => {
    console.log('🔧 SW: activate', { cache: CACHE_NAME })
    event.waitUntil((async () => {
        try {
            const cacheNames = await caches.keys()
            await Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME && !PRESERVED_CACHE_NAMES.has(name))
                    .map((name) => caches.delete(name))
            )
        } catch (error) {
            console.warn('⚠️ SW: не удалось удалить старые кэши:', error)
        }

        try {
            await self.clients.claim()
        } catch (error) {
            console.warn('⚠️ SW: clients.claim failed:', error)
        }

        await notifyClients({
            type: 'SW_UPDATED',
            version: CACHE_VERSION,
            cacheName: CACHE_NAME
        })
    })())
})

function isCacheableAsset(request) {
    if (request.method !== 'GET') return false

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return false
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return false
    if (url.pathname.startsWith('/assets/')) return true

    return request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'font' ||
        request.destination === 'image'
}

async function putInCache(request, response) {
    if (!response || !response.ok) return
    try {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
    } catch (error) {
        console.warn('⚠️ SW: не удалось обновить кеш:', error)
    }
}

function staleWhileRevalidate(event, request) {
    const networkPromise = fetch(request)
        .then(async response => {
            await putInCache(request, response)
            return response
        })
        .catch(() => null)

    event.waitUntil(networkPromise)

    return (async () => {
        const cached = await caches.match(request)
        if (cached) return cached

        const response = await networkPromise
        return response || new Response('', { status: 504, statusText: 'Offline' })
    })()
}

async function navigationFallback(request) {
    if (isGardenNavigation(request)) return null

    return (await caches.match(request)) ||
        (await caches.match(request, { ignoreSearch: true })) ||
        (await caches.match('/home')) ||
        (await caches.match('/')) ||
        (await caches.match('/404.html'))
}

function isGardenNavigation(request) {
    if (!request || request.mode !== 'navigate') return false

    try {
        const url = new URL(request.url)
        return url.origin === self.location.origin &&
            GARDEN_PATH_PATTERN.test(url.pathname)
    } catch {
        return false
    }
}

function resolveApiBaseUrl() {
    try {
        return new URL(API_BASE, self.location.origin)
    } catch {
        return null
    }
}

function isCacheableApiRequest(request) {
    if (!request || request.method !== 'GET') return false

    try {
        const requestUrl = new URL(request.url)
        const baseUrl = resolveApiBaseUrl()
        if (!baseUrl) return false
        if (requestUrl.origin !== baseUrl.origin) return false

        const basePath = baseUrl.pathname.replace(/\/+$/, '')
        if (basePath && requestUrl.pathname !== basePath &&
            !requestUrl.pathname.startsWith(`${basePath}/`)) {
            return false
        }

        const apiPath = requestUrl.pathname.slice(basePath.length)
        const normalizedPath = apiPath.length > 1
            ? apiPath.replace(/\/+$/, '')
            : apiPath
        return API_CACHEABLE_PATHS.has(normalizedPath)
    } catch {
        return false
    }
}

function offlineJsonResponse() {
    return new Response(
        JSON.stringify({ message: 'Нет подключения к сети, сохранённых данных пока нет' }),
        {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
    )
}

async function clearApiCache() {
    try {
        await caches.delete(API_CACHE_NAME)
    } catch (error) {
        console.warn('⚠️ SW: не удалось очистить кэш API:', error)
    }
}

async function writeApiCache(request, response) {
    if (!response || !response.ok || response.status !== 200) return
    if (response.type !== 'basic' && response.type !== 'cors') return

    try {
        const cache = await caches.open(API_CACHE_NAME)
        const headers = new Headers(response.headers)
        headers.set(API_CACHE_TIMESTAMP_HEADER, String(Date.now()))
        const body = await response.arrayBuffer()
        await cache.put(
            request,
            new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers
            })
        )
    } catch (error) {
        console.warn('⚠️ SW: не удалось сохранить ответ API в кэш:', error)
    }
}

async function readApiCache(request) {
    try {
        const cache = await caches.open(API_CACHE_NAME)
        const cached = await cache.match(request)
        if (!cached) return null

        const cachedAt = Number(cached.headers.get(API_CACHE_TIMESTAMP_HEADER))
        if (!Number.isFinite(cachedAt) || cachedAt <= 0 ||
            Date.now() - cachedAt > API_CACHE_TTL_MS) {
            await cache.delete(request)
            return null
        }

        const headers = new Headers(cached.headers)
        headers.delete(API_CACHE_TIMESTAMP_HEADER)
        headers.set(OFFLINE_CACHE_MARKER_HEADER, '1')

        const body = await cached.clone().arrayBuffer()
        return new Response(body, {
            status: cached.status,
            statusText: cached.statusText,
            headers
        })
    } catch (error) {
        console.warn('⚠️ SW: не удалось прочитать кэш API:', error)
        return null
    }
}

async function handleCacheableApiRequest(request) {
    let response

    try {
        response = await fetch(request)
    } catch (error) {
        console.log('📴 SW: API недоступен, отдаём кэш:', error)
        return (await readApiCache(request)) || offlineJsonResponse()
    }

    if (response.status === 401) {
        await clearApiCache()
        return response
    }

    if (response.status === 200) {
        const responseForCache = response.clone()
        await writeApiCache(request, responseForCache)
    }

    return response
}

self.addEventListener('fetch', (event) => {
    const req = event.request

    if (req.method !== 'GET') return

    const url = new URL(req.url)

    if (isCacheableApiRequest(req)) {
        event.respondWith(handleCacheableApiRequest(req))
        return
    }

    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/uploads/') ||
        url.origin !== self.location.origin
    ) {
        return
    }

    if (isCacheableAsset(req)) {
        event.respondWith(staleWhileRevalidate(event, req))
        return
    }

    if (isGardenNavigation(req)) {
        event.respondWith((async () => {
            try {
                return await fetch(req)
            } catch {
                return new Response('Нет подключения к сети', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                })
            }
        })())
        return
    }

    event.respondWith((async () => {
        try {
            const response = await fetch(req)
            if (req.mode === 'navigate') {
                await putInCache(req, response)
            }
            return response
        } catch {
            const fallback = await navigationFallback(req)
            if (fallback) return fallback

            if (req.mode === 'navigate') {
                return new Response('Нет подключения к сети', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                })
            }

            return new Response('', { status: 504, statusText: 'Offline' })
        }
    })())
})


function openWateringQueueDatabase() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)

    return new Promise((resolve) => {
        let request
        try {
            request = indexedDB.open(WATERING_QUEUE_DB_NAME, WATERING_QUEUE_DB_VERSION)
        } catch (error) {
            console.warn('⚠️ SW: не удалось открыть офлайн-очередь:', error)
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
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
    })
}

function withWateringQueueStore(database, mode, run) {
    return new Promise((resolve) => {
        let transaction
        try {
            transaction = database.transaction(WATERING_QUEUE_STORE_NAME, mode)
        } catch (error) {
            console.warn('⚠️ SW: транзакция офлайн-очереди недоступна:', error)
            resolve(null)
            return
        }

        let settled = false
        const finish = (value) => {
            if (settled) return
            settled = true
            resolve(value)
        }

        transaction.onabort = () => finish(null)
        transaction.onerror = () => finish(null)

        try {
            run(transaction.objectStore(WATERING_QUEUE_STORE_NAME), finish)
        } catch (error) {
            console.warn('⚠️ SW: ошибка работы с офлайн-очередью:', error)
            finish(null)
        }
    })
}

async function readWateringQueue(database) {
    const result = await withWateringQueueStore(database, 'readonly', (store, finish) => {
        const request = store.getAll()
        request.onsuccess = () => finish(Array.isArray(request.result) ? request.result : [])
        request.onerror = () => finish([])
    })
    return Array.isArray(result) ? result : []
}

function putWateringQueueEntry(database, entry) {
    return withWateringQueueStore(database, 'readwrite', (store, finish) => {
        const request = store.put(entry)
        request.onsuccess = () => finish(true)
        request.onerror = () => finish(false)
    })
}

function deleteWateringQueueEntry(database, id) {
    return withWateringQueueStore(database, 'readwrite', (store, finish) => {
        const request = store.delete(id)
        request.onsuccess = () => finish(true)
        request.onerror = () => finish(false)
    })
}

function resolveQueuedWateringBody(entry) {
    const scheduledFor = typeof entry?.scheduledFor === 'string'
        ? entry.scheduledFor.trim()
        : ''
    if (!scheduledFor) return {}
    return { scheduled_for: scheduledFor }
}

async function sendQueuedWatering(entry) {
    const rawPlantId = entry?.plantId
    const plantId = typeof rawPlantId === 'number'
        ? String(rawPlantId)
        : (typeof rawPlantId === 'string' ? rawPlantId.trim() : '')

    if (!plantId || !/^[A-Za-z0-9_-]{1,64}$/.test(plantId)) return 'drop'

    let response
    try {
        response = await fetch(
            `${API_BASE}/plants/${encodeURIComponent(plantId)}/water`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(resolveQueuedWateringBody(entry))
            }
        )
    } catch (error) {
        console.warn('⚠️ SW: отметка полива не ушла в сеть, попробуем позже:', error)
        return 'retry'
    }

    const status = response.status
    if (status >= 200 && status < 300) return 'sent'
    if (status === 409) return 'sent'
    if (status >= 500 || status === 401) return 'retry'
    if (status >= 400 && status < 500) return 'drop'
    return 'retry'
}

async function processWateringQueue() {
    const database = await openWateringQueueDatabase()
    if (!database) return

    let entries = []
    try {
        entries = await readWateringQueue(database)
    } catch (error) {
        console.warn('⚠️ SW: не удалось прочитать офлайн-очередь:', error)
    }

    if (!Array.isArray(entries) || !entries.length) {
        try {
            database.close()
        } catch {
            void 0
        }
        return
    }

    let sent = 0
    let changed = false

    for (const entry of entries) {
        const outcome = await sendQueuedWatering(entry)

        if (outcome === 'sent' || outcome === 'drop') {
            if (outcome === 'drop') {
                console.error('⚠️ SW: отметка полива отклонена сервером и удалена из очереди:', {
                    plantId: entry?.plantId ?? null
                })
            } else {
                sent += 1
            }
            await deleteWateringQueueEntry(database, entry.id)
            changed = true
            continue
        }

        const attempts = (Number.isInteger(entry?.attempts) && entry.attempts >= 0
            ? entry.attempts
            : 0) + 1

        if (attempts >= WATERING_QUEUE_MAX_ATTEMPTS) {
            console.error('⚠️ SW: отметка полива не отправлена после лимита попыток:', {
                plantId: entry?.plantId ?? null,
                attempts
            })
            await deleteWateringQueueEntry(database, entry.id)
            changed = true
            continue
        }

        await putWateringQueueEntry(database, {
            ...entry,
            attempts,
            lastAttemptAt: Date.now()
        })
        changed = true
    }

    try {
        database.close()
    } catch {
        void 0
    }

    if (!changed) return

    await notifyClients({ type: WATERING_QUEUE_CHANGED_MESSAGE })

    if (sent > 0) await syncAppBadge()
}

self.addEventListener('sync', (event) => {
    if (event.tag !== WATERING_QUEUE_SYNC_TAG) return

    console.log('🔄 SW: sync', event.tag)

    event.waitUntil(processWateringQueue())
})

async function notifyClients(message) {
    try {
        const clientList = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        })
        for (const client of clientList) {
            try {
                client.postMessage(message)
            } catch (error) {
                console.warn('⚠️ SW: не удалось отправить сообщение клиенту:', error)
            }
        }
    } catch (error) {
        console.warn('⚠️ SW: clients.matchAll failed:', error)
    }
}

self.addEventListener('push', (event) => {
    console.log('📬 SW: push received')

    let data = { ...DEFAULT_PUSH }

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() }
        } catch {
            data.body = event.data.text()
        }
    }

    const tag = data.data?.tag
        ? `plant-${data.data.plantId ?? 'x'}-${data.data.tag}`
        : `plant-${data.data?.plantId ?? Date.now()}`

    event.waitUntil((async () => {
        await self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            tag,
            renotify: true,
            vibrate: [200, 100, 200],
            data: data.data || {},
            requireInteraction: false,
            timestamp: Date.now(),
            actions: [
                { action: 'open', title: 'Открыть' }
            ]
        })

        await notifyClients({
            type: 'push-received',
            notificationId: data.data?.notificationId ?? null
        })

        await syncAppBadge()
    })())
})

async function markNotificationRead(notificationId) {
    if (!Number.isInteger(notificationId) || notificationId < 1) return

    try {
        const response = await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
            method: 'PATCH',
            credentials: 'include'
        })
        if (!response.ok && response.status !== 401) {
            console.warn('⚠️ SW: не удалось отметить уведомление прочитанным:', response.status)
        }
    } catch (error) {

        console.warn('⚠️ SW: mark-read failed:', error)
    }
}

async function trackNotificationClick(notificationId) {
    if (!Number.isInteger(notificationId) || notificationId < 1) return

    try {
        const response = await fetch(`${API_BASE}/notifications/${notificationId}/click`, {
            method: 'POST',
            credentials: 'include',
            keepalive: true
        })
        if (!response.ok && response.status !== 401) {
            console.warn('⚠️ SW: не удалось учесть клик по уведомлению:', response.status)
        }
    } catch (error) {

        console.warn('⚠️ SW: notification click tracking failed:', error)
    }
}

function resolveBadgeApi() {
    const registration = self.registration
    if (registration &&
        (typeof registration.setAppBadge === 'function' ||
            typeof registration.clearAppBadge === 'function')) {
        return registration
    }

    if (typeof navigator !== 'undefined' &&
        (typeof navigator.setAppBadge === 'function' ||
            typeof navigator.clearAppBadge === 'function')) {
        return navigator
    }

    return null
}

async function syncAppBadge() {
    const badgeApi = resolveBadgeApi()
    if (!badgeApi) return

    try {
        const response = await fetch(`${API_BASE}/notifications/unread-count`, {
            credentials: 'include'
        })

        if (response.status === 401) {
            if (typeof badgeApi.clearAppBadge === 'function') {
                await badgeApi.clearAppBadge()
            }
            return
        }
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        const unread = Number(data?.unreadCount)
        const count = Number.isInteger(unread) && unread > 0 ? unread : 0

        if (count > 0 && typeof badgeApi.setAppBadge === 'function') {
            await badgeApi.setAppBadge(count)
        } else if (typeof badgeApi.clearAppBadge === 'function') {
            await badgeApi.clearAppBadge()
        }
    } catch (error) {
        console.warn('⚠️ SW: не удалось обновить бейдж на иконке:', error)
    }
}

self.addEventListener('notificationclick', (event) => {
    console.log('👆 SW: notification click', event.action)

    const notificationData = event.notification.data || {}
    const notificationId = Number.isInteger(notificationData.notificationId)
        ? notificationData.notificationId
        : null

    event.notification.close()

    const targetUrl = new URL(
        notificationData.url || '/home',
        self.location.origin
    )
    const urlToOpen = targetUrl.origin === self.location.origin
        ? targetUrl.href
        : new URL('/home', self.location.origin).href

    event.waitUntil((async () => {
        if (notificationId) {
            await markNotificationRead(notificationId)
            await trackNotificationClick(notificationId)
            await notifyClients({
                type: 'notifications-changed',
                notificationId
            })
        }

        await syncAppBadge()

        const clientList = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        })

        const existingClient = clientList.find(client => {
            try {
                return new URL(client.url).origin === self.location.origin &&
                    'focus' in client
            } catch {
                return false
            }
        })

        if (existingClient) {
            try {
                if (existingClient.url !== urlToOpen) {
                    await existingClient.navigate(urlToOpen)
                }
                await existingClient.focus()
                return
            } catch (error) {
                console.warn('⚠️ SW: navigate/focus failed, открываем новое окно:', error)
            }
        }

        if (self.clients.openWindow) {
            return self.clients.openWindow(urlToOpen)
        }
    })())
})

self.addEventListener('pushsubscriptionchange', (event) => {
    console.log('🔄 SW: pushsubscriptionchange')

    const oldEndpoint = event.oldSubscription?.endpoint || null

    event.waitUntil((async () => {
        try {
            const res = await fetch(`${API_BASE}/push/vapid-public-key`, {
                credentials: 'include'
            })
            if (!res.ok) {
                throw new Error(`VAPID key request failed: HTTP ${res.status}`)
            }
            const { publicKey } = await res.json()
            if (typeof publicKey !== 'string' || !publicKey) {
                throw new Error('Server did not return a VAPID public key')
            }

            const sub = event.newSubscription ||
                await self.registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey)
                })

            const saved = await fetch(`${API_BASE}/push/subscribe`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON() })
            })
            if (!saved.ok) {
                throw new Error(`Saving push subscription failed: HTTP ${saved.status}`)
            }

            if (oldEndpoint && oldEndpoint !== sub.endpoint) {

                try {
                    await fetch(`${API_BASE}/push/unsubscribe`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: oldEndpoint })
                    })
                } catch (cleanupError) {
                    console.warn('⚠️ SW: не удалось удалить старую подписку:', cleanupError)
                }
            }

            console.log('✅ SW: подписка пересоздана и сохранена')
        } catch (e) {
            console.error('❌ SW: pushsubscriptionchange error:', e)
        }
    })())
})

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
