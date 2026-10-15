const failures = []
let checks = 0

function check(name, condition, extra = '') {
    checks += 1
    if (condition) console.log(`  ✔ ${name}`)
    else {
        failures.push(name)
        console.log(`  ✖ ${name}${extra ? ` — ${extra}` : ''}`)
    }
}


function makeEl(tag = 'div') {
    const el = {
        tagName: String(tag).toUpperCase(),
        nodeType: 1,
        children: [],
        attrs: {},
        style: {},
        dataset: {},
        value: '',
        classList: {
            add() {},
            remove() {},
            toggle() {},
            contains: () => false
        },
        setAttribute(key, value) {
            this.attrs[key] = String(value)
            if (key.startsWith('data-')) {
                const name = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                this.dataset[name] = String(value)
            }
        },
        getAttribute(key) {
            return this.attrs[key] ?? null
        },
        appendChild(child) {
            this.children.push(child)
            return child
        },
        append(...children) {
            this.children.push(...children)
        },
        replaceChildren(...children) {
            this.children = children
        },
        remove() {},
        _listeners: {},
        addEventListener(type, handler) {
            this._listeners[type] = this._listeners[type] || []
            this._listeners[type].push(handler)
        },
        removeEventListener(type, handler) {
            this._listeners[type] = (this._listeners[type] || []).filter(item => item !== handler)
        },
        click() {
            if (this.disabled || 'disabled' in this.attrs) return
            this.dispatch('click', { target: this })
        },
        dispatch(type, event = {}) {
            for (const handler of this._listeners[type] || []) {
                handler({ target: this, stopPropagation() {}, preventDefault() {}, ...event })
            }
        },
        focus() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        get firstChild() {
            return this.children[0] || null
        },
        removeChild(child) {
            this.children = this.children.filter(item => item !== child)
        }
    }
    Object.defineProperty(el, 'textContent', {
        get() {
            return this._text || ''
        },
        set(value) {
            this._text = String(value)
        }
    })
    Object.defineProperty(el, 'disabled', {
        get() {
            return 'disabled' in this.attrs
        },
        set(value) {
            if (value) this.attrs.disabled = ''
            else delete this.attrs.disabled
        }
    })
    return el
}

function makeTextNode(text) {
    return { nodeType: 3, text }
}

const registry = new Map()
const documentElement = makeEl('html')
const body = makeEl('body')

