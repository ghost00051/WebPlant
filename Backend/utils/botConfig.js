import { timingSafeEqual } from 'node:crypto'

export const BOT_CHANNELS = Object.freeze(['telegram', 'max'])

export const BOT_CHANNEL_TITLES = Object.freeze({
    telegram: 'Telegram',
    max: 'MAX'
})

export const DEFAULT_LINK_CODE_TTL_MINUTES = 15
export const MIN_LINK_CODE_TTL_MINUTES = 1
export const MAX_LINK_CODE_TTL_MINUTES = 24 * 60

export const TELEGRAM_API_BASE_DEFAULT = 'https://api.telegram.org'
export const MAX_API_BASE_DEFAULT = 'https://platform-api.max.ru'

export const MAX_UPDATE_TYPES = Object.freeze([
    'message_created',
    'bot_started',
    'bot_stopped',
    'dialog_removed'
])

export const WEBHOOK_HEADER = Object.freeze({
    telegram: 'x-telegram-bot-api-secret-token',
    max: 'x-max-bot-api-secret'
})

function readEnv(name) {
    const value = process.env[name]
    return typeof value === 'string' ? value.trim() : ''
}

function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '')
}

function readBool(name, fallback = false) {
    const value = readEnv(name).toLowerCase()
    if (!value) return fallback
    if (['1', 'true', 'yes', 'on'].includes(value)) return true
    if (['0', 'false', 'no', 'off'].includes(value)) return false
    return fallback
}

function readPositiveInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = readEnv(name)
    if (!raw) return fallback
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
    return parsed
}

export function normalizeChannel(value) {
    if (typeof value !== 'string') return null
    const normalized = value.trim().toLowerCase()
    return BOT_CHANNELS.includes(normalized) ? normalized : null
}

export function isKnownChannel(value) {
    return normalizeChannel(value) !== null
}

export function channelTitle(channel) {
    const normalized = normalizeChannel(channel)
    return normalized ? BOT_CHANNEL_TITLES[normalized] : 'Мессенджер'
}

export function isBotsEnabled() {
    return readBool('BOTS_ENABLED', false)
}

export function isWebhookEnabled() {
    return readBool('BOT_WEBHOOK_ENABLED', false)
}

export function isPollingEnabled() {
    return readBool('BOT_POLLING_ENABLED', false)
}

export function getFrontendUrl() {
    const configured = readEnv('FRONTEND_URL')
        .split(',')
        .map(value => stripTrailingSlash(value.trim()))
        .find(Boolean)
    return configured || 'http://localhost:3000'
}

export function getOpenAppUrl() {
    return `${getFrontendUrl()}/home`
}

export function getPublicBaseUrl() {
    const configured = stripTrailingSlash(readEnv('BOT_PUBLIC_BASE_URL'))
    return configured || getFrontendUrl()
}

export function getWebhookPath(channel) {
    const normalized = normalizeChannel(channel)
    return `/api/bots/${normalized || channel}/webhook`
}

export function getWebhookUrl(channel) {
    return `${getPublicBaseUrl()}${getWebhookPath(channel)}`
}

export function getLinkCodeTtlMinutes() {
    return readPositiveInt('BOT_LINK_CODE_TTL_MINUTES', DEFAULT_LINK_CODE_TTL_MINUTES, {
        min: MIN_LINK_CODE_TTL_MINUTES,
        max: MAX_LINK_CODE_TTL_MINUTES
    })
}

export function getChannelConfig(channel) {
    const normalized = normalizeChannel(channel)
    if (!normalized) return null

    if (normalized === 'telegram') {
        const token = readEnv('TELEGRAM_BOT_TOKEN')
        return {
            channel: normalized,
            title: BOT_CHANNEL_TITLES.telegram,
            token,
            configured: Boolean(token),
            username: readEnv('TELEGRAM_BOT_USERNAME') || null,
            apiBase: stripTrailingSlash(readEnv('TELEGRAM_BOT_API_BASE')) || TELEGRAM_API_BASE_DEFAULT,
            webhookSecret: readEnv('TELEGRAM_BOT_WEBHOOK_SECRET') || null
        }
    }

    const token = readEnv('MAX_BOT_TOKEN')
    return {
        channel: normalized,
        title: BOT_CHANNEL_TITLES.max,
        token,
        configured: Boolean(token),
        username: readEnv('MAX_BOT_USERNAME') || null,
        apiBase: stripTrailingSlash(readEnv('MAX_BOT_API_BASE')) || MAX_API_BASE_DEFAULT,
        webhookSecret: readEnv('MAX_BOT_WEBHOOK_SECRET') || null
    }
}

