import { API_URL } from './api.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

const PUSH_REQUEST_TIMEOUT_MS = 10000
const SERVICE_WORKER_READY_TIMEOUT_MS = 8000
const PUSH_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
const PUSH_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

const PUSH_PROMPT_SHOWN_KEY = 'push_prompt_last_shown'
const PUSH_PROMPT_DECISION_KEY = 'push_prompt_decision'
const PUSH_DEVICE_OPT_OUT_KEY = 'push_device_opt_out'
const PUSH_SYNC_KEY = 'push_subscription_synced_at'

let vapidPublicKeyCache = null

export { PUSH_PROMPT_COOLDOWN_MS, PUSH_SYNC_INTERVAL_MS }

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

export function buildServiceWorkerUrl() {

    return `/sw.js?api=${encodeURIComponent(API_URL)}`
}


const SW_UPDATE_BANNER_ID = 'webplantSwUpdateBanner'
const SW_UPDATE_DISMISSED_KEY = 'sw_update_dismissed_version'
const SW_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const SW_UPDATE_RELOAD_FALLBACK_MS = 8000

let swUpdateReloadRequested = false
let swUpdateReloading = false
let swUpdateCheckTimer = null
let swUpdateControllerBound = false
let swUpdateVisibilityBound = false
let swUpdateDismissedInSession = false

function readDismissedSwUpdate() {
    try {
        return window.sessionStorage.getItem(SW_UPDATE_DISMISSED_KEY) || ''
    } catch {
        return ''
    }
}

function rememberDismissedSwUpdate() {
    swUpdateDismissedInSession = true
    try {
        window.sessionStorage.setItem(SW_UPDATE_DISMISSED_KEY, '1')
    } catch (error) {
        console.warn('Не удалось сохранить отказ от обновления:', error)
    }
}