globalThis.document = {
    readyState: 'complete',
    documentElement,
    body,
    activeElement: null,
    createElement: tag => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: text => makeTextNode(text),
    getElementById(id) {
        if (!registry.has(id)) registry.set(id, makeEl('div'))
        return registry.get(id)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
}

globalThis.window = {
    localStorage: {
        store: new Map(),
        getItem(key) {
            return this.store.has(key) ? this.store.get(key) : null
        },
        setItem(key, value) {
            this.store.set(key, String(value))
        }
    },
    location: { hash: '', search: '', href: 'http://localhost/' },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
}
globalThis.WEBPLANT_ADMIN_CONFIG = { apiBase: 'http://127.0.0.1:5099/api', siteBase: 'https://checktheplants.ru' }


const now = Date.now()
const day = offset => new Date(now - offset * 86400000).toISOString().slice(0, 10)

function timeseriesPayload(days = 30) {
    const points = []
    for (let index = days - 1; index >= 0; index--) {
        points.push({
            date: day(index),
            registrations: index % 3,
            plantsAdded: index % 4,
            waterings: index % 7,
            wateringsSkipped: index % 2,
            chatMessages: index % 5,
            photos: index % 2,
            guests: index % 3,
            activeUsers: index % 4,
            visitors: index + 1,
            views: (index + 1) * 2
        })
    }
    return {
        days,
        timezone: 'Europe/Moscow',
        visitsTracked: true,
        userCreatedAtTracked: true,
        startDate: points[0].date,
        endDate: points[points.length - 1].date,
        points
    }
}

const overviewPayload = {
    generatedAt: new Date().toISOString(),
    timezone: 'Europe/Moscow',
    days: 30,
    userCreatedAtTracked: true,
    visitsTracked: true,
    users: { total: 12, newToday: 1, new7d: 4, new30d: 9, newInRange: 9, admins: 2, paying: 1, withPasskey: 3, withPush: 5 },
    plants: { total: 34, active: 30, archived: 4, newToday: 2, new7d: 11, newInRange: 20, avgPerUser: 2.83 },
    waterings: { total: 210, watered: 190, skipped: 20, today: 6, inRange: 120, activeUsers: 8, activePlants: 22 },
    photos: { total: 40, plantsWithPhoto: 18, inRange: 12 },
    chat: { messages: 320, userMessages: 160, sessions: 44, users: 9, today: 5, inRange: 180 },
    visits: { uniqueToday: 21, viewsToday: 60, uniqueInRange: 300, viewsInRange: 900, newInRange: 120, registeredInRange: 40, uniqueTotal: 900, viewsTotal: 2600 },
    guests: { uniqueToday: 5, uniqueInRange: 88, uniqueTotal: 210 },
    sessions: { active: 7, createdInRange: 30, revokedInRange: 4 },
    push: { subscriptions: 9, guestSubscriptions: 1, notifications: 55, notificationsInRange: 20, notificationsRead: 30, broadcasts: 3, broadcastsInRange: 2, usersWithPush: 5 },
    legalConsents: { total: 24, accepted: 24 },
    consents: [
        { type: 'analytics', total: 60, accepted: 41 },
        { type: 'marketing', total: 60, accepted: 12 },
        { type: 'personalization', total: 60, accepted: 30 },
        { type: 'technical', total: 60, accepted: 60 }
    ]
}

const breakdownPayload = {
    days: 30,
    timezone: 'Europe/Moscow',
    visitsTracked: true,
    userCreatedAtTracked: true,
    topSpecies: [{ species: 'Монстера', count: 8 }, { species: 'Не указан', count: 5 }],
    topUsersByPlants: [{ id: 2, email: 'b@example.com', name: 'Иван', username: 'ivan', plants: 9 }],
    topUsersByWaterings: [{ id: 2, email: 'b@example.com', name: 'Иван', username: 'ivan', waterings: 40 }],
    topUsersByChat: [{ id: 3, email: 'c@example.com', name: null, username: 'kate', messages: 22 }],
    wateringsByWeekday: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, count: weekday * 3 })),
    wateringsByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour % 6 })),
    plantsByInterval: [{ intervalDays: 7, count: 20 }],
    consentTypes: [{ type: 'analytics', total: 60, accepted: 41 }],
    registrationsByWeekday: [{ weekday: 1, count: 3 }],
    recentUsers: [
        { id: 2, email: 'b@example.com', name: 'Иван', username: 'ivan', role: 'USER', privilegeLevel: 'free', createdAt: new Date().toISOString() },
        { id: 3, email: 'c@example.com', name: null, username: null, role: 'ADMIN', privilegeLevel: 'premium', createdAt: null }
    ],
    averages: { plantsPerUser: 2.83, wateringsPerUser: 17.5, messagesPerUser: 26.67, photosPerPlant: 1.18 }
}

const visitsPayload = {
    tracked: true,
    from: day(29),
    to: day(0),
    totals: { uniqueVisitors: 300, views: 900, newVisitors: 120, registeredVisitors: 40 },
    days: [
        { day: day(1), uniqueVisitors: 20, views: 55, newVisitors: 8, registeredVisitors: 4 },
        { day: day(0), uniqueVisitors: 21, views: 60, newVisitors: 9, registeredVisitors: 5 }
    ],
    devices: [{ device: 'desktop', visitors: 120, views: 400 }, { device: 'mobile', visitors: 150, views: 460 }, { device: 'unknown', visitors: 30, views: 40 }],
    pages: [{ path: '/', visitors: 200, views: 250 }, { path: '/home', visitors: 60, views: 180 }],
    referrers: [{ host: 'yandex.ru', visitors: 90, views: 200 }, { host: 'прямой заход', visitors: 210, views: 700 }]
}

