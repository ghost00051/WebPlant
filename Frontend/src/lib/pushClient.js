const API = import.meta.env.VITE_API_URL || 'https://server.checktheplants.ru/api'

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null
    return navigator.serviceWorker.register('/sw.js')
}

export async function subscribeToPush() {
    if (!('Notification' in window) || !('PushManager' in window)) {
        throw new Error('Push не поддерживается')
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') throw new Error('Разрешение не выдано')

    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await fetch(`${API}/api/push/vapid-public-key`, {
        credentials: 'include'
    }).then(r => r.json())

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        })
    }

    const res = await fetch(`${API}/api/push/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() })
    })
    if (!res.ok) throw new Error('Не удалось сохранить подписку')
    return sub
}

export async function unsubscribeFromPush() {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return

    await fetch(`${API}/api/push/unsubscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
    })
    await sub.unsubscribe()
}