
export const OVERLAY_IDS = Object.freeze({
    cookie: 'cookie',
    push: 'push',
    pwa: 'pwa'
})

export const OVERLAY_PRIORITIES = Object.freeze({
    cookie: 100,
    push: 80,
    pwa: 40
})

export const OVERLAY_Z_INDEX = Object.freeze({
    cookie: 1000,
    push: 950,
    serviceWorkerBanner: 900,
    pwa: 700
})

const requests = new Map()
const listeners = new Set()

let activeId = null

function emit() {
    for (const listener of listeners) {
        try {
            listener()
        } catch (error) {
            console.warn('Ошибка подписчика очереди оверлеев:', error)
        }
    }
}

function recompute() {
    let nextId = null
    let nextPriority = -Infinity
    for (const [id, priority] of requests) {
        if (priority > nextPriority) {
            nextId = id
            nextPriority = priority
        }
    }

    if (nextId === activeId) return
    activeId = nextId
    emit()
}

export function requestOverlay(id, priority) {
    try {
        requests.set(String(id), Number(priority) || 0)
        recompute()
    } catch (error) {
        console.warn('Не удалось запросить слот оверлея:', error)
    }

    return () => releaseOverlay(id)
}

export function releaseOverlay(id) {
    try {
        if (requests.delete(String(id))) recompute()
    } catch (error) {
        console.warn('Не удалось освободить слот оверлея:', error)
    }
}

export function getActiveOverlay() {
    return activeId
}

export function subscribeOverlays(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
