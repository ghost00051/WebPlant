import { randomUUID } from 'node:crypto'
import { getRedisClient, getRedisKeyPrefix, withTimeout } from '../redis.js'

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
`

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`

const LOCK_TIMEOUT_MS = 1000
const SKIP_LOG_INTERVAL_MS = 5 * 60 * 1000
const skipLogTimestamps = new Map()

export function buildLockKey(name) {
    return `${getRedisKeyPrefix()}:lock:${name}`
}

function shouldLogSkip(name) {
    const now = Date.now()
    const last = skipLogTimestamps.get(name) || 0
    if (now - last < SKIP_LOG_INTERVAL_MS) return false
    skipLogTimestamps.set(name, now)
    return true
}

function startRenewal(lock, ttlMs) {
    if (!lock.redis || !lock.token) return () => {}

    const interval = Math.max(1000, Math.floor(ttlMs / 3))
    const timer = setInterval(async () => {
        try {
            await withTimeout(
                lock.redis.sendCommand(['EVAL', RENEW_SCRIPT, '1', lock.key, lock.token, String(ttlMs)]),
                LOCK_TIMEOUT_MS
            )
        } catch (error) {
            if (process.env.REDIS_DEBUG === 'true') {
                console.warn('⚠️ Не удалось продлить блокировку', lock.key, error?.message || error)
            }
        }
    }, interval)

    timer.unref?.()
    return () => clearInterval(timer)
}

export async function acquireLock(name, { ttlMs = 60_000 } = {}) {
    const key = buildLockKey(name)
    const redis = await getRedisClient()

    if (!redis) {
        return { acquired: true, token: null, key, redis: null, degraded: true }
    }

    const token = randomUUID()

    try {
        const reply = await withTimeout(
            redis.sendCommand(['SET', key, token, 'NX', 'PX', String(ttlMs)]),
            LOCK_TIMEOUT_MS
        )

        if (reply === 'OK') {
            return { acquired: true, token, key, redis, degraded: false }
        }

        return { acquired: false, token: null, key, redis, degraded: false }
    } catch (error) {
        console.warn(
            `⚠️ Блокировка «${name}» недоступна (${error?.message || error}); ` +
            'выполняю задачу без распределённого лока'
        )
        return { acquired: true, token: null, key, redis: null, degraded: true }
    }
}

export async function releaseLock(lock) {
    if (!lock?.redis || !lock.token) return false

    try {
        const reply = await withTimeout(
            lock.redis.sendCommand(['EVAL', RELEASE_SCRIPT, '1', lock.key, lock.token]),
            LOCK_TIMEOUT_MS
        )
        return reply === 1
    } catch (error) {
        if (process.env.REDIS_DEBUG === 'true') {
            console.warn('⚠️ Не удалось освободить блокировку', lock.key, error?.message || error)
        }
        return false
    }
}

export async function withDistributedLock(name, { ttlMs = 60_000, onSkip } = {}, task) {
    if (typeof task !== 'function') {
        throw new TypeError('withDistributedLock: task должен быть функцией')
    }

    const lock = await acquireLock(name, { ttlMs })

    if (!lock.acquired) {
        if (shouldLogSkip(name)) {
            console.log(`⏳ Задача «${name}» уже выполняется другим экземпляром — пропускаю`)
        }
        if (typeof onSkip === 'function') await onSkip()
        return { ran: false, reason: 'locked' }
    }

    const stopRenewal = startRenewal(lock, ttlMs)

    try {
        const result = await task()
        return { ran: true, result, degraded: lock.degraded }
    } finally {
        stopRenewal()
        await releaseLock(lock)
    }
}

export function resetSkipLogState() {
    skipLogTimestamps.clear()
}
