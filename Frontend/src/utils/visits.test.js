import test from 'node:test'
import assert from 'node:assert/strict'

import {
    isRetryableVisitStatus,
    nextVisitRetryDelay,
    resetVisitTracking,
    startVisitTracking,
    trackVisit
} from './visits.js'
import { LOCAL_CONSENT_KEY, buildLocalConsent } from './cookieConsent.js'
import { notifyCookieConsentSaved } from './cookieConsentSettings.js'

const VISIT_URL_PATTERN = /\/system\/visit$/

function createStorage() {
    const store = new Map()
    return {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
            store.set(key, String(value))
        },
        removeItem: key => {
            store.delete(key)
        }
    }
}

function createWindowMock({ pathname = '/home', search = '', timers = [] } = {}) {
    const listeners = new Map()

    const windowMock = {
        localStorage: createStorage(),
        sessionStorage: createStorage(),
        location: { pathname, search },
        crypto: {},
        CustomEvent: globalThis.CustomEvent,
        setTimeout(fn, ms) {
            const timer = { fn, ms, id: timers.length + 1, cleared: false }
            timers.push(timer)
            return timer.id
        },
        clearTimeout(id) {
            const timer = timers.find(item => item.id === id)
            if (timer) timer.cleared = true
        },
        addEventListener(type, handler) {
            listeners.set(type, [...(listeners.get(type) || []), handler])
        },
        removeEventListener(type, handler) {
            listeners.set(type, (listeners.get(type) || []).filter(item => item !== handler))
        },
        dispatchEvent(event) {
            for (const handler of listeners.get(event.type) || []) handler(event)
            return true
        }
    }

    return { windowMock, listeners }
}

