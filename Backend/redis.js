import { createClient } from 'redis'

const DEFAULT_PORT = 6379
const DEFAULT_COMMAND_TIMEOUT_MS = 500
const DEFAULT_CONNECT_TIMEOUT_MS = 3000
const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_BREAKER_COOLDOWN_MS = 30_000

function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveRedisUrl(env = process.env) {
    const explicit = env.REDIS_URL?.trim()
    if (explicit) return explicit

    const host = env.REDIS_HOST?.trim()
    if (!host) return null

    const port = readPositiveInt(env.REDIS_PORT, DEFAULT_PORT)
    const password = env.REDIS_PASSWORD?.trim()
    const username = env.REDIS_USERNAME?.trim()
    const db = env.REDIS_DB?.trim()

    const credentials = password
        ? `${encodeURIComponent(username || 'default')}:${encodeURIComponent(password)}@`
        : ''

    return `redis://${credentials}${host}:${port}${db ? `/${db}` : ''}`
}

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || 'ctp'
const COMMAND_TIMEOUT_MS = readPositiveInt(process.env.REDIS_COMMAND_TIMEOUT_MS, DEFAULT_COMMAND_TIMEOUT_MS)
const CONNECT_TIMEOUT_MS = readPositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS)
const FAILURE_THRESHOLD = readPositiveInt(process.env.REDIS_FAILURE_THRESHOLD, DEFAULT_FAILURE_THRESHOLD)
const BREAKER_COOLDOWN_MS = readPositiveInt(process.env.REDIS_BREAKER_COOLDOWN_MS, DEFAULT_BREAKER_COOLDOWN_MS)
const DEBUG = process.env.REDIS_DEBUG === 'true'

let client = null
let clientUrl = null
let connecting = null
let consecutiveFailures = 0
let breakerOpenUntil = 0
let lastError = null

function log(...args) {
    console.log('🧠 Redis:', ...args)
}

function warn(...args) {
    console.warn('⚠️ Redis:', ...args)
}

export function isRedisConfigured() {
    return Boolean(resolveRedisUrl())
}

export function getRedisKeyPrefix() {
    return KEY_PREFIX
}

export function isRedisBreakerOpen() {
    return Date.now() < breakerOpenUntil
}

export function getRedisLastError() {
    return lastError
}

export function describeRedisStatus() {
    if (!resolveRedisUrl()) return 'disabled'
    if (client?.isReady) return 'ok'
    return 'unavailable'
}

function noteFailure(reason) {
    consecutiveFailures += 1
    lastError = reason
    if (DEBUG) warn(`сбой #${consecutiveFailures}: ${reason}`)

    if (consecutiveFailures >= FAILURE_THRESHOLD && !isRedisBreakerOpen()) {
        breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS
        warn(`Redis недоступен (${reason}); приостанавливаю обращения на ${Math.round(BREAKER_COOLDOWN_MS / 1000)} с`)
    }
}

function noteSuccess() {
    if (consecutiveFailures > 0) {
        log('соединение восстановлено')
    }
    consecutiveFailures = 0
    breakerOpenUntil = 0
    lastError = null
}

function createRedisClient(url) {
    const redisClient = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
            connectTimeout: CONNECT_TIMEOUT_MS,
            keepAlive: true,
            reconnectStrategy: retries => Math.min(500 * 2 ** Math.min(retries, 6), 30_000)
        }
    })

    redisClient.on('error', error => {
        noteFailure(error?.code || error?.message || String(error))
    })
    redisClient.on('ready', () => {
        noteSuccess()
        log('подключён')
    })
    redisClient.on('end', () => {
        if (DEBUG) log('соединение закрыто')
    })

    return redisClient
}

export async function getRedisClient() {
    const url = resolveRedisUrl()
    if (!url) return null
    if (isRedisBreakerOpen()) return null
    if (client?.isReady && clientUrl === url) return client

    if (client && clientUrl !== url) {
        await closeRedis()
    }

    if (!client) {
        client = createRedisClient(url)
        clientUrl = url
    }

    if (!connecting) {
        connecting = client
            .connect()
            .catch(error => {
                noteFailure(error?.code || error?.message || String(error))
                return null
            })
            .finally(() => {
                connecting = null
            })
    }

    try {
        await connecting
    } catch (error) {
        noteFailure(error?.code || error?.message || String(error))
        return null
    }

    return client?.isReady ? client : null
}

export function withTimeout(promise, timeoutMs, message = 'Redis command timed out') {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return promise

    let timer
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs)
            timer.unref?.()
        })
    ])
}

export async function redisCommandStrict(args, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    const redisClient = await getRedisClient()
    if (!redisClient) {
        throw new Error('Redis недоступен')
    }

    try {
        return await withTimeout(redisClient.sendCommand(args), timeoutMs)
    } catch (error) {
        noteFailure(error?.code || error?.message || String(error))
        throw error
    }
}

export async function redisCommand(args, options) {
    try {
        const result = await redisCommandStrict(args, options)
        noteSuccess()
        return result
    } catch (error) {
        if (DEBUG) warn(`команда ${args?.[0]} не выполнена:`, error?.message || error)
        return null
    }
}

export async function pingRedis() {
    if (!resolveRedisUrl()) return false
    const reply = await redisCommand(['PING'])
    return reply === 'PONG'
}

export async function closeRedis() {
    if (!client) return
    const closing = client
    client = null
    clientUrl = null
    connecting = null
    try {
        if (closing.isOpen) await closing.quit()
    } catch (error) {
        if (DEBUG) warn('не удалось корректно закрыть соединение:', error?.message || error)
    }
}

const initialUrl = resolveRedisUrl()
if (initialUrl) {
    log(`настроен (${initialUrl.replace(/\/\/[^@]*@/, '//***@')})`)
} else {
    log('не задан — кэш ИИ, распределённые локи и общий rate-limit отключены')
}
