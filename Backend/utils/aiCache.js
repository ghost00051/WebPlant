import { createHash } from 'node:crypto'
import { getRedisKeyPrefix, isRedisConfigured, redisCommand } from '../redis.js'

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_CHAT_TTL_SECONDS = 10 * 60

const stats = { hits: 0, misses: 0, writes: 0, errors: 0, skipped: 0 }

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

    stats.misses++
    const value = await call()

    try {
        await writeAiCache(key, value, ttlSeconds ?? getAiCacheTtlSeconds())
    } catch (error) {
        stats.errors++
        if (process.env.REDIS_DEBUG === 'true') {
            console.warn('⚠️ Не удалось записать ответ ИИ в кэш:', error?.message || error)
        }
    }

    return { value, cached: false }
}
