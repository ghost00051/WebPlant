import test from 'node:test'
import assert from 'node:assert/strict'

const CONSENT_KEY = 'webplant-cookie-consent'
const VISITOR_KEY = 'webplant-visitor-id'

function installBrowser({ consent, visitorId, doNotTrack } = {}) {
    const store = new Map()
    if (consent) store.set(CONSENT_KEY, JSON.stringify(consent))
    if (visitorId) store.set(VISITOR_KEY, visitorId)

    globalThis.window = {
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value))
        },
        location: { pathname: '/home', search: '?tab=plants' },
        crypto: { randomUUID: () => 'generated-visitor-uuid' },
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: id => clearTimeout(id)
    }

    Object.defineProperty(globalThis, 'navigator', {
        value: { doNotTrack: doNotTrack || null },
        configurable: true,
        writable: true
    })

    const calls = []
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options })
        return { ok: true, status: 200, json: async () => ({ counted: true }) }
    }

    return { store, calls }
}

function analyticsConsent() {
    return { analyticsAccepted: true, version: '1.0', savedAt: Date.now() }
}

let moduleCounter = 0

async function loadVisits() {
    moduleCounter += 1
    return import(`./visits.js?case=${moduleCounter}`)
}

test('без согласия на аналитику посещение не отправляется', async () => {
    const { calls } = installBrowser()
    const { trackVisit } = await loadVisits()

    trackVisit()

    assert.equal(calls.length, 0)
})

test('при согласии отправляется один запрос с идентификатором и путём', async () => {
    const { store, calls } = installBrowser({
        consent: analyticsConsent(),
        visitorId: 'visitor-abcdefgh'
    })
    const { trackVisit } = await loadVisits()

    trackVisit()

    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/system\/visit$/)
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.credentials, 'include')

    const body = JSON.parse(calls[0].options.body)
    assert.equal(body.visitorId, 'visitor-abcdefgh')
    assert.equal(body.path, '/home?tab=plants')
    assert.equal(store.get(VISITOR_KEY), 'visitor-abcdefgh')
})

test('повторный вызов в рамках одной страницы не дублирует запрос', async () => {
    const { calls } = installBrowser({ consent: analyticsConsent() })
    const { trackVisit } = await loadVisits()

    trackVisit()
    trackVisit()
    trackVisit('/my-plants')

    assert.equal(calls.length, 1)
    assert.equal(JSON.parse(calls[0].options.body).visitorId, 'generated-visitor-uuid')
})

test('Do Not Track отключает счётчик', async () => {
    const { calls } = installBrowser({ consent: analyticsConsent(), doNotTrack: '1' })
    const { trackVisit } = await loadVisits()

    trackVisit()

    assert.equal(calls.length, 0)
})

test('просроченное согласие не считается принятым', async () => {
    const { calls } = installBrowser({
        consent: { analyticsAccepted: true, version: '1.0', savedAt: Date.now() - 200 * 24 * 60 * 60 * 1000 }
    })
    const { trackVisit } = await loadVisits()

    trackVisit()

    assert.equal(calls.length, 0)
})

test('явный отказ от аналитики не отправляет посещение', async () => {
    const { calls } = installBrowser({
        consent: { analyticsAccepted: false, version: '1.0', savedAt: Date.now() }
    })
    const { trackVisit } = await loadVisits()

    trackVisit()

    assert.equal(calls.length, 0)
})

test('startVisitTracking без согласия не отправляет запрос сразу', async () => {
    const { calls } = installBrowser()
    const { startVisitTracking } = await loadVisits()

    startVisitTracking()

    assert.equal(calls.length, 0)
})
