import test from 'node:test'
import assert from 'node:assert/strict'
import { createResilientStore, resetRateLimitWarnings } from './rateLimitStore.js'

function failingStore() {
    resetRateLimitWarnings()
    const store = createResilientStore('test-failing')
    store.sendCommand = async () => {
        throw new Error('Redis недоступен')
    }
    return store
}

test('createResilientStore: неудачная инициализация не бросает исключение', async () => {
    const store = failingStore()
    await assert.doesNotReject(() => store.init({ windowMs: 60_000 }))
})

test('createResilientStore: increment при недоступном Redis не бросает и пропускает запрос', async () => {
    const store = failingStore()
    await store.init({ windowMs: 60_000 })
    const result = await store.increment('user:1')
    assert.equal(result.totalHits, 1)
    assert.ok(result.resetTime instanceof Date)
})

test('createResilientStore: после восстановления Redis лимит снова работает', async () => {
    resetRateLimitWarnings()
    const store = createResilientStore('test-recovery')
    let calls = 0
    store.sendCommand = async () => {
        calls++
        if (calls <= 2) throw new Error('Redis недоступен')
        return [7, 60_000]
    }
    await store.init({ windowMs: 60_000 })
    const first = await store.increment('user:2')
    assert.equal(typeof first.totalHits, 'number')
    await store.init({ windowMs: 60_000 })
    const second = await store.increment('user:2')
    assert.equal(second.totalHits, 7)
})
