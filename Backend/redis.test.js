import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRedisUrl, withTimeout } from './redis.js'

test('resolveRedisUrl returns null when Redis is not configured', () => {
    assert.equal(resolveRedisUrl({}), null)
    assert.equal(resolveRedisUrl({ REDIS_URL: '   ' }), null)
})

test('resolveRedisUrl prefers explicit REDIS_URL', () => {
    assert.equal(
        resolveRedisUrl({ REDIS_URL: 'redis://cache:6379/2', REDIS_HOST: 'ignored' }),
        'redis://cache:6379/2'
    )
})

test('resolveRedisUrl builds a url from host, port, password and db', () => {
    assert.equal(
        resolveRedisUrl({
            REDIS_HOST: 'redis',
            REDIS_PORT: '6380',
            REDIS_PASSWORD: 'p@ss word',
            REDIS_DB: '1'
        }),
        'redis://default:p%40ss%20word@redis:6380/1'
    )
})

test('resolveRedisUrl falls back to the default port and no credentials', () => {
    assert.equal(resolveRedisUrl({ REDIS_HOST: 'redis' }), 'redis://redis:6379')
})

test('withTimeout resolves fast promises and rejects slow ones', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50), 'ok')
    await assert.rejects(
        () => withTimeout(new Promise(() => {}), 20, 'too slow'),
        /too slow/
    )
})

test('withTimeout without a timeout passes the promise through', async () => {
    assert.equal(await withTimeout(Promise.resolve('passthrough'), 0), 'passthrough')
})
