import { API_BASE, SERVER_BASE } from './config.js'


export const REQUEST_TIMEOUT_MS = 15000

export class ApiError extends Error {
    constructor(message, status, payload = null) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.payload = payload
    }
}

export class AuthError extends ApiError {
    constructor(message = 'Сессия истекла — войдите заново') {
        super(message, 401)
        this.name = 'AuthError'
    }
}

export class TimeoutError extends ApiError {
    constructor(ms = REQUEST_TIMEOUT_MS) {
        super(`Сервер не ответил за ${Math.round(ms / 1000)} с. Проверьте подключение и повторите.`, 0)
        this.name = 'TimeoutError'
    }
}

export class StaleResponseError extends Error {
    constructor() {
        super('Запрос отменён: данные устарели')
        this.name = 'StaleResponseError'
    }
}

export function isCanceled(error) {
    return error?.name === 'StaleResponseError' || error?.name === 'AbortError'
}

let generation = 0
const controllers = new Set()
let unauthorizedHandler = null
let unauthorizedNotified = false

export function getGeneration() {
    return generation
}

export function onUnauthorized(handler) {
    unauthorizedHandler = typeof handler === 'function' ? handler : null
}

export function cancelPending() {
    generation += 1
    for (const controller of controllers) {
        try {
            controller.abort(new StaleResponseError())
        } catch {
            ;
        }
    }
    controllers.clear()
    return generation
}

function notifyUnauthorized() {
    if (unauthorizedNotified) return
    unauthorizedNotified = true
    if (unauthorizedHandler) unauthorizedHandler()
}

function resetUnauthorized() {
    unauthorizedNotified = false
}

async function parseBody(response) {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) return null
    try {
        return await response.json()
    } catch {
        return null
    }
}

async function requestWithGuards(path, url, options = {}, { allowUnauthorized = false } = {}) {
    const requestGeneration = generation
    const controller = new AbortController()
    controllers.add(controller)

    const externalSignal = options.signal
    const requestOptions = { ...options }
    delete requestOptions.signal

    let timedOut = false
    const timeoutId = setTimeout(() => {
        timedOut = true
        try {
            controller.abort(new TimeoutError())
        } catch {
            ;
        }
    }, REQUEST_TIMEOUT_MS)

    let onExternalAbort = null
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort(externalSignal.reason)
        else {
            onExternalAbort = () => controller.abort(externalSignal.reason)
            externalSignal.addEventListener('abort', onExternalAbort, { once: true })
        }
    }

    try {
        let response
        try {
            response = await fetch(url, { ...requestOptions, signal: controller.signal })
        } catch (error) {
            if (timedOut) throw new TimeoutError()
            if (isCanceled(error)) {
                throw error?.name === 'StaleResponseError' ? error : new StaleResponseError()
            }
            throw new ApiError('Нет связи с сервером API. Проверьте подключение и адрес API.', 0)
        }

        if (requestGeneration !== generation) throw new StaleResponseError()

        const data = await parseBody(response)

        if (requestGeneration !== generation) throw new StaleResponseError()

        if (response.status === 401 && !allowUnauthorized) {
            notifyUnauthorized()
            throw new AuthError(data?.message || 'Сессия истекла — войдите заново')
        }

        if (!response.ok) {
            throw new ApiError(data?.message || `Ошибка запроса (${response.status})`, response.status, data)
        }

        resetUnauthorized()
        return data
    } finally {
        clearTimeout(timeoutId)
        controllers.delete(controller)
        if (externalSignal && onExternalAbort) {
            externalSignal.removeEventListener('abort', onExternalAbort)
        }
    }
}

export async function request(path, { method = 'GET', body, signal } = {}) {
    const headers = { Accept: 'application/json' }
    const options = { method, credentials: 'include', headers, signal }
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        options.body = JSON.stringify(body)
    }
    return requestWithGuards(path, `${API_BASE}${path}`, options, {
        allowUnauthorized: path === '/users/login'
    })
}

export async function requestServer(path) {
    return requestWithGuards(path, `${SERVER_BASE}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
    }, { allowUnauthorized: true })
}

export function query(params = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue
        search.set(key, String(value))
    }
    const text = search.toString()
    return text ? `?${text}` : ''
}

export const api = {
    me: () => request('/users/me'),
    login: (email, password, rememberMe) => request('/users/login', {
        method: 'POST',
        body: { email, password, rememberMe }
    }),
    logout: () => request('/users/logout', { method: 'POST' }),

    overview: days => request(`/admin/analytics/overview${query({ days })}`),
    timeseries: days => request(`/admin/analytics/timeseries${query({ days })}`),
    breakdown: days => request(`/admin/analytics/breakdown${query({ days })}`),
    productAnalytics: days => request(`/admin/product/analytics${query({ days })}`),
    visits: params => request(`/admin/visits${query(params)}`),

    users: params => request(`/admin/users${query(params)}`),
    user: id => request(`/admin/users/${id}`),
    updateUser: (id, patch) => request(`/admin/users/${id}`, { method: 'PATCH', body: patch }),
    deleteUser: id => request(`/admin/users/${id}`, { method: 'DELETE' }),

    plants: params => request(`/admin/plants${query(params)}`),
    deletePlant: id => request(`/admin/plants/${id}`, { method: 'DELETE' }),

    waterings: params => request(`/admin/waterings${query(params)}`),
    deleteWatering: id => request(`/admin/waterings/${id}`, { method: 'DELETE' }),

    photos: params => request(`/admin/photos${query(params)}`),
    deletePhoto: id => request(`/admin/photos/${id}`, { method: 'DELETE' }),

    chat: params => request(`/admin/chat${query(params)}`),
    deleteChat: id => request(`/admin/chat/${id}`, { method: 'DELETE' }),
    deleteChatSession: sessionId => request(`/admin/chat/session/${sessionId}`, { method: 'DELETE' }),

    pushOverview: () => request('/admin/push/overview'),

    aiMetrics: days => request(`/admin/ai/metrics${query({ days })}`),
    aiLogs: params => request(`/admin/ai/logs${query(params)}`),

    health: () => requestServer('/health'),
    dockerStats: () => request('/system/docker-stats'),
    dockerLogs: (id, tail = 100) => request(`/system/docker-stats/${encodeURIComponent(id)}/logs${query({ tail })}`)
}
