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
    averages: { plantsPerUser: 2.83, wateringsPerUser: 17.5, messagesPerUser: 26.67, photosPerPlant: 1.18 },
    utmSources: [
        { source: 'yandex', medium: 'cpc', campaign: 'plants-autumn', visitors: 120 },
        { source: 'telegram', medium: 'social', campaign: 'care-guide', visitors: 60 },
        { source: 'vk', medium: 'social', campaign: null, visitors: 25 }
    ]
}

const productMetricsItems = [
    {
        id: 'ttfv', label: 'TTFV — время до первой ценности', priority: 'P0',
        horizon: '1 месяц', target: '≤ 60 с', status: 'measured', value: 48, unit: 'seconds',
        display: '48 с', detail: 'Медиана от регистрации до первой ценности',
        source: 'события', targetMet: true
    },
    {
        id: 'activation', label: 'Активация', priority: 'P0',
        horizon: '1 месяц', target: '≥ 60%', status: 'measured', value: 62.5, unit: 'percent',
        display: '62,5%', detail: 'Регистрация с растением в первый день',
        source: 'события', targetMet: true
    },
    {
        id: 'plants2', label: 'Второе растение', priority: 'P0',
        horizon: '3 месяца', target: '≥ 40%', status: 'measured', value: 34.2, unit: 'percent',
        display: '34,2%', detail: 'Пользователи со вторым растением за 7 дней',
        source: 'события', targetMet: false
    },
    {
        id: 'd1', label: 'D1 retention', priority: 'P1',
        horizon: '1 месяц', target: '≥ 35%', status: 'measured', value: 41, unit: 'percent',
        display: '41%', detail: 'Возврат на следующий день после регистрации',
        source: 'когорты', targetMet: true
    },
    {
        id: 'd7', label: 'D7 retention', priority: 'P1',
        horizon: '3 месяца', target: '≥ 20%', status: 'measured', value: 18, unit: 'percent',
        display: '18%', detail: 'Возврат на 7-й день после регистрации',
        source: 'когорты', targetMet: false
    },
    {
        id: 'd30', label: 'D30 retention', priority: 'P1',
        horizon: '6 месяцев', target: '≥ 12%', status: 'partial', value: 9.4, unit: 'percent',
        display: '9,4%', detail: 'Когорты с полным окном 30 дней',
        source: 'когорты', targetMet: null
    },
    {
        id: 'push_ctr', label: 'Push CTR', priority: 'P1',
        horizon: '1 месяц', target: '≥ 10%', status: 'partial', value: 8.1, unit: 'percent',
        display: '8,1%', detail: 'Переходы из push-уведомлений',
        source: 'события', targetMet: null
    },
    {
        id: 'returns_no_push', label: 'Возвраты без push', priority: 'P2',
        horizon: '3 месяца', target: '≥ 25%', status: 'unavailable', value: null, unit: 'percent',
        display: '—', detail: 'Возвраты пользователей без push-подписки',
        source: 'события', targetMet: null
    },
    {
        id: 'ai_usage', label: 'Использование AI-чата', priority: 'P1',
        horizon: '3 месяца', target: '≥ 30%', status: 'measured', value: 27, unit: 'percent',
        display: '27%', detail: 'Доля активных пользователей AI-чата',
        source: 'события', targetMet: false
    },
    {
        id: 'ai_cost', label: 'Стоимость AI', priority: 'P1',
        horizon: '6 месяцев', target: '≤ 15 ₽', status: 'measured', value: 12.4, unit: 'rub',
        display: '12,4 ₽', detail: 'Средняя стоимость AI на активного пользователя',
        source: 'биллинг', targetMet: true
    },
    {
        id: 'premium', label: 'Конверсия в Premium', priority: 'P0',
        horizon: '6 месяцев', target: '≥ 5%', status: 'measured', value: 3.2, unit: 'percent',
        display: '3,2%', detail: 'Доля пользователей с Premium',
        source: 'users', targetMet: false
    },
    {
        id: 'share_organic', label: 'Доля органического трафика', priority: 'P2',
        horizon: '6 месяцев', target: '≥ 50%', status: 'partial', value: 46, unit: 'percent',
        display: '46%', detail: 'Визиты без платного трафика',
        source: 'визиты', targetMet: null
    }
]

const emptyMetricStatuses = [
    'unavailable', 'unavailable', 'unavailable', 'partial', 'unavailable',
    'unavailable', 'unavailable', 'unavailable', 'measured', 'unavailable',
    'measured', 'partial'
]