export function isChannelConfigured(channel) {
    return Boolean(getChannelConfig(channel)?.configured)
}

export function getConfiguredChannels() {
    return BOT_CHANNELS.filter(channel => isChannelConfigured(channel))
}

export function buildBotUrl(channel, username) {
    const normalized = normalizeChannel(channel)
    const name = typeof username === 'string' ? username.trim().replace(/^@/, '') : ''
    if (!normalized || !name) return null
    return normalized === 'telegram'
        ? `https://t.me/${name}`
        : `https://max.ru/${name}`
}

export function buildDeepLink(channel, username, payload) {
    const base = buildBotUrl(channel, username)
    if (!base) return null
    const value = typeof payload === 'string' ? payload.trim() : ''
    if (!value) return base
    return `${base}?start=${encodeURIComponent(value)}`
}

export function verifyWebhookSecret(channel, headerValue) {
    const normalized = normalizeChannel(channel)
    if (!normalized) return { ok: false, reason: 'unknown_channel' }
    const config = getChannelConfig(normalized)
    if (!config?.webhookSecret) return { ok: false, reason: 'not_configured' }
    if (config.webhookSecret.startsWith('CHANGE_ME')) return { ok: false, reason: 'not_configured' }
    if (typeof headerValue !== 'string' || headerValue.length === 0) {
        return { ok: false, reason: 'missing' }
    }
    const expected = Buffer.from(config.webhookSecret, 'utf8')
    const actual = Buffer.from(headerValue, 'utf8')
    if (expected.length !== actual.length) return { ok: false, reason: 'mismatch' }
    return timingSafeEqual(expected, actual)
        ? { ok: true }
        : { ok: false, reason: 'mismatch' }
}

export function describeBotConfigProblems() {
    const problems = []
    if (!isBotsEnabled()) problems.push('BOTS_ENABLED выключен')
    for (const channel of BOT_CHANNELS) {
        const config = getChannelConfig(channel)
        if (!config.configured) problems.push(`${config.title}: не задан токен`)
        if (isWebhookEnabled() && !config.webhookSecret) {
            problems.push(`${config.title}: не задан секрет вебхука`)
        }
    }
    return problems
}


export const HTTP_TIMEOUT_MS = 10_000
export const INFO_CACHE_TTL_MS = 10 * 60 * 1000
export const ERROR_CACHE_TTL_MS = 30 * 1000
export const MAX_RETRY_DELAY_MS = 2_000
export const DEFAULT_RETRY_DELAY_MS = 500

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

export class BotApiError extends Error {
    constructor(message, {
        channel = 'telegram',
        status = null,
        retryable = false,
        retryAfterMs = null,
        code = null
    } = {}) {
        super(message)
        this.name = 'BotApiError'
        this.channel = channel
        this.status = status
        this.retryable = retryable
        this.retryAfterMs = retryAfterMs
        this.code = code
    }
}

export function isRetryableStatus(status) {
    const code = Number(status)
    return Number.isInteger(code) && RETRYABLE_STATUS_CODES.has(code)
}

export function redactToken(text, token) {
    const value = String(text ?? '')
    if (!token) return value
    return value.split(token).join('***')
}

export function trimErrorMessage(error, { token = null, maxLength = 200 } = {}) {
    const raw = error?.message ?? error ?? 'unknown error'
    return redactToken(String(raw).replace(/\s+/g, ' ').trim(), token).slice(0, maxLength)
}

export function truncateBotText(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function defaultSleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

export function safeSecretEqual(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') return false
    if (!expected || !actual) return false
    const left = Buffer.from(expected, 'utf8')
    const right = Buffer.from(actual, 'utf8')
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
}