function injectSwUpdateStyles() {
    const styleId = `${SW_UPDATE_BANNER_ID}Styles`
    if (document.getElementById(styleId)) return

    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
#${SW_UPDATE_BANNER_ID} {
    position: fixed;
    left: max(16px, env(safe-area-inset-left, 0px));
    bottom: max(16px, env(safe-area-inset-bottom, 0px));
    z-index: 900;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    box-sizing: border-box;
    width: min(380px, calc(100% - 32px));
    padding: 12px 14px;
    border: 1px solid #E3E9E3;
    border-radius: 14px;
    background: #FFFFFF;
    box-shadow: 0 10px 30px rgba(45, 55, 47, 0.18);
    color: #2D2D2D;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.4;
}
#${SW_UPDATE_BANNER_ID} [data-sw-update-text] { flex: 1 1 160px; min-width: 0; }
#${SW_UPDATE_BANNER_ID} [data-sw-update-title] { margin: 0; font-weight: 650; }
#${SW_UPDATE_BANNER_ID} [data-sw-update-note] { margin: 2px 0 0; color: #656862; font-size: 12px; }
#${SW_UPDATE_BANNER_ID} [data-sw-update-actions] { display: flex; gap: 8px; margin-left: auto; }
#${SW_UPDATE_BANNER_ID} button { min-height: 36px; padding: 6px 12px; border-radius: 10px; font-family: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
#${SW_UPDATE_BANNER_ID} button:focus-visible { outline: 2px solid #526A59; outline-offset: 2px; }
#${SW_UPDATE_BANNER_ID} [data-sw-update-confirm] { border: 1px solid #526A59; background: #526A59; color: #FFFFFF; }
#${SW_UPDATE_BANNER_ID} [data-sw-update-later] { border: 1px solid #E3E9E3; background: #FFFFFF; color: #526A59; }
#${SW_UPDATE_BANNER_ID} button:disabled { opacity: 0.65; cursor: wait; }
@media (max-width: 480px) {
    #${SW_UPDATE_BANNER_ID} { left: 10px; right: 10px; width: auto; }
    #${SW_UPDATE_BANNER_ID} [data-sw-update-actions] { width: 100%; margin-left: 0; }
    #${SW_UPDATE_BANNER_ID} button { flex: 1 1 0; }
}
`
    document.head.appendChild(style)
}

function positionSwUpdateBanner(banner) {
    let bottom = 16
    try {
        const cookieBanner = document.querySelector('.cookieConsentBanner')
        const rect = cookieBanner?.getBoundingClientRect?.()
        if (rect && rect.height > 0 && rect.top < window.innerHeight) {
            bottom = Math.max(16, Math.round(window.innerHeight - rect.top + 12))
        }
    } catch {
        bottom = 16
    }
    banner.style.bottom = `${bottom}px`
}

function showSwUpdateBanner(waitingWorker) {
    if (!waitingWorker || typeof waitingWorker.postMessage !== 'function') return
    if (!document.body) return
    if (swUpdateDismissedInSession) return
    if (readDismissedSwUpdate()) return
    if (document.getElementById(SW_UPDATE_BANNER_ID)) return

    injectSwUpdateStyles()

    const banner = document.createElement('div')
    banner.id = SW_UPDATE_BANNER_ID
    banner.setAttribute('role', 'status')
    banner.setAttribute('aria-live', 'polite')

    const text = document.createElement('div')
    text.dataset.swUpdateText = ''

    const title = document.createElement('p')
    title.dataset.swUpdateTitle = ''
    title.textContent = 'Доступна новая версия'

    const note = document.createElement('p')
    note.dataset.swUpdateNote = ''
    note.textContent = 'Обновите страницу, чтобы получить исправления.'

    text.append(title, note)

    const actions = document.createElement('div')
    actions.dataset.swUpdateActions = ''

    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.dataset.swUpdateConfirm = ''
    confirm.textContent = 'Обновить'

    const later = document.createElement('button')
    later.type = 'button'
    later.dataset.swUpdateLater = ''
    later.textContent = 'Позже'
    later.setAttribute('aria-label', 'Скрыть уведомление об обновлении')

    actions.append(confirm, later)
    banner.append(text, actions)

    let fallbackTimer = null

    const removeBanner = () => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        window.removeEventListener('resize', position)
        banner.remove()
    }

    const position = () => positionSwUpdateBanner(banner)

    confirm.addEventListener('click', () => {
        if (swUpdateReloadRequested) return
        swUpdateReloadRequested = true
        confirm.disabled = true
        later.disabled = true
        confirm.textContent = 'Обновляем…'

        try {
            waitingWorker.postMessage({ type: 'SKIP_WAITING' })
        } catch (error) {
            console.warn('Не удалось отправить SKIP_WAITING воркеру:', error)
        }

        fallbackTimer = window.setTimeout(() => {
            if (swUpdateReloading) return
            swUpdateReloadRequested = false
            confirm.disabled = false
            later.disabled = false
            confirm.textContent = 'Обновить'
            note.textContent = 'Не удалось обновить автоматически — обновите страницу вручную.'
        }, SW_UPDATE_RELOAD_FALLBACK_MS)
    })

    later.addEventListener('click', () => {
        rememberDismissedSwUpdate()
        removeBanner()
    })

    document.body.appendChild(banner)
    position()
    window.addEventListener('resize', position, { passive: true })
}

function handleSwControllerChange() {
    if (!swUpdateReloadRequested || swUpdateReloading) return
    swUpdateReloading = true
    try {
        window.location.reload()
    } catch (error) {
        swUpdateReloading = false
        console.warn('Не удалось перезагрузить страницу после обновления:', error)
    }
}

export function setupServiceWorkerUpdates(registration) {
    if (typeof window === 'undefined' || !registration) return
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return

    const hadController = Boolean(navigator.serviceWorker.controller)

    if (!swUpdateControllerBound) {
        swUpdateControllerBound = true
        try {
            navigator.serviceWorker.addEventListener('controllerchange', handleSwControllerChange)
        } catch (error) {
            console.warn('Не удалось подписаться на controllerchange:', error)
        }
    }

    const trackWorker = worker => {
        if (!worker) return

        const onStateChange = () => {
            if (worker.state !== 'installed') return
            if (!hadController && !navigator.serviceWorker.controller) return
            showSwUpdateBanner(worker)
        }

        if (worker.state === 'installed') onStateChange()
        else worker.addEventListener('statechange', onStateChange)
    }

    try {
        registration.addEventListener('updatefound', () => trackWorker(registration.installing))
    } catch (error) {
        console.warn('Не удалось подписаться на updatefound:', error)
    }

    trackWorker(registration.installing)
    if (registration.waiting && hadController) showSwUpdateBanner(registration.waiting)

    const checkForUpdate = () => {
        if (!registration.active) return
        registration.update().catch(error => {
            console.warn('Не удалось проверить обновление Service Worker:', error)
        })
    }

    if (!swUpdateCheckTimer) {
        swUpdateCheckTimer = window.setInterval(checkForUpdate, SW_UPDATE_CHECK_INTERVAL_MS)
    }

    if (!swUpdateVisibilityBound) {
        swUpdateVisibilityBound = true
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkForUpdate()
        })
    }
}

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service Worker не поддерживается')
    }

    const registration = await navigator.serviceWorker.register(buildServiceWorkerUrl(), {
        scope: '/'
    })


    try {
        setupServiceWorkerUpdates(registration)
    } catch (error) {
        console.warn('Не удалось включить проверку обновлений Service Worker:', error)
    }

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

function toUint8Array(value) {
    if (!value) return null
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }
    return null
}

function bytesEqual(left, right) {
    if (!left || !right || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

function subscriptionMatchesKey(subscription, keyBytes) {
    const currentKey = toUint8Array(subscription?.options?.applicationServerKey)

    if (!currentKey) return true
    return bytesEqual(currentKey, keyBytes)
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
    return permission === 'granted'
}

async function readServerMessage(response, fallback) {
    const fallbackMessage = `${fallback}: HTTP ${response.status}`
    try {
        const data = await response.json()
        if (data && typeof data.message === 'string' && data.message) {
            return data.message
        }
    } catch {
        return fallbackMessage
    }
    return fallbackMessage
}

async function fetchVapidPublicKey({ force = false } = {}) {
    if (!force && vapidPublicKeyCache) return vapidPublicKeyCache

    const response = await fetchWithTimeout(
        `${API_URL}/push/vapid-public-key`,
        { credentials: 'include' },
        PUSH_REQUEST_TIMEOUT_MS
    )
    if (!response.ok) {
        throw new Error(
            await readServerMessage(response, 'Не удалось получить ключ push-подписки')
        )
    }
    const data = await response.json().catch(() => ({}))
    if (typeof data.publicKey !== 'string' || !data.publicKey) {
        throw new Error('Сервер не вернул ключ push-подписки')
    }

    vapidPublicKeyCache = data.publicKey
    return vapidPublicKeyCache
}

async function postSubscription(subscription) {
    return fetchWithTimeout(
        `${API_URL}/push/subscribe`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ subscription: subscription.toJSON() })
        },
        PUSH_REQUEST_TIMEOUT_MS
    )
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

    const registration = await waitForRegistration(SERVICE_WORKER_READY_TIMEOUT_MS)
    if (!registration) {
        throw new Error('Сервис-воркер не готов. Обновите страницу и попробуйте ещё раз.')
    }

    const publicKey = await fetchVapidPublicKey()
    const keyBytes = urlBase64ToUint8Array(publicKey)

    let subscription = await registration.pushManager.getSubscription()

    if (subscription && !subscriptionMatchesKey(subscription, keyBytes)) {
        await subscription.unsubscribe().catch(error => {
            console.warn('Не удалось отписать несовместимую push-подписку:', error)
        })
        subscription = null
    }

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes
        })
    }

    let response = await postSubscription(subscription)

    if (response.status === 409) {

        await subscription.unsubscribe().catch(error => {
            console.warn('Не удалось отписать подписку другого аккаунта:', error)
        })
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes
        })
        response = await postSubscription(subscription)
    }

    if (!response.ok) {
        throw new Error(
            await readServerMessage(response, 'Ошибка сохранения подписки на сервере')
        )
    }

    writeLocalStorage(PUSH_SYNC_KEY, String(Date.now()))
    return subscription
}

export async function unsubscribeFromPush() {
    const registration = await waitForRegistration(SERVICE_WORKER_READY_TIMEOUT_MS)
    if (!registration) return false

    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return false

    let serverFailure = null

    try {
        const response = await fetchWithTimeout(
            `${API_URL}/push/unsubscribe`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ endpoint: subscription.endpoint })
            },
            PUSH_REQUEST_TIMEOUT_MS
        )

        if (!response.ok && response.status !== 401) {
            serverFailure = new Error(
                await readServerMessage(response, 'Не удалось удалить push-подписку')
            )
        }
    } catch (error) {
        serverFailure = error
    }

    try {
        await subscription.unsubscribe()
    } catch (error) {
        if (!serverFailure) serverFailure = error
        console.warn('Не удалось отписать браузерную push-подписку:', error)
    }

    removeLocalStorage(PUSH_SYNC_KEY)

    if (serverFailure) throw serverFailure
    return true
}

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

function waitForRegistration(timeoutMs = SERVICE_WORKER_READY_TIMEOUT_MS) {
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

function reportPushError(error, onError) {
    console.warn('Push-подписка не синхронизирована:', error)
    if (typeof onError === 'function') {
        onError(error)
    }
}

export async function restorePushSubscription(options = {}) {
    const { onError } = options
    if (!canUsePushApi() || Notification.permission !== 'granted') return null
    if (isPushDisabledOnThisDevice()) return null

    try {
        const subscription = await subscribeToPush()
        writeLocalStorage(PUSH_SYNC_KEY, String(Date.now()))
        return subscription
    } catch (error) {
        reportPushError(error, onError)
        return null
    }
}

export async function syncPushSubscription(options = {}) {
    const { now = Date.now(), onError } = options
    if (!canUsePushApi() || Notification.permission !== 'granted') return null
    if (isPushDisabledOnThisDevice()) return null

    const lastSyncAt = Number(readLocalStorage(PUSH_SYNC_KEY)) || 0
    if (lastSyncAt > 0 && now - lastSyncAt < PUSH_SYNC_INTERVAL_MS) return null

    try {
        const subscription = await subscribeToPush()
        writeLocalStorage(PUSH_SYNC_KEY, String(now))
        return subscription
    } catch (error) {
        reportPushError(error, onError)
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
