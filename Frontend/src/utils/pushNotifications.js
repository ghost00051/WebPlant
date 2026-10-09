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

const PUSH_PROMPT_SHOWN_KEY = 'push_prompt_last_shown'
const PUSH_PROMPT_DECISION_KEY = 'push_prompt_decision'
const PUSH_DEVICE_OPT_OUT_KEY = 'push_device_opt_out'
const PUSH_SYNC_KEY = 'push_subscription_synced_at'

export const PUSH_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
export const PUSH_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
const PUSH_REGISTRATION_TIMEOUT_MS = 5000

function readLocalStorage(key) {
    try {
        return window.localStorage.getItem(key)
    } catch (error) {
        console.warn(`Не удалось прочитать ${key} из localStorage:`, error)
        return null
    }
}

function writeLocalStorage(key, value) {
    try {
        window.localStorage.setItem(key, value)
    } catch (error) {
        console.warn(`Не удалось сохранить ${key} в localStorage:`, error)
    }
}

function removeLocalStorage(key) {
    try {
        window.localStorage.removeItem(key)
    } catch (error) {
        console.warn(`Не удалось удалить ${key} из localStorage:`, error)
    }
}

export function getPushPromptAnswer() {
    const answeredAt = Number(readLocalStorage(PUSH_PROMPT_SHOWN_KEY)) || 0
    const storedDecision = readLocalStorage(PUSH_PROMPT_DECISION_KEY)
    const decision = storedDecision === 'accepted' || storedDecision === 'declined'
        ? storedDecision
        : null
    return { answeredAt, decision }
}

export function markPushPromptAnswered(decision) {
    writeLocalStorage(PUSH_PROMPT_SHOWN_KEY, Date.now().toString())
    writeLocalStorage(
        PUSH_PROMPT_DECISION_KEY,
        decision === 'accepted' ? 'accepted' : 'declined'
    )
}

export function markPushPromptShown() {
    writeLocalStorage(PUSH_PROMPT_SHOWN_KEY, Date.now().toString())
}

export function wasPushPromptAnsweredRecently(now = Date.now()) {
    const { answeredAt } = getPushPromptAnswer()
    return answeredAt > 0 && now - answeredAt < PUSH_PROMPT_COOLDOWN_MS
}

export function isPushDisabledOnThisDevice() {
    return readLocalStorage(PUSH_DEVICE_OPT_OUT_KEY) === 'true'
}

export function setPushDisabledOnThisDevice(disabled) {
    if (disabled) {
        writeLocalStorage(PUSH_DEVICE_OPT_OUT_KEY, 'true')
    } else {
        removeLocalStorage(PUSH_DEVICE_OPT_OUT_KEY)
    }
}

function canUsePushApi() {
    return typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        isPushSupported()
}

function waitForRegistration(timeoutMs = PUSH_REGISTRATION_TIMEOUT_MS) {
    if (!navigator.serviceWorker || !navigator.serviceWorker.ready) {
        return Promise.resolve(null)
    }

    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), timeoutMs)
        navigator.serviceWorker.ready.then(
            registration => {
                clearTimeout(timer)
                resolve(registration)
            },
            () => {
                clearTimeout(timer)
                resolve(null)
            }
        )
    })
}

export async function getActivePushSubscription() {
    if (!canUsePushApi()) return null
    try {
        const registration = await waitForRegistration()
        if (!registration) return null
        return await registration.pushManager.getSubscription()
    } catch (error) {
        console.warn('Не удалось проверить push-подписку:', error)
        return null
    }
}

export async function restorePushSubscription() {
    if (!canUsePushApi() || Notification.permission !== 'granted') return null
    if (isPushDisabledOnThisDevice()) return null

    try {
        const subscription = await subscribeToPush()
        writeLocalStorage(PUSH_SYNC_KEY, String(Date.now()))
        return subscription
    } catch (error) {
        console.warn('Не удалось восстановить push-подписку:', error)
        return null
    }
}

export async function syncPushSubscription(now = Date.now()) {
    if (!canUsePushApi() || Notification.permission !== 'granted') return null
    if (isPushDisabledOnThisDevice()) return null

    const lastSyncAt = Number(readLocalStorage(PUSH_SYNC_KEY)) || 0
    if (lastSyncAt > 0 && now - lastSyncAt < PUSH_SYNC_INTERVAL_MS) return null

    try {
        const subscription = await subscribeToPush()
        writeLocalStorage(PUSH_SYNC_KEY, String(now))
        return subscription
    } catch (error) {
        console.warn('Не удалось синхронизировать push-подписку с сервером:', error)
        return null
    }
}

export function shouldOfferPushPrompt(now = Date.now()) {
    if (!canUsePushApi()) return false
    if (Notification.permission !== 'default') return false
    if (getPushPromptAnswer().decision === 'accepted') return false
    if (isPushDisabledOnThisDevice()) return false
    return !wasPushPromptAnsweredRecently(now)
}

export function isIOS() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
    const userAgent = navigator.userAgent
    const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent)
    const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    return (isAppleMobile || isIPadOS) && !window.MSStream
}