const usersPayload = {
    items: [
        { id: 2, email: 'b@example.com', name: 'Иван', username: 'ivan', phone: null, role: 'USER', privilegeLevel: 'free', createdAt: new Date().toISOString(), plants: 9, activePlants: 8, waterings: 40, photos: 12, chatMessages: 22, pushSubscriptions: 1, lastActivityAt: new Date().toISOString() },
        { id: 3, email: 'c@example.com', name: null, username: null, role: 'ADMIN', privilegeLevel: 'premium', createdAt: null, plants: 0, activePlants: 0, waterings: 0, photos: 0, chatMessages: 0, pushSubscriptions: 0, lastActivityAt: null }
    ],
    total: 2,
    page: 1,
    limit: 25,
    pages: 1
}

const userDetailPayload = {
    user: { id: 2, email: 'b@example.com', name: 'Иван', username: 'ivan', phone: '+79000000000', bio: null, role: 'USER', privilegeLevel: 'free', createdAt: new Date().toISOString(), userCreatedAtTracked: true },
    stats: { plants: 9, activePlants: 8, waterings: 40, skippedWaterings: 3, photos: 12, chatMessages: 22, chatSessions: 5, pushSubscriptions: 1, passkeys: 1, activeSessions: 2, lastWateringAt: new Date().toISOString(), lastChatAt: null },
    plants: [{ id: 5, name: 'Монстера', species: 'Monstera', location: null, isActive: true, wateringIntervalDays: 7, createdAt: new Date().toISOString(), lastWateredAt: new Date().toISOString(), nextWateringAt: new Date().toISOString(), waterings: 4, photos: 2, mainPhotoUrl: null, user: { id: 2, email: 'b@example.com', username: 'ivan', name: 'Иван' } }],
    waterings: [{ id: 9, plantId: 5, plantName: 'Монстера', userId: 2, userEmail: 'b@example.com', userUsername: 'ivan', action: 'watered', actionAt: new Date().toISOString(), scheduledFor: null, hoursLate: 0, note: null, createdAt: new Date().toISOString() }],
    chat: [{ id: 3, userId: 2, userEmail: 'b@example.com', userUsername: 'ivan', sessionId: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'Привет', inputTokens: 5, outputTokens: 0, error: null, createdAt: new Date().toISOString() }],
    sessions: [{ id: 1, token_type: 'refresh', created_at: new Date().toISOString(), expires_at: new Date().toISOString(), revoked_at: null }],
    passkeys: [{ id: 1, device_name: 'iPhone', created_at: new Date().toISOString(), last_used_at: null }],
    pushSubscriptions: [{ id: 1, user_agent: 'Mozilla', created_at: new Date().toISOString() }],
    legalConsents: [{ id: 1, consent_type: 'privacy_policy', is_accepted: true, document_version: '2.0', accepted_at: new Date().toISOString(), source: 'registration' }],
    cookieConsents: [{ id: 1, consent_type: 'analytics', is_accepted: true, is_revoked: false, accepted_at: new Date().toISOString(), source: 'banner', created_at: new Date().toISOString() }]
}

const plantsPayload = {
    items: [{
        id: 5, name: 'Монстера', species: 'Monstera deliciosa', location: 'Кухня', isActive: true,
        wateringIntervalDays: 7, createdAt: new Date().toISOString(), lastWateredAt: new Date().toISOString(),
        nextWateringAt: new Date().toISOString(), waterings: 4, photos: 2, mainPhotoUrl: '/uploads/plants/abc.jpg',
        user: { id: 2, email: 'b@example.com', username: 'ivan', name: 'Иван' }
    }],
    total: 1, page: 1, limit: 25, pages: 1
}

const wateringsPayload = {
    items: [{
        id: 9, plantId: 5, plantName: 'Монстера', userId: 2, userEmail: 'b@example.com', userUsername: 'ivan',
        action: 'watered', actionAt: new Date().toISOString(), scheduledFor: new Date().toISOString(),
        hoursLate: 0, note: null, createdAt: new Date().toISOString()
    }, {
        id: 10, plantId: 5, plantName: 'Монстера', userId: 2, userEmail: 'b@example.com', userUsername: null,
        action: 'skipped', actionAt: new Date().toISOString(), scheduledFor: null, hoursLate: null, note: null,
        createdAt: new Date().toISOString()
    }],
    total: 2, page: 1, limit: 25, pages: 1,
    summary: { watered: 1, skipped: 1 }
}