function installWindow(windowMock) {
    const previous = globalThis.window
    globalThis.window = windowMock
    return () => {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
}

function installFetch(handler) {
    const previous = globalThis.fetch
    globalThis.fetch = handler
    return () => {
        if (previous === undefined) delete globalThis.fetch
        else globalThis.fetch = previous
    }
}

function acceptAnalyticsLocal(windowMock) {
    windowMock.localStorage.setItem(
        LOCAL_CONSENT_KEY,
        JSON.stringify(buildLocalConsent(true))
    )
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('nextVisitRetryDelay: backoff растёт и учитывает Retry-After', () => {
    assert.equal(nextVisitRetryDelay(1, null), 3000)
    assert.equal(nextVisitRetryDelay(2, null), 10000)
    assert.equal(nextVisitRetryDelay(3, null), 30000)
    assert.equal(nextVisitRetryDelay(4, null), 30000, 'последняя задержка не растёт бесконечно')
    assert.equal(nextVisitRetryDelay(1, 7), 7000, 'Retry-After важнее базового backoff')
    assert.equal(nextVisitRetryDelay(3, 7), 30000, 'базовый backoff не сокращается')
    assert.equal(nextVisitRetryDelay(1, 60 * 60), 300000, 'слишком долгий Retry-After ограничен')
})

test('isRetryableVisitStatus: повторяем сеть, 429 и 5xx, но не прочие 4xx', () => {
    assert.equal(isRetryableVisitStatus(0), true, 'сеть/таймаут')
    assert.equal(isRetryableVisitStatus(null), true)
    assert.equal(isRetryableVisitStatus(429), true)
    assert.equal(isRetryableVisitStatus(500), true)
    assert.equal(isRetryableVisitStatus(503), true)
    assert.equal(isRetryableVisitStatus(400), false)
    assert.equal(isRetryableVisitStatus(401), false)
    assert.equal(isRetryableVisitStatus(403), false)
})

test('маяк: без согласия визит не уходит, после позднего согласия — уходит один раз', async () => {
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    const calls = []
    const restoreFetch = installFetch(async (url, options) => {
        calls.push({ url: String(url), options })
        return { ok: true, status: 200 }
    })

    try {
        startVisitTracking()
        await flush()
        assert.equal(calls.length, 0, 'без согласия на аналитику визит не отправляется')

        acceptAnalyticsLocal(windowMock)
        notifyCookieConsentSaved(true)
        await flush()

        assert.equal(calls.length, 1, 'позднее согласие отправляет визит без перезагрузки')
        assert.match(calls[0].url, VISIT_URL_PATTERN)
        assert.equal(calls[0].options.method, 'POST')
        assert.equal(calls[0].options.credentials, 'include', 'optionalAuth проставит user_id')
        const body = JSON.parse(calls[0].options.body)
        assert.ok(body.visitorId, 'visitorId передан')
        assert.equal(body.path, '/home')

        // Повторное событие/рендер не дублирует визит.
        notifyCookieConsentSaved(true)
        await trackVisit()
        await flush()
        assert.equal(calls.length, 1, 'визит не дублируется')
        assert.equal(timers.length, 0, 'после успеха повторы не планируются')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: сетевой сбой не сжигает визит — повтор, sent только после успеха', async t => {
    t.mock.method(console, 'warn', () => {})
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    acceptAnalyticsLocal(windowMock)

    let attempts = 0
    const restoreFetch = installFetch(async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network down')
        return { ok: true, status: 200 }
    })

    try {
        startVisitTracking()
        await flush()

        assert.equal(attempts, 1)
        const retry = timers.filter(timer => !timer.cleared)
        assert.equal(retry.length, 1, 'после сетевого сбоя запланирован повтор')
        assert.equal(retry[0].ms, 3000)

        retry[0].fn()
        await flush()
        assert.equal(attempts, 2, 'повтор отправил визит')

        const timersAfterSuccess = timers.length
        await trackVisit()
        assert.equal(attempts, 2, 'после успеха новые попытки не делаются')
        assert.equal(timers.length, timersAfterSuccess, 'новые повторы не планируются')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: 429 уважает Retry-After и повторяет визит', async () => {
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    acceptAnalyticsLocal(windowMock)
    let attempts = 0
    const restoreFetch = installFetch(async () => {
        attempts += 1
        return {
            ok: false,
            status: 429,
            headers: { get: name => (name === 'Retry-After' ? '7' : null) }
        }
    })

    try {
        startVisitTracking()
        await flush()
        assert.equal(attempts, 1)
        const retry = timers.filter(timer => !timer.cleared)
        assert.equal(retry.length, 1, '429 — временная ошибка, нужен повтор')
        assert.equal(retry[0].ms, 7000, 'задержка из Retry-After')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: окончательный 4xx не спамит повторами', async () => {
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    acceptAnalyticsLocal(windowMock)
    let attempts = 0
    const restoreFetch = installFetch(async () => {
        attempts += 1
        return { ok: false, status: 400, headers: { get: () => null } }
    })

    try {
        startVisitTracking()
        await flush()
        assert.equal(attempts, 1)
        assert.equal(timers.filter(timer => !timer.cleared).length, 0, '400 не повторяем')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: согласие, известное только серверу, тоже отправляет визит', async () => {
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    let attempts = 0
    const restoreFetch = installFetch(async () => {
        attempts += 1
        return { ok: true, status: 200 }
    })

    try {
        startVisitTracking()
        await flush()
        assert.equal(attempts, 0, 'локальной записи о согласии нет')

        // CookieConsentManager узнал о согласии с сервера и оповестил маяк.
        notifyCookieConsentSaved(true)
        await flush()
        assert.equal(attempts, 1, 'серверное согласие достаточно для визита')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: отзыв согласия снимает запланированные повторы', async t => {
    t.mock.method(console, 'warn', () => {})
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    acceptAnalyticsLocal(windowMock)
    const restoreFetch = installFetch(async () => {
        throw new Error('network down')
    })

    try {
        startVisitTracking()
        await flush()
        const retry = timers.find(timer => !timer.cleared)
        assert.ok(retry, 'повтор запланирован после сбоя')

        notifyCookieConsentSaved(false)
        assert.equal(retry.cleared, true, 'отзыв согласия отменяет повтор')
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})

test('маяк: параллельные вызовы не дублируют отправку', async () => {
    resetVisitTracking()
    const timers = []
    const { windowMock } = createWindowMock({ timers })
    const restoreWindow = installWindow(windowMock)
    acceptAnalyticsLocal(windowMock)
    let attempts = 0
    let resolveRequest
    const restoreFetch = installFetch(() => {
        attempts += 1
        return new Promise(resolve => {
            resolveRequest = resolve
        })
    })

    try {
        const first = trackVisit()
        const second = trackVisit()
        assert.equal(attempts, 1, 'второй вызов во время отправки игнорируется')

        resolveRequest({ ok: true, status: 200 })
        assert.equal(await first, true)
        assert.equal(await second, false)
        assert.equal(attempts, 1)
    } finally {
        resetVisitTracking()
        restoreFetch()
        restoreWindow()
    }
})