function emptyProductMetrics() {
    return {
        items: productMetricsItems.map((item, index) => ({
            ...item,
            status: emptyMetricStatuses[index],
            value: null,
            display: '—',
            targetMet: null
        })),
        summary: {
            total: productMetricsItems.length,
            measured: emptyMetricStatuses.filter(status => status === 'measured').length,
            partial: emptyMetricStatuses.filter(status => status === 'partial').length,
            unavailable: emptyMetricStatuses.filter(status => status === 'unavailable').length
        }
    }
}

const productPayload = {
    generatedAt: new Date().toISOString(),
    timezone: 'Europe/Moscow',
    days: 30,
    eventsTracked: true,
    usersCreatedAtTracked: true,
    activity: {
        dau: 12,
        wau: 45,
        mau: 120,
        activeUsers: 90,
        newUsers: 22,
        eventsToday: 140,
        eventsInRange: 3200
    },
    funnel: {
        registered: 200,
        plantCreated: 150,
        wateringMarked: 110,
        pushSubscribed: 40,
        rates: { plantCreated: 75, wateringMarked: 55, pushSubscribed: 20 }
    },
    retention: [
        { cohort: day(35), cohortLabel: '01.09', size: 40, d1: 20, d7: 12, d30: 6, d1Rate: 50, d7Rate: 30, d30Rate: 15 },
        { cohort: day(28), cohortLabel: '08.09', size: 30, d1: 15, d7: 9, d30: 3, d1Rate: 50, d7Rate: 30, d30Rate: 10 },
        { cohort: day(21), cohortLabel: '15.09', size: 25, d1: 10, d7: 5, d30: 2, d1Rate: 40, d7Rate: 20, d30Rate: 8 }
    ],
    events: [
        { event: 'landing_view', count: 1200, users: 300 },
        { event: 'register', count: 200, users: 200 },
        { event: 'plant_created', count: 180, users: 150 },
        { event: 'watering_marked', count: 900, users: 110 },
        { event: 'chat_message', count: 500, users: 60 },
        { event: 'push_subscribed', count: 40, users: 40 }
    ],
    push: { notifications: 120, clicks: 30, ctr: 25, clickedToday: 4 },
    metrics: {
        items: productMetricsItems,
        summary: { total: 12, measured: 8, partial: 3, unavailable: 1 }
    }
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
    summary: {
        available: true,
        ok: false,
        total: 4,
        running: 2,
        stopped: 1,
        unhealthy: 0,
        restarting: 1,
        healthy: 2,
        problems: 2
    },
    containers: [{
        id: 'a'.repeat(64), name: 'ctp_backend', state: 'running', status: 'Up 2 days (healthy)',
        image: 'backend:latest', service: 'backend', healthStatus: 'healthy', restartCount: 0,
        startedAt: new Date(now - 2 * 86400000).toISOString(), uptimeSeconds: 172800,
        exitCode: null, oomKilled: false, error: null, problem: null, problemLevel: 'ok',
        statsAvailable: true, cpu: 1.2, memory: { usage: 104857600, limit: 536870912, percent: 19.5 },
        network: { rx: 1048576, tx: 524288 }, block: { read: 0, write: 0 }, pids: 12
    }, {
        id: 'b'.repeat(64), name: 'ctp_worker', state: 'restarting', status: 'Restarting (1) 3 seconds ago',
        image: 'backend:latest', service: 'worker', healthStatus: 'none', restartCount: 3,
        startedAt: null, uptimeSeconds: null, exitCode: null, oomKilled: false, error: null,
        problem: 'Перезапускается (3 перезапусков)', problemLevel: 'warn',
        statsAvailable: false, cpu: null, memory: { usage: null, limit: null, percent: null },
        network: { rx: null, tx: null }, block: { read: null, write: null }, pids: null
    }, {
        id: 'c'.repeat(64), name: 'ctp_redis', state: 'exited', status: 'Exited (1) 5 minutes ago',
        image: 'redis:7', service: 'redis', healthStatus: 'none', restartCount: 5,
        startedAt: null, uptimeSeconds: null, exitCode: 1, oomKilled: false, error: null,
        problem: 'Остановлен: код выхода 1', problemLevel: 'error',
        statsAvailable: false, cpu: null, memory: { usage: null, limit: null, percent: null },
        network: { rx: null, tx: null }, block: { read: null, write: null }, pids: null
    }, {
        id: 'd'.repeat(64), name: 'ctp_proxy', state: 'running', status: 'Up 2 days (healthy)',
        image: 'docker-socket-proxy:latest', service: 'docker-socket-proxy', healthStatus: 'healthy',
        restartCount: 0, startedAt: new Date(now - 2 * 86400000).toISOString(), uptimeSeconds: 172800,
        exitCode: null, oomKilled: false, error: null, problem: null, problemLevel: 'ok',
        statsAvailable: true, cpu: 0.3, memory: { usage: 20971520, limit: 536870912, percent: 3.9 },
        network: { rx: 1048576, tx: 1048576 }, block: { read: 0, write: 0 }, pids: 6
    }]
}