const photosPayload = {
    items: [{
        id: 3, plantId: 5, plantName: 'Монстера', userId: 2, userEmail: 'b@example.com', userUsername: 'ivan',
        url: '/uploads/plants/abc.jpg', isMain: true, sortOrder: 0, createdAt: new Date().toISOString()
    }],
    total: 1, page: 1, limit: 24, pages: 1
}

const chatPayload = {
    items: [{
        id: 11, userId: 2, userEmail: 'b@example.com', userUsername: 'ivan',
        sessionId: '11111111-1111-4111-8111-111111111111', role: 'assistant',
        text: 'Поливайте монстеру раз в неделю.', inputTokens: 12, outputTokens: 30, error: null,
        createdAt: new Date().toISOString()
    }],
    total: 1, page: 1, limit: 25, pages: 1
}

const pushPayload = {
    pushConfigured: true,
    subscriptions: { total: 9, users: 5, guests: 1 },
    users: { total: 12 },
    recent: [{
        id: 1, title: 'Новое в «Лейке»', status: 'sent', target_mode: 'all', scheduled_for: null,
        sent_at: new Date().toISOString(), sent_count: 9, failed_count: 0, total_subscriptions: 9,
        created_at: new Date().toISOString()
    }]
}

const mailPayload = {
    mailConfigured: true,
    mailStatus: 'configured',
    mailProblems: [],
    from: 'Лейка <lejka@mail.ru>',
    users: { total: 12, withEmail: 11, withoutEmail: 1 },
    broadcasts: { total: 3, pending: 1, sending: 0, sent: 1, failed: 1, canceled: 0 },
    totals: { sent: 14, failed: 2, skipped: 1 },
    recent: [{
        id: 1, subject: 'Как поливать растения в отпуске', status: 'sent', target_mode: 'all',
        scheduled_for: null, sent_at: new Date().toISOString(), sent_count: 11, failed_count: 0,
        skipped_count: 0, total_recipients: 11, created_at: new Date().toISOString()
    }]
}

const healthPayload = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    deployTarget: 'test',
    redis: 'ok',
    backgroundJobs: true,
    aiCache: { hits: 1, misses: 2 }
}

const dockerPayload = {
    timestamp: new Date().toISOString(),
    containers: [{
        id: 'abc', name: 'ctp_backend', state: 'running', status: 'Up', image: 'backend:latest',
        statsAvailable: true, cpu: 1.2, memory: { usage: 104857600, limit: 536870912, percent: 19.5 },
        network: { rx: 1048576, tx: 524288 }, block: { read: 0, write: 0 }, pids: 12
    }]
}


let mode = 'full'

function zeroOverview() {
    return {
        generatedAt: new Date().toISOString(),
        timezone: 'Europe/Moscow',
        days: 30,
        userCreatedAtTracked: false,
        visitsTracked: false,
        users: { total: 0, newToday: 0, new7d: 0, new30d: 0, newInRange: 0, admins: 0, paying: 0, withPasskey: 0, withPush: 0 },
        plants: { total: 0, active: 0, archived: 0, newToday: 0, new7d: 0, newInRange: 0, avgPerUser: 0 },
        waterings: { total: 0, watered: 0, skipped: 0, today: 0, inRange: 0, activeUsers: 0, activePlants: 0 },
        photos: { total: 0, plantsWithPhoto: 0, inRange: 0 },
        chat: { messages: 0, userMessages: 0, sessions: 0, users: 0, today: 0, inRange: 0 },
        visits: { uniqueToday: 0, viewsToday: 0, uniqueInRange: 0, viewsInRange: 0, newInRange: 0, registeredInRange: 0, uniqueTotal: 0, viewsTotal: 0 },
        guests: { uniqueToday: 0, uniqueInRange: 0, uniqueTotal: 0 },
        sessions: { active: 0, createdInRange: 0, revokedInRange: 0 },
        push: { subscriptions: 0, guestSubscriptions: 0, notifications: 0, notificationsInRange: 0, notificationsRead: 0, broadcasts: 0, broadcastsInRange: 0, usersWithPush: 0 },
        legalConsents: { total: 0, accepted: 0 },
        consents: []
    }
}

