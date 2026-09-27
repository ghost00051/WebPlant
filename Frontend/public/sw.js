const CACHE_NAME = 'ctp-v3'   // ⬆ поднял версию

const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json'
]

// =========================
// INSTALL
// =========================
self.addEventListener('install', (event) => {
    console.log('🔧 SW: install')
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(
                urlsToCache.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`⚠️ Не удалось закешировать ${url}:`, err)
                    )
                )
            )
        )
    )
    self.skipWaiting()
})

// =========================
// ACTIVATE
// =========================
self.addEventListener('activate', (event) => {
    console.log('🔧 SW: activate')
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            )
        )
    )
    self.clients.claim()
})

// =========================
// FETCH (только GET, не API)
// =========================
self.addEventListener('fetch', (event) => {
    const req = event.request

    // Не трогаем всё, кроме GET
    if (req.method !== 'GET') return

    const url = new URL(req.url)

    // Не кешируем API, uploads и сторонние домены
    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/uploads/') ||
        url.origin !== self.location.origin
    ) {
        return
    }

    event.respondWith(
        fetch(req).catch(async () => {
            const cached = await caches.match(req)
            if (cached) return cached

            // Фолбэк для навигации — отдаём SPA-оболочку
            if (req.mode === 'navigate') {
                return caches.match('/index.html')
            }
            return new Response('', { status: 504, statusText: 'Offline' })
        })
    )
})

// =========================
// PUSH
// =========================
self.addEventListener('push', (event) => {
    console.log('📬 SW: push received')

    let data = {
        title: 'CheckThePlants',
        body: 'Новое уведомление',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: {}
    }

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() }
        } catch (e) {
            data.body = event.data.text()
        }
    }

    // Уникальный tag на растение — иначе плашки схлопываются между растениями
    const tag = data.data?.tag
        ? `plant-${data.data.plantId ?? 'x'}-${data.data.tag}`
        : `plant-${data.data?.plantId ?? Date.now()}`

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            tag,
            renotify: true,              // перезаписывать существующую с тем же tag
            vibrate: [200, 100, 200],
            data: data.data || {},
            requireInteraction: false,
            actions: [
                { action: 'open', title: 'Открыть' }
            ]
        })
    )
})

// =========================
// NOTIFICATION CLICK
// =========================
self.addEventListener('notificationclick', (event) => {
    console.log('👆 SW: notification click', event.action)
    event.notification.close()

    // Кнопка "Открыть" или клик по телу — ведём на url
    const urlToOpen = event.notification.data?.url || '/'

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Если есть открытое окно — фокусируем и навигируем
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    client.navigate(urlToOpen)
                    return client.focus()
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen)
            }
        })
    )
})

// =========================
// PUSH SUBSCRIPTION CHANGE
// =========================
// Браузер сам пересоздал подписку (например, после смены VAPID).
// Нужно переподписаться и отправить новый endpoint на бэк.
self.addEventListener('pushsubscriptionchange', (event) => {
    console.log('🔄 SW: pushsubscriptionchange')

    event.waitUntil((async () => {
        try {
            // Пытаемся получить VAPID-ключ с бэка
            const res = await fetch('/api/push/vapid-public-key', { credentials: 'include' })
            const { publicKey } = await res.json()

            const sub = await self.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            })

            await fetch('/api/push/subscribe', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON() })
            })
            console.log('✅ SW: подписка пересоздана и сохранена')
        } catch (e) {
            console.error('❌ SW: pushsubscriptionchange error:', e)
        }
    })())
})

// Хелпер — дублирует функцию из pushClient.js, т.к. SW не имеет доступа к модулям
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}