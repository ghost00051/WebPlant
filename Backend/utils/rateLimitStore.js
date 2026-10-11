import { RedisStore } from 'rate-limit-redis'
import { getRedisKeyPrefix, isRedisConfigured, redisCommandStrict } from '../redis.js'

export function createRateLimitStore(prefix) {
    if (!isRedisConfigured()) return undefined

    return new RedisStore({
        prefix: `${getRedisKeyPrefix()}:rl:${prefix}:`,
        sendCommand: (...args) => redisCommandStrict(args, { timeoutMs: 1000 })
    })
}

export function rateLimitStoreOptions(prefix, extra = {}) {
    const store = createRateLimitStore(prefix)
    return store ? { store, passOnStoreError: true, ...extra } : { passOnStoreError: true, ...extra }
}