function emptyList(limit = 25) {
    return { items: [], total: 0, page: 1, limit, pages: 1 }
}

function route(url) {
    const path = new URL(url).pathname
    const empty = mode === 'empty'

    if (path.endsWith('/users/me')) return { status: 200, data: { id: 1, email: 'admin@example.com', name: 'Админ', role: 'ADMIN' } }
    if (path.includes('/admin/analytics/overview')) return { status: 200, data: empty ? zeroOverview() : overviewPayload }
    if (path.includes('/admin/analytics/timeseries')) {
        return {
            status: 200,
            data: empty
                ? { days: 30, timezone: 'Europe/Moscow', visitsTracked: false, userCreatedAtTracked: false, startDate: day(29), endDate: day(0), points: [] }
                : timeseriesPayload(30)
        }
    }
    if (path.includes('/admin/analytics/breakdown')) {
        return {
            status: 200,
            data: empty
                ? {
                    days: 30, timezone: 'Europe/Moscow', visitsTracked: false, userCreatedAtTracked: false,
                    topSpecies: [], topUsersByPlants: [], topUsersByWaterings: [], topUsersByChat: [],
                    wateringsByWeekday: [], wateringsByHour: [], plantsByInterval: [], consentTypes: [],
                    registrationsByWeekday: [], recentUsers: [],
                    averages: { plantsPerUser: 0, wateringsPerUser: 0, messagesPerUser: 0, photosPerPlant: 0 }
                }
                : breakdownPayload
        }
    }
    if (path.includes('/admin/visits')) {
        return {
            status: 200,
            data: empty
                ? { tracked: false, from: null, to: null, totals: { uniqueVisitors: 0, views: 0, newVisitors: 0, registeredVisitors: 0 }, days: [], devices: [], pages: [], referrers: [] }
                : visitsPayload
        }
    }
    if (path.includes('/admin/users/')) return { status: 200, data: userDetailPayload }
    if (path.includes('/admin/users')) return { status: 200, data: empty ? emptyList() : usersPayload }
    if (path.includes('/admin/plants')) return { status: 200, data: empty ? emptyList() : plantsPayload }
    if (path.includes('/admin/waterings')) return { status: 200, data: empty ? emptyList() : wateringsPayload }
    if (path.includes('/admin/photos')) return { status: 200, data: empty ? { ...emptyList(24) } : photosPayload }
    if (path.includes('/admin/chat')) return { status: 200, data: empty ? emptyList() : chatPayload }
    if (path.includes('/admin/push/overview')) {
        return {
            status: 200,
            data: empty
                ? { pushConfigured: false, subscriptions: { total: 0, users: 0, guests: 0 }, users: { total: 0 }, recent: [] }
                : pushPayload
        }
    }
    if (path.includes('/admin/mail/overview')) {
        return {
            status: 200,
            data: empty
                ? {
                    mailConfigured: false,
                    mailStatus: 'not-configured',
                    mailProblems: [],
                    from: '',
                    users: { total: 0, withEmail: 0, withoutEmail: 0 },
                    broadcasts: { total: 0, pending: 0, sending: 0, sent: 0, failed: 0, canceled: 0 },
                    totals: { sent: 0, failed: 0, skipped: 0 },
                    recent: []
                }
                : mailPayload
        }
    }
    if (path.includes('/system/docker-stats')) {
        if (empty) return { status: 503, data: { error: 'Docker недоступен' } }
        return { status: 200, data: dockerPayload }
    }
    if (path.endsWith('/health')) {
        return {
            status: 200,
            data: empty ? { status: 'ok', timestamp: new Date().toISOString(), redis: 'disabled', backgroundJobs: false, aiCache: null } : healthPayload
        }
    }
    return { status: 404, data: { message: `нет маршрута ${path}` } }
}

const requests = []

globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    requests.push(`${method} ${url}`)
    if (method !== 'GET') return { status: 200, data: { deleted: true, ok: true, user: { role: 'USER' } } }

    const { status, data } = route(String(url))
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => (typeof data === 'string' ? 'text/plain' : 'application/json') },
        json: async () => data,
        text: async () => JSON.stringify(data)
    }
}


