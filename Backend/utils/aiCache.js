import { createHash } from 'node:crypto'
import { getRedisKeyPrefix, isRedisConfigured, redisCommand } from '../redis.js'
import { acquireLock, releaseLock } from './distributedLock.js'

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_CHAT_TTL_SECONDS = 10 * 60
const SINGLE_FLIGHT_TTL_MS = 60_000
const SINGLE_FLIGHT_WAIT_ATTEMPTS = 40
const SINGLE_FLIGHT_WAIT_DELAY_MS = 500

const stats = { hits: 0, misses: 0, writes: 0, errors: 0, skipped: 0, joined: 0, stampedes: 0 }

function readTtl(value, fallback) {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null'
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`
    }

    const keys = Object.keys(value)
        .filter(key => value[key] !== undefined)
        .sort()

    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export function getAiCacheTtlSeconds() {
    return readTtl(process.env.AI_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS)
}

export function getAiChatCacheTtlSeconds() {
    return readTtl(process.env.AI_CHAT_CACHE_TTL_SECONDS, DEFAULT_CHAT_TTL_SECONDS)
}

export function isAiCacheEnabled() {
    return isRedisConfigured() && process.env.AI_CACHE_ENABLED !== 'false'
}

export function buildAiCacheKey(namespace, payload) {
    const hash = createHash('sha256')
        .update(stableStringify(payload))
        .digest('hex')
    return `${getRedisKeyPrefix()}:ai:${namespace}:${hash}`
}

export function getAiCacheStats() {
    return { ...stats, enabled: isAiCacheEnabled() }
}

export function resetAiCacheStats() {
    stats.hits = 0
    stats.misses = 0
    stats.writes = 0
    stats.errors = 0
    stats.skipped = 0
    stats.joined = 0
    stats.stampedes = 0
}

export async function readAiCache(key) {
    const raw = await redisCommand(['GET', key])
    if (typeof raw !== 'string') return null

    try {
        return JSON.parse(raw)
    } catch (error) {
        stats.errors++
        if (process.env.REDIS_DEBUG === 'true') {
            console.warn('⚠️ Повреждённое значение в кэше ИИ, игнорирую', key, error?.message || error)
        }
        return null
    }
}

export async function writeAiCache(key, value, ttlSeconds) {
    const payload = JSON.stringify(value)
    const reply = await redisCommand(['SET', key, payload, 'EX', String(ttlSeconds), 'NX'])
    if (reply === 'OK') stats.writes++
    return reply === 'OK'
}

function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

async function waitForCachedValue(key, lockKey = null) {
    for (let attempt = 0; attempt < SINGLE_FLIGHT_WAIT_ATTEMPTS; attempt += 1) {
        await sleep(SINGLE_FLIGHT_WAIT_DELAY_MS)
        const value = await readAiCache(key)
        if (value !== null) return value

        if (lockKey) {
            const locked = await redisCommand(['EXISTS', lockKey])
            if (locked === 0) return null
        }
    }
    return null
}

export async function withAiCache({ namespace, payload, ttlSeconds, call }) {
    if (typeof call !== 'function') {
        throw new TypeError('withAiCache: call должен быть функцией')
    }

    if (!isAiCacheEnabled()) {
        stats.skipped++
        return { value: await call(), cached: false }
    }

    const key = buildAiCacheKey(namespace, payload)
    const cached = await readAiCache(key)

    if (cached !== null) {
        stats.hits++
        return { value: cached, cached: true }
    }

    const effectiveTtl = ttlSeconds ?? getAiCacheTtlSeconds()

    const produce = async () => {
        const value = await call()
        try {
            await writeAiCache(key, value, effectiveTtl)
        } catch (error) {
            stats.errors++
            if (process.env.REDIS_DEBUG === 'true') {
                console.warn('⚠️ Не удалось записать ответ ИИ в кэш:', error?.message || error)
            }
        }
        return value
    }

    if (!isRedisConfigured()) {
        stats.misses++
        return { value: await produce(), cached: false }
    }

    const lock = await acquireLock(`ai-cache:${namespace}:${key.slice(-32)}`, {
        ttlMs: SINGLE_FLIGHT_TTL_MS
    })

    if (lock.acquired) {
        stats.misses++
        try {
            return { value: await produce(), cached: false }
        } finally {
            await releaseLock(lock)
        }
    }

    const shared = await waitForCachedValue(key, lock.key)
    if (shared !== null) {
        stats.joined++
        return { value: shared, cached: true }
    }

    
    stats.stampedes++
    stats.misses++
    return { value: await produce(), cached: false }
}
