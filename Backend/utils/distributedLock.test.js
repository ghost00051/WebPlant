import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLockKey, resetSkipLogState, withDistributedLock } from './distributedLock.js'
import { getRedisKeyPrefix } from '../redis.js'

test('buildLockKey namespaces lock keys', () => {
    assert.equal(buildLockKey('job:reminder-tick'), `${getRedisKeyPrefix()}:lock:job:reminder-tick`)
})

test('without Redis the task still runs (graceful degradation)', async () => {
    resetSkipLogState()
    let ran = 0

    const outcome = await withDistributedLock('job:test-degraded', { ttlMs: 1000 }, async () => {
        ran += 1
        return 'done'
    })

    assert.equal(outcome.ran, true)
    assert.equal(outcome.result, 'done')
    assert.equal(outcome.degraded, true)
    assert.equal(ran, 1)
})

test('task errors propagate to the caller', async () => {
    await assert.rejects(
        () => withDistributedLock('job:test-error', { ttlMs: 1000 }, async () => {
            throw new Error('boom')
        }),
        /boom/
    )
})

test('withDistributedLock requires a callable task', async () => {
    await assert.rejects(() => withDistributedLock('job:test-invalid', {}, 'not-a-function'), TypeError)
})

test('two processes cannot hold the same lock at once', {
    skip: process.env.REDIS_TEST_URL ? false : 'REDIS_TEST_URL не задан'
}, async () => {
    process.env.REDIS_URL = process.env.REDIS_TEST_URL
    resetSkipLogState()

    const { withDistributedLock: lockWithRedis } = await import('./distributedLock.js')
    const { closeRedis } = await import('../redis.js')
    const name = `job:test-exclusive:${Date.now()}`

    try {
        let releaseHolder
        const holderStarted = new Promise(resolve => { releaseHolder = resolve })

        const holder = lockWithRedis(name, { ttlMs: 5000 }, async () => {
            releaseHolder()
            await new Promise(resolve => setTimeout(resolve, 300))
            return 'holder'
        })

        await holderStarted

        let skippedRan = false
        const contender = await lockWithRedis(name, { ttlMs: 5000 }, async () => {
            skippedRan = true
        })

        assert.equal(contender.ran, false)
        assert.equal(contender.reason, 'locked')
        assert.equal(skippedRan, false)

        const held = await holder
        assert.equal(held.ran, true)
        assert.equal(held.degraded, false)

        const afterRelease = await lockWithRedis(name, { ttlMs: 5000 }, async () => 'again')
        assert.equal(afterRelease.ran, true)
        assert.equal(afterRelease.result, 'again')
    } finally {
        await closeRedis()
        delete process.env.REDIS_URL
    }
})
