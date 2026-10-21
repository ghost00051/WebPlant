import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildAiCacheKey,
    getAiCacheStats,
    isAiCacheEnabled,
    resetAiCacheStats,
    stableStringify,
    withAiCache
} from './aiCache.js'

function withoutRedis() {
    const saved = {
        REDIS_URL: process.env.REDIS_URL,
        REDIS_HOST: process.env.REDIS_HOST
    }
    delete process.env.REDIS_URL
    delete process.env.REDIS_HOST
    return () => {
        if (saved.REDIS_URL === undefined) delete process.env.REDIS_URL
        else process.env.REDIS_URL = saved.REDIS_URL
        if (saved.REDIS_HOST === undefined) delete process.env.REDIS_HOST
        else process.env.REDIS_HOST = saved.REDIS_HOST
    }
}

test('stableStringify: порядок ключей не влияет на результат', () => {
    assert.equal(
        stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }),
        stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 })
    )
    assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}')
    assert.equal(stableStringify(null), 'null')
})

test('buildAiCacheKey: одинаковый payload даёт одинаковый ключ, разный — разный', () => {
    const first = buildAiCacheKey('chat', { model: 'm', input: [{ role: 'user', content: 'привет' }] })
    const reordered = buildAiCacheKey('chat', { input: [{ content: 'привет', role: 'user' }], model: 'm' })
    const other = buildAiCacheKey('chat', { model: 'm', input: [{ role: 'user', content: 'пока' }] })

    assert.equal(first, reordered)
    assert.notEqual(first, other)
    assert.match(first, /:ai:chat:[0-9a-f]{64}$/)
    assert.notEqual(first, buildAiCacheKey('advice', { model: 'm', input: [{ role: 'user', content: 'привет' }] }))
})

test('withAiCache без Redis: вызов выполняется один раз и не помечается кэшем', async () => {
    const restore = withoutRedis()
    try {
        resetAiCacheStats()
        assert.equal(isAiCacheEnabled(), false)

        let calls = 0
        const result = await withAiCache({
            namespace: 'chat',
            payload: { a: 1 },
            ttlSeconds: 60,
            call: async () => {
                calls += 1
                return { text: 'ответ' }
            }
        })

        assert.deepEqual(result, { value: { text: 'ответ' }, cached: false })
        assert.equal(calls, 1)
        assert.equal(getAiCacheStats().skipped, 1)
        assert.equal(getAiCacheStats().writes, 0)
    } finally {
        restore()
    }
})

test('withAiCache: ошибка вызова не подменяется и не кэшируется', async () => {
    const restore = withoutRedis()
    try {
        resetAiCacheStats()
        let calls = 0

        await assert.rejects(
            () => withAiCache({
                namespace: 'chat',
                payload: { a: 1 },
                call: async () => {
                    calls += 1
                    throw new Error('модель упала')
                }
            }),
            /модель упала/
        )

        assert.equal(calls, 1)
        assert.equal(getAiCacheStats().writes, 0, 'неуспешный ответ не должен попадать в кэш')
    } finally {
        restore()
    }
})

test('withAiCache: передача call обязательна', async () => {
    await assert.rejects(
        () => withAiCache({ namespace: 'chat', payload: {}, call: null }),
        /call должен быть функцией/
    )
})