console.log('== Графики')
const { lineChart, barChart, hBarChart, donutChart, niceMax } = await import(
    '../admin/js/charts.js'
)

check('niceMax округляет вверх', niceMax(7) === 10 && niceMax(120) === 200 && niceMax(0) === 1)

const line = lineChart({
    series: [
        { name: 'A', color: '#111', points: [{ x: day(2), y: 1 }, { x: day(1), y: 5 }, { x: day(0), y: 3 }] },
        { name: 'B', color: '#222', points: [{ x: day(2), y: 0 }, { x: day(1), y: 2 }, { x: day(0), y: 9 }] }
    ]
})
check('lineChart строит график', line.children.length >= 1)
check('lineChart с пустыми данными не падает', lineChart({ series: [] }).children !== undefined)

const bars = barChart({ items: [{ label: 'a', value: 3 }, { label: 'b', value: 0 }] })
check('barChart строит график', bars.children.length >= 1)
const hbars = hBarChart({ items: [{ label: 'a', value: 3 }] })
check('hBarChart строит строки', hbars.children.length === 1)
const donut = donutChart({ items: [{ label: 'x', value: 5 }, { label: 'y', value: 5 }] })
check('donutChart строит диаграмму', donut.children.length === 2)
check('donutChart с нулями не падает', donutChart({ items: [{ label: 'x', value: 0 }] }).className.includes('chart-empty'))

console.log('\n== Разделы панели')
const views = await import(new URL('../admin/js/views/overview.js', import.meta.url).href)
const visitors = await import(new URL('../admin/js/views/visitors.js', import.meta.url).href)
const users = await import(new URL('../admin/js/views/users.js', import.meta.url).href)
const resources = await import(new URL('../admin/js/views/resources.js', import.meta.url).href)
const mail = await import(new URL('../admin/js/views/mail.js', import.meta.url).href)
const system = await import(new URL('../admin/js/views/system.js', import.meta.url).href)

const allViews = [
    views.overviewView,
    visitors.visitorsView,
    users.usersView,
    resources.plantsView,
    resources.wateringsView,
    resources.photosView,
    resources.chatView,
    mail.mailView,
    system.systemView
]

check('девять разделов объявлены', allViews.length === 9)
check('у всех разделов есть id, заголовок и render', allViews.every(view =>
    typeof view.id === 'string' && typeof view.title === 'string' && typeof view.render === 'function'))
check('идентификаторы уникальны', new Set(allViews.map(view => view.id)).size === allViews.length)

function makeCtx() {
    return {
        days: 30,
        from: day(29),
        to: day(0),
        params: {},
        setParams() {},
        reload() {}
    }
}

for (const currentMode of ['full', 'empty']) {
    mode = currentMode

    for (const view of allViews) {
        const root = makeEl('div')
        try {
            await view.render(root, makeCtx())
            check(`[${currentMode}] раздел «${view.title}» отрисован`, root.children.length >= 1,
                `узлов: ${root.children.length}`)
        } catch (error) {
            check(`[${currentMode}] раздел «${view.title}» отрисован`, false,
                `${error?.name}: ${error?.message}`)
        }
    }
}

console.log('\n== Пользователи: карточка и фильтры')
mode = 'full'
const usersRoot = makeEl('div')
const ctxWithParams = makeCtx()
ctxWithParams.params = { page: '2', q: 'иван', sort: 'plants', order: 'asc' }
try {
    await users.usersView.render(usersRoot, ctxWithParams)
    check('раздел пользователей принимает параметры из адреса', usersRoot.children.length === 2)
} catch (error) {
    check('раздел пользователей принимает параметры из адреса', false, error.message)
}

const { loadInto } = await import(new URL('../admin/js/ui.js', import.meta.url).href)
const errorRoot = makeEl('div')
const failed = await loadInto(errorRoot, () => Promise.reject(new Error('сломалось')), () => makeEl('div'))
check('loadInto показывает ошибку', failed === null && errorRoot.children.length === 1)


