const CACHE_NAME = 'ctp-v2'    // ← увеличить версию, чтобы обновить кэш

const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json'
    // ← убрали иконки из кеша, чтобы SW не падал если их нет
]

self.addEventListener('install', (event) => {
    console.log('🔧 SW: install')
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // ✅ Кешируем по одному, игнорируя ошибки
                return Promise.all(
                    urlsToCache.map(url => 
                        cache.add(url).catch(err => 
                            console.warn(`⚠️ Не удалось закешировать ${url}:`, err)
                        )
                    )
                )
            })
    )
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    console.log('🔧 SW: activate')
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            )
        })
    )
    self.clients.claim()
})

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/')) {
        return
    }
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    )
})

self.addEventListener('push', (event) => {
    console.log('📬 SW: push received')

    let data = {
        title: 'CheckThePlants',
        body: 'Новое уведомление',
        icon: '/icon-192.png'
    }

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() }
        } catch (e) {
            data.body = event.data.text()
        }
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: '/badge-72.png',
            vibrate: [200, 100, 200],
            data: data.data || {}
        })
    )
})

self.addEventListener('notificationclick', (event) => {
    console.log('👆 SW: notification click')
    event.notification.close()

    const urlToOpen = event.notification.data?.url || '/'

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(urlToOpen)
                    return client.focus()
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen)
            }
        })
    )
})