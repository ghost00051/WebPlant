const CACHE_VERSION = 'v7'
const CACHE_NAME = `ctp-${CACHE_VERSION}`
const DEFAULT_API_BASE = '/api'
const VALID_API_PROTOCOLS = ['http:', 'https:']

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
})

self.addEventListener('activate', (event) => {
    console.log('🔧 SW: activate', { cache: CACHE_NAME })
    event.waitUntil((async () => {
        try {
            const cacheNames = await caches.keys()
            await Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
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
    return (await caches.match(request)) ||
        (await caches.match(request, { ignoreSearch: true })) ||
        (await caches.match('/home')) ||
        (await caches.match('/')) ||
        (await caches.match('/404.html'))
}

self.addEventListener('fetch', (event) => {
    const req = event.request

    if (req.method !== 'GET') return

    const url = new URL(req.url)

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
        }

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
