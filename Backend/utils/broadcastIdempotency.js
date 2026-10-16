import { getRedisClient, getRedisKeyPrefix, withTimeout } from '../redis.js'

const COMMAND_TIMEOUT_MS = 1000
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/

export function normalizeIdempotencyKey(value) {
    if (typeof value !== 'string') return null
    const key = value.trim()
    return KEY_PATTERN.test(key) ? key : null
}

function buildIdempotencyRedisKey(channel, key) {
    return `${getRedisKeyPrefix()}:idem:${channel}:${key}`
}

export async function findIdempotentBroadcast(channel, key) {
    if (!key) return null

    const redis = await getRedisClient()
    if (!redis) return null

    try {
        const value = await withTimeout(
            redis.sendCommand(['GET', buildIdempotencyRedisKey(channel, key)]),
            COMMAND_TIMEOUT_MS
        )
        const id = Number.parseInt(typeof value === 'string' ? value : '', 10)
        return Number.isInteger(id) && id > 0 ? id : null
    } catch (error) {
        console.warn('⚠️ Не удалось проверить ключ идемпотентности:', error?.message || error)
        return null
    }
}

export async function rememberIdempotentBroadcast(channel, key, broadcastId, {
    ttlMs = IDEMPOTENCY_TTL_MS
} = {}) {
    if (!key || !broadcastId) return false

    const redis = await getRedisClient()
    if (!redis) return false

    try {
        const reply = await withTimeout(
            redis.sendCommand([
                'SET',
                buildIdempotencyRedisKey(channel, key),
                String(broadcastId),
                'PX',
                String(ttlMs)
            ]),
            COMMAND_TIMEOUT_MS
        )
        return reply === 'OK'
    } catch (error) {
        console.warn('⚠️ Не удалось сохранить ключ идемпотентности:', error?.message || error)
        return false
    }
}

export function formatBroadcastMoment(value) {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}
