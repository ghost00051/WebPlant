import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildAiCacheKey,
    getAiCacheStats,
    getAiCacheTtlSeconds,
    getAiChatCacheTtlSeconds,
    isAiCacheEnabled,
    resetAiCacheStats,
    withAiCache
} from './aiCache.js'
import { getRedisKeyPrefix } from '../redis.js'

test('buildAiCacheKey is stable and namespaced', () => {
    const first = buildAiCacheKey('species', { plantName: 'Монстера', model: 'm' })
    const second = buildAiCacheKey('species', { plantName: 'Монстера', model: 'm' })
    const other = buildAiCacheKey('species', { plantName: 'Фикус', model: 'm' })
    const otherNamespace = buildAiCacheKey('chat', { plantName: 'Монстера', model: 'm' })

    assert.equal(first, second)
    assert.notEqual(first, other)
    assert.notEqual(first, otherNamespace)
    assert.match(first, new RegExp(`^${getRedisKeyPrefix()}:ai:species:[0-9a-f]{64}$`))
})

test('buildAiCacheKey does not depend on object key order', () => {
    assert.equal(
        buildAiCacheKey('chat', { a: 1, b: 2 }),
        buildAiCacheKey('chat', { b: 2, a: 1 })
    )
})

test('AI cache TTLs have sane defaults and respect env overrides', () => {
    assert.equal(getAiCacheTtlSeconds(), 7 * 24 * 60 * 60)
    assert.equal(getAiChatCacheTtlSeconds(), 10 * 60)

    process.env.AI_CACHE_TTL_SECONDS = '120'
    process.env.AI_CHAT_CACHE_TTL_SECONDS = 'invalid'
    try {
        assert.equal(getAiCacheTtlSeconds(), 120)
        assert.equal(getAiChatCacheTtlSeconds(), 10 * 60)
    } finally {
        delete process.env.AI_CACHE_TTL_SECONDS
        delete process.env.AI_CHAT_CACHE_TTL_SECONDS
    }
})

test('without Redis the cache is disabled and the call runs once', async () => {
    resetAiCacheStats()
    assert.equal(isAiCacheEnabled(), false)

    let calls = 0
    const options = {
        namespace: 'species',
        payload: { plantName: 'Монстера' },
        call: async () => {
            calls += 1
            return 'Монстера (Monstera deliciosa)'
        }
    }

    const first = await withAiCache(options)
    const second = await withAiCache(options)

    assert.equal(first.cached, false)
    assert.equal(second.cached, false)
    assert.equal(first.value, 'Монстера (Monstera deliciosa)')
    assert.equal(calls, 2)

    const stats = getAiCacheStats()
    assert.equal(stats.hits, 0)
    assert.equal(stats.skipped, 2)
    assert.equal(stats.enabled, false)
})

test('withAiCache requires a callable', async () => {
    await assert.rejects(
        () => withAiCache({ namespace: 'species', payload: {}, call: null }),
        TypeError
    )
})
