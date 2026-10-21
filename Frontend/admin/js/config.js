
const DEFAULT_CONFIG = Object.freeze({
    apiBase: 'https://server.checktheplants.ru/api',
    siteBase: 'https://checktheplants.ru'
})

const ALLOWED_PROD_HOSTS = new Set([
    'checktheplants.ru',
    'www.checktheplants.ru',
    'server.checktheplants.ru'
])

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLoopbackHost(hostname) {
    const host = String(hostname || '').toLowerCase()
    return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
}

function isDevPage() {
    try {
        const { protocol, hostname } = window.location
        if (protocol !== 'http:' && protocol !== 'https:') return false
        return isLoopbackHost(hostname)
    } catch {
        return false
    }
}

function normalizeBase(value) {
    const raw = typeof value === 'string' ? value.trim() : ''
    return raw ? raw.replace(/\/+$/, '') : ''
}

function parseAllowedBase(value) {
    const normalized = normalizeBase(value)
    if (!normalized) return null
    let url
    try {
        url = new URL(normalized)
    } catch {
        return null
    }
    if (url.username || url.password) return null
    if (url.search || url.hash) return null
    const host = url.hostname.toLowerCase()
    if (url.protocol === 'https:' && ALLOWED_PROD_HOSTS.has(host)) return normalized
    if (isDevPage() && (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(host)) {
        return normalized
    }
    return null
}

function parseAllowedApiBase(value) {
    const base = parseAllowedBase(value)
    if (!base) return null
    const path = new URL(base).pathname.replace(/\/+$/, '')
    return path === '/api' ? base : null
}

function parseAllowedSiteBase(value) {
    const base = parseAllowedBase(value)
    if (!base) return null
    const path = new URL(base).pathname.replace(/\/+$/, '')
    return path === '' ? base : null
}

function readStoredConfig() {
    try {
        const raw = window.localStorage.getItem('webplant-admin-config')
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function readQueryConfig() {
    try {
        const params = new URLSearchParams(window.location.search)
        const config = {}
        if (params.get('api')) config.apiBase = params.get('api')
        if (params.get('site')) config.siteBase = params.get('site')
        return config
    } catch {
        return {}
    }
}

const deployedConfig = window.WEBPLANT_ADMIN_CONFIG && typeof window.WEBPLANT_ADMIN_CONFIG === 'object'
    ? window.WEBPLANT_ADMIN_CONFIG
    : {}

const runtimeOverrides = {
    localStorage: readStoredConfig(),
    query: readQueryConfig()
}
const allowRuntimeOverrides = isDevPage()

function resolveBase(key, fallback, validator) {
    if (!allowRuntimeOverrides) {
        for (const source of ['localStorage', 'query']) {
            if (runtimeOverrides[source] && runtimeOverrides[source][key] !== undefined) {
                console.warn(`[admin] ${source}.${key} проигнорирован: переопределения API/site ` +
                    'разрешены только на localhost/127.0.0.1.')
            }
        }
    }
    const candidates = allowRuntimeOverrides
        ? [
            ['query', runtimeOverrides.query],
            ['localStorage', runtimeOverrides.localStorage],
            ['config.local.js', deployedConfig]
        ]
        : [['config.local.js', deployedConfig]]

    for (const [source, sourceConfig] of candidates) {
        const raw = sourceConfig ? sourceConfig[key] : undefined
        if (raw === undefined || raw === null || raw === '') continue
        const allowed = validator(raw)
        if (allowed) return allowed
        console.warn(`[admin] ${source}.${key} отклонён allowlist'ом (${String(raw).slice(0, 120)}), ` +
            `использую ${fallback}.`)
    }
    return fallback
}

export const API_BASE = resolveBase('apiBase', DEFAULT_CONFIG.apiBase, parseAllowedApiBase)
export const SITE_BASE = resolveBase('siteBase', DEFAULT_CONFIG.siteBase, parseAllowedSiteBase)
export const SERVER_BASE = API_BASE.replace(/\/api$/, '')

export const DAY_RANGES = [
    { days: 7, label: '7 дней' },
    { days: 30, label: '30 дней' },
    { days: 90, label: '90 дней' },
    { days: 365, label: 'год' }
]

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const DEVICE_LABELS = {
    desktop: 'Компьютеры',
    mobile: 'Телефоны',
    tablet: 'Планшеты',
    unknown: 'Не определён'
}
