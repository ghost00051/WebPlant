import { RedisStore } from 'rate-limit-redis'
import { getRedisKeyPrefix, isRedisConfigured, redisCommandStrict } from '../redis.js'

const WARN_INTERVAL_MS = 60_000
const lastWarnAt = new Map()

function warnThrottled(scope, message) {
    const now = Date.now()
    if (now - (lastWarnAt.get(scope) || 0) < WARN_INTERVAL_MS) return
    lastWarnAt.set(scope, now)
    console.warn(`⚠️ rate-limit (${scope}): ${message}`)
}

function resetScriptCache(store) {
    try {
        store.incrementScriptSha = undefined
        store.getScriptSha = undefined
    } catch {
    }
}


export function createResilientStore(prefix) {
    const store = new RedisStore({
        prefix: `${getRedisKeyPrefix()}:rl:${prefix}:`,
        sendCommand: (...args) => redisCommandStrict(args, { timeoutMs: 1000 })
    })

    const init = store.init.bind(store)
    const increment = store.increment.bind(store)

    store.init = async options => {
        try {
            await init(options)
        } catch (error) {
            resetScriptCache(store)
            warnThrottled(prefix, `Redis недоступен при инициализации, лимит временно без Redis (${error?.message || error})`)
        }
    }

    store.increment = async key => {
        try {
            return await increment(key)
        } catch (error) {
            try {
                resetScriptCache(store)
                await init({ windowMs: store.windowMs })
                return await increment(key)
            } catch (retryError) {
                warnThrottled(prefix, `Redis недоступен, запрос пропущен без лимита (${retryError?.message || retryError})`)
                return { totalHits: 1, resetTime: new Date(Date.now() + 60_000) }
            }
        }
    }

    return store
}

export function createRateLimitStore(prefix) {
    if (!isRedisConfigured()) return undefined
    return createResilientStore(prefix)
}

export function rateLimitStoreOptions(prefix, extra = {}) {
    const store = createRateLimitStore(prefix)
    return store ? { store, passOnStoreError: true, ...extra } : { passOnStoreError: true, ...extra }
}

export function resetRateLimitWarnings() {
    lastWarnAt.clear()
}