function walk(node, visit) {
    visit(node)
    for (const child of node.children || []) {
        if (child && child.nodeType === 1) walk(child, visit)
    }
}

function findButton(root, label) {
    let found = null
    walk(root, node => {
        if (!found && node.tagName === 'BUTTON' && node.textContent === label) found = node
    })
    return found
}

function findNode(root, predicate) {
    let found = null
    walk(root, node => {
        if (!found && predicate(node)) found = node
    })
    return found
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30))

console.log('\n== Интерактив: карточка пользователя')
mode = 'full'
const detailRoot = makeEl('div')
await users.usersView.render(detailRoot, makeCtx())
const detailButton = findButton(detailRoot, 'Карточка')
check('кнопка «Карточка» отрисована', Boolean(detailButton))

if (detailButton) {
    const before = requests.length
    detailButton.click()
    await tick()
    await tick()
    check('карточка запросила данные пользователя',
        requests.slice(before).some(entry => entry.includes('/admin/users/')))
    check('карточка открылась в модальном окне',
        Boolean(findNode(document.body, node => node.textContent?.startsWith('Пользователь #'))))
} else {
    check('карточка запросила данные пользователя', false, 'кнопка не найдена')
    check('карточка открылась в модальном окне', false, 'кнопка не найдена')
}

console.log('\n== Интерактив: удаление с подтверждением')
const deleteRoot = makeEl('div')
await users.usersView.render(deleteRoot, makeCtx())
const deleteButton = findButton(deleteRoot, 'Удалить')
check('кнопка «Удалить» отрисована', Boolean(deleteButton))

if (deleteButton) {
    const before = requests.length
    deleteButton.click()
    await tick()
    const confirmButton = findButton(document.body, 'Удалить навсегда')
    check('диалог подтверждения требует слово УДАЛИТЬ', Boolean(findNode(document.body,
        node => node.textContent?.includes('Введите УДАЛИТЬ'))))
    check('кнопка подтверждения отрисована', Boolean(confirmButton))

    if (confirmButton) {
        check('до ввода слова подтверждение заблокировано', confirmButton.attrs.disabled === '')
        confirmButton.click()
        await tick()
        check('без введённого слова запрос на удаление не ушёл',
            !requests.slice(before).some(entry => entry.startsWith('DELETE')))

        const confirmInput = findNode(document.body, node =>
            node.tagName === 'INPUT' && node.attrs.type === 'text')
        check('поле ввода слова найдено', Boolean(confirmInput))

        if (confirmInput) {
            confirmInput.value = 'УДАЛИТЬ'
            confirmInput.dispatch('input')
            check('после слова кнопка разблокирована', confirmButton.disabled === false)
            confirmButton.click()
            await tick()
            await tick()
            check('подтверждённое удаление ушло на сервер',
                requests.slice(before).some(entry => entry.startsWith('DELETE ')))
        } else {
            check('после слова кнопка разблокирована', false, 'поле не найдено')
            check('подтверждённое удаление ушло на сервер', false, 'поле не найдено')
        }
    } else {
        check('до ввода слова подтверждение заблокировано', false, 'кнопка не найдена')
        check('без введённого слова запрос на удаление не ушёл', false, 'кнопка не найдена')
    }
} else {
    check('диалог подтверждения требует слово УДАЛИТЬ', false, 'кнопка не найдена')
    check('кнопка подтверждения отрисована', false, 'кнопка не найдена')
}

console.log('\n== Оболочка приложения')
const appRoot = document.getElementById('app')
try {
    await import(new URL('../admin/js/app.js', import.meta.url).href)
    await new Promise(resolve => setTimeout(resolve, 50))
    check('app.js отрисовал оболочку', appRoot.children.length >= 1, `узлов: ${appRoot.children.length}`)
    check('запросы к API ушли', requests.length >= 5, requests.slice(0, 3).join(', '))
} catch (error) {
    check('app.js отрисовал оболочку', false, `${error?.name}: ${error?.message}`)
}

console.log(`\n${failures.length ? '❌' : '✅'} Проверок: ${checks}, ошибок: ${failures.length}`)
if (failures.length) console.log(failures.map(name => ` - ${name}`).join('\n'))
process.exit(failures.length ? 1 : 0)
