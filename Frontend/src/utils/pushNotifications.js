import { API_URL } from './api.js'

export function isPushSupported() {
    return window.isSecureContext &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
}

export function isStandalone() {
    if (typeof window === 'undefined') return false
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
    if (!isPushSupported()) {
        throw new Error('Push не поддерживается в этом браузере')
    }
    if (isIOS() && !isStandalone()) {
        throw new Error('На iPhone сначала добавьте приложение на экран «Домой»')
    }

    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false

    const permission = await Notification.requestPermission()
    console.log('🔔 Разрешение:', permission)
    return permission === 'granted'
}

export async function subscribeToPush() {
    if (!isPushSupported()) {
        throw new Error('Push не поддерживается')
    }

    if (isIOS() && !isStandalone()) {
        throw new Error('На iPhone сначала добавьте приложение на экран «Домой»')
    }
    if (Notification.permission !== 'granted') {
        throw new Error('Сначала разрешите отправку уведомлений')
    }

    const registration = await navigator.serviceWorker.ready

    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
        const res = await fetch(`${API_URL}/push/vapid-public-key`)
        if (!res.ok) {
            throw new Error(`Не удалось получить ключ push-подписки: HTTP ${res.status}`)
        }
        const { publicKey } = await res.json()
        if (typeof publicKey !== 'string' || !publicKey) {
            throw new Error('Сервер не вернул ключ push-подписки')
        }

        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        })

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

    const response = await fetch(`${API_URL}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: subscription.endpoint })
    })

    if (!response.ok) {
        throw new Error(`Не удалось удалить push-подписку: HTTP ${response.status}`)
    }

    await subscription.unsubscribe()
    console.log('✅ Отписан от push')
    return true
}

export function isIOS() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
    const userAgent = navigator.userAgent
    const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent)
    const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    return (isAppleMobile || isIPadOS) && !window.MSStream
}