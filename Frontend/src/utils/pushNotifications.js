const API_URL = import.meta.env.VITE_API_URL || 'https://server.checktheplants.ru/api'

export function isPushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true
}

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service Worker не поддерживается')
    }

    const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
    })

    console.log('✅ Service Worker зарегистрирован:', registration.scope)
    return registration
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
}

export async function requestPermission() {
    const permission = await Notification.requestPermission()
    console.log('🔔 Разрешение:', permission)
    return permission === 'granted'
}

export async function subscribeToPush() {
    if (!isPushSupported()) {
        throw new Error('Push не поддерживается')
    }

    if (isIOS() && !isStandalone()) {
        throw new Error('На iPhone добавьте сайт на домашний экран, чтобы получать уведомления')
    }

    const registration = await navigator.serviceWorker.ready

    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
        const res = await fetch(`${API_URL}/push/vapid-public-key`)
        const { publicKey } = await res.json()

        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        })

        console.log('✅ Подписка создана:', subscription.endpoint)
    } else {
        console.log('ℹ️ Уже подписан:', subscription.endpoint)
    }

    const response = await fetch(`${API_URL}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription: subscription.toJSON() })
    })

    if (!response.ok) {
        throw new Error('Ошибка сохранения подписки на сервере')
    }

    return subscription
}

export async function unsubscribeFromPush() {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
        return false
    }

    await fetch(`${API_URL}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: subscription.endpoint })
    })

    await subscription.unsubscribe()
    console.log('✅ Отписан от push')
    return true
}

export function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}