const dockerLogsPayload = {
    id: 'a'.repeat(64),
    name: 'ctp_backend',
    tail: 100,
    logs: 'server started\nGET /health 200\nGET /api/plants 200'
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

function emptyProductPayload() {
    return {
        generatedAt: new Date().toISOString(),
        timezone: 'Europe/Moscow',
        days: 30,
        eventsTracked: false,
        usersCreatedAtTracked: false,
        activity: { dau: 0, wau: 0, mau: 0, activeUsers: 0, newUsers: 0, eventsToday: 0, eventsInRange: 0 },
        funnel: {
            registered: 0,
            plantCreated: 0,
            wateringMarked: 0,
            pushSubscribed: 0,
            rates: { plantCreated: 0, wateringMarked: 0, pushSubscribed: 0 }
        },
        retention: [],
        events: [],
        push: { notifications: 0, clicks: 0, ctr: 0, clickedToday: 0 },
        metrics: emptyProductMetrics()
    }
}

function noMetricsProductPayload() {
    const payload = emptyProductPayload()
    delete payload.metrics
    return payload
}

function route(url) {
    const path = new URL(url).pathname
    const empty = mode === 'empty'

    if (path.endsWith('/users/me')) return { status: 200, data: { id: 1, email: 'admin@example.com', name: 'Админ', role: 'ADMIN' } }
    if (path.includes('/admin/analytics/overview')) return { status: 200, data: empty ? zeroOverview() : overviewPayload }
    if (path.includes('/admin/product/analytics')) {
        if (mode === 'nometrics') return { status: 200, data: noMetricsProductPayload() }
        return { status: 200, data: empty ? emptyProductPayload() : productPayload }
    }
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
    if (path.includes('/system/docker-stats/') && path.endsWith('/logs')) {
        if (empty) {
            return {
                status: 503,
                data: {
                    available: false,
                    reason: 'disabled',
                    message: 'Docker stats выключены: DOCKER_STATS_ENABLED=false (обычно так в Kubernetes)'
                }
            }
        }
        return { status: 200, data: dockerLogsPayload }
    }
    if (path.includes('/system/docker-stats')) {
        if (empty) {
            return {
                status: 503,
                data: {
                    available: false,
                    reason: 'disabled',
                    message: 'Docker stats выключены: DOCKER_STATS_ENABLED=false (обычно так в Kubernetes)'
                }
            }
        }
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
const product = await import(new URL('../admin/js/views/product.js', import.meta.url).href)
const visitors = await import(new URL('../admin/js/views/visitors.js', import.meta.url).href)
const users = await import(new URL('../admin/js/views/users.js', import.meta.url).href)
const resources = await import(new URL('../admin/js/views/resources.js', import.meta.url).href)
const ai = await import(new URL('../admin/js/views/ai.js', import.meta.url).href)
const system = await import(new URL('../admin/js/views/system.js', import.meta.url).href)

const allViews = [
    views.overviewView,
    product.productView,
    visitors.visitorsView,
    users.usersView,
    resources.plantsView,
    resources.wateringsView,
    resources.photosView,
    resources.chatView,
    ai.aiView,
    system.systemView
]

check('десять разделов объявлены', allViews.length === 10)
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

const { loadInto, table } = await import(new URL('../admin/js/ui.js', import.meta.url).href)
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

function collectText(node, parts = []) {
    if (!node) return parts
    if (node.nodeType === 3) {
        parts.push(String(node.text ?? ''))
        return parts
    }
    if (node.textContent) parts.push(String(node.textContent))
    for (const child of node.children || []) collectText(child, parts)
    return parts
}

function hasText(root, needle) {
    return collectText(root).join('\n').includes(needle)
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30))

console.log('\n== Продукт: DAU/WAU/MAU, воронка и retention')
mode = 'full'
const productRoot = makeEl('div')
try {
    await product.productView.render(productRoot, makeCtx())
    check('продукт: запрос /admin/product/analytics ушёл',
        requests.some(entry => entry.includes('/admin/product/analytics?days=30')))
    check('продукт: карточки DAU/WAU/MAU',
        ['DAU', 'WAU', 'MAU'].every(label =>
            Boolean(findNode(productRoot, node => node.textContent === label))))
    check('продукт: воронка активации со всеми этапами',
        hasText(productRoot, 'Зарегистрировались') &&
        hasText(productRoot, 'Добавили растение') &&
        hasText(productRoot, 'Отметили полив') &&
        hasText(productRoot, 'Подписались на push'))
    check('продукт: retention-таблица с когортами',
        hasText(productRoot, 'Удержание по когортам') &&
        hasText(productRoot, '01.09') &&
        hasText(productRoot, '08.09'))
    check('продукт: топ событий с названиями',
        hasText(productRoot, 'landing_view') &&
        hasText(productRoot, 'watering_marked'))
    check('продукт: push CTR отрисован', Boolean(findNode(productRoot, node => node.textContent === 'Push CTR')))
    const metricsTable = findNode(productRoot, node =>
        node.getAttribute?.('aria-label') === 'Метрики продукта')
    const metricsBody = metricsTable ? findNode(metricsTable, node => node.tagName === 'TBODY') : null
    check('продукт: карточка «Метрики продукта» с таблицей',
        hasText(productRoot, 'Метрики продукта') && Boolean(metricsTable))
    check('продукт: 12 строк метрик',
        Boolean(metricsBody) && metricsBody.children.length === 12,
        metricsBody ? `строк: ${metricsBody.children.length}` : 'таблица не найдена')
    check('продукт: ключевые метрики TTFV, Push CTR, Конверсия в Premium',
        Boolean(metricsTable) &&
        hasText(metricsTable, 'TTFV — время до первой ценности') &&
        hasText(metricsTable, 'Push CTR') &&
        hasText(metricsTable, 'Конверсия в Premium'))
    check('продукт: статусы «в цели» и «ниже цели»',
        Boolean(metricsTable) &&
        hasText(metricsTable, 'в цели') &&
        hasText(metricsTable, 'ниже цели'))
    check('продукт: подпись «измеряется 8 из 12»',
        hasText(productRoot, 'измеряется 8 из 12'))
} catch (error) {
    check('продукт: раздел отрисован', false, `${error?.name}: ${error?.message}`)
}

mode = 'empty'
const emptyProductRoot = makeEl('div')
try {
    await product.productView.render(emptyProductRoot, makeCtx())
    check('продукт: пустые данные не ломают рендер', emptyProductRoot.children.length >= 1)
    check('продукт: предупреждение о сборе событий',
        Boolean(findNode(emptyProductRoot, node =>
            node.textContent?.includes('События начнут собираться после обновления сайта'))))
    check('продукт: карточка метрик в пустом режиме',
        hasText(emptyProductRoot, 'Метрики продукта') &&
        hasText(emptyProductRoot, 'нет данных'))
} catch (error) {
    check('продукт: пустые данные не ломают рендер', false, `${error?.name}: ${error?.message}`)
}

mode = 'nometrics'
const noMetricsRoot = makeEl('div')
try {
    await product.productView.render(noMetricsRoot, makeCtx())
    check('продукт: без поля metrics карточка показывает пустое состояние',
        hasText(noMetricsRoot, 'Метрики продукта') &&
        hasText(noMetricsRoot, 'Метрики появятся после накопления событий'))
} catch (error) {
    check('продукт: без поля metrics карточка показывает пустое состояние', false,
        `${error?.name}: ${error?.message}`)
}
mode = 'full'

console.log('\n== Посетители: UTM-источники')
const utmRoot = makeEl('div')
try {
    await visitors.visitorsView.render(utmRoot, makeCtx())
    check('посетители: карточка UTM-источников из breakdown',
        hasText(utmRoot, 'UTM-источники') &&
        hasText(utmRoot, 'plants-autumn') &&
        hasText(utmRoot, 'yandex'))
} catch (error) {
    check('посетители: карточка UTM-источников из breakdown', false, `${error?.name}: ${error?.message}`)
}
mode = 'empty'
const emptyUtmRoot = makeEl('div')
try {
    await visitors.visitorsView.render(emptyUtmRoot, makeCtx())
    check('посетители: без UTM карточка не показывается',
        !findNode(emptyUtmRoot, node => node.textContent === 'UTM-источники'))
} catch (error) {
    check('посетители: без UTM карточка не показывается', false, `${error?.name}: ${error?.message}`)
}
mode = 'full'

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

console.log('\n== Интерактив: контейнеры и логи')
mode = 'full'
const systemRoot = makeEl('div')
await system.systemView.render(systemRoot, makeCtx())
check('раздел сервера показывает карточки контейнеров',
    Boolean(findNode(systemRoot, node => node.textContent === 'Всего контейнеров')) &&
    Boolean(findNode(systemRoot, node => node.textContent === 'Проблемы')))
check('notice перечисляет проблемные контейнеры с причиной',
    Boolean(findNode(systemRoot, node => node.textContent?.includes('ctp_redis — Остановлен: код выхода 1'))))

const logsButton = findButton(systemRoot, 'Логи')
check('кнопка «Логи» отрисована', Boolean(logsButton))
if (logsButton) {
    const before = requests.length
    logsButton.click()
    await tick()
    await tick()
    check('кнопка «Логи» запросила /system/docker-stats/:id/logs',
        requests.slice(before).some(entry => entry.includes('/system/docker-stats/') && entry.includes('/logs')))
    check('диалог показал содержимое логов',
        Boolean(findNode(document.body, node => node.textContent?.includes('server started'))))
    const closeButton = findButton(document.body, 'Закрыть')
    check('в диалоге логов есть кнопка «Закрыть»', Boolean(closeButton))
    if (closeButton) closeButton.click()
} else {
    check('кнопка «Логи» запросила /system/docker-stats/:id/logs', false, 'кнопка не найдена')
    check('диалог показал содержимое логов', false, 'кнопка не найдена')
    check('в диалоге логов есть кнопка «Закрыть»', false, 'кнопка не найдена')
}

mode = 'empty'
const emptySystemRoot = makeEl('div')
await system.systemView.render(emptySystemRoot, makeCtx())
check('при недоступном Docker показывается объяснение причины',
    Boolean(findNode(emptySystemRoot, node => node.textContent?.includes('DOCKER_STATS_ENABLED=false'))))
mode = 'full'

console.log('\n== Оболочка приложения')
const appRoot = document.getElementById('app')
try {
    await import(new URL('../admin/js/app.js', import.meta.url).href)
    await new Promise(resolve => setTimeout(resolve, 400))
    check('app.js отрисовал оболочку', appRoot.children.length >= 1, `узлов: ${appRoot.children.length}`)
    check('запросы к API ушли', requests.length >= 5, requests.slice(0, 3).join(', '))
} catch (error) {
    check('app.js отрисовал оболочку', false, `${error?.name}: ${error?.message}`)
}

console.log('\n== Безопасность и доступность')
const format = await import(new URL('../admin/js/format.js', import.meta.url).href)
check('CSV: формула с = экранирована апострофом', format.csvCell('=1+1') === "'=1+1")
check('CSV: формула с @ экранирована апострофом', format.csvCell('@SUM(A1)') === "'@SUM(A1)")
check('CSV: число не превращается в текст', format.csvCell(-5) === '-5' && format.csvCell(42) === '42')
check('CSV: обычный текст не меняется', format.csvCell('Монстера') === 'Монстера')
check('email в списках маскируется', format.maskEmail('b@example.com') === 'b***@example.com')
check('маска не ломает строку без @', format.maskEmail('без-почты') === 'без-почты')

const scopedTable = table({ columns: [{ key: 'a', label: 'Колонка A' }], rows: [{ a: 1 }] })
const headCell = findNode(scopedTable, node => node.tagName === 'TH')
check('th имеет scope=col', headCell?.getAttribute('scope') === 'col')
const tableRegion = findNode(scopedTable, node => node.getAttribute?.('role') === 'region')
check('обёртка таблицы доступна с клавиатуры и названа',
    Boolean(tableRegion) && tableRegion.getAttribute('tabindex') === '0' &&
    Boolean(tableRegion.getAttribute('aria-label')))

const titledChart = lineChart({
    title: 'Тестовый график',
    series: [{ name: 'A', color: '#111', points: [{ x: '2026-01-01', y: 1 }] }],
    table: { columns: [{ label: 'Дата', value: point => point.x }, { label: 'Значение', value: point => point.y }], rows: [{ x: '2026-01-01', y: 1 }] }
})
const chartSvg = findNode(titledChart, node => node.tagName === 'SVG')
check('SVG-график имеет доступное имя', chartSvg?.getAttribute('aria-label') === 'Тестовый график')
check('у графика есть кнопка «Показать таблицей»',
    Boolean(findNode(titledChart, node => node.tagName === 'BUTTON' && node.textContent === 'Показать таблицей')))
check('данные графика продублированы таблицей',
    Boolean(findNode(titledChart, node => node.tagName === 'TABLE')))

console.log(`\n${failures.length ? '❌' : '✅'} Проверок: ${checks}, ошибок: ${failures.length}`)
if (failures.length) console.log(failures.map(name => ` - ${name}`).join('\n'))
process.exit(failures.length ? 1 : 0)
