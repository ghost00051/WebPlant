import test from 'node:test'
import assert from 'node:assert/strict'
import {
    accessLog,
    describeErrorForLog,
    getHttpMetrics,
    requestContext,
    resetHttpMetrics
} from './accessLog.js'

function createRes() {
    const listeners = new Map()
    return {
        headers: {},
        statusCode: 200,
        setHeader(name, value) {
            this.headers[name] = value
        },
        on(event, handler) {
            listeners.set(event, handler)
        },
        finish() {
            const handler = listeners.get('finish')
            if (handler) handler()
        }
    }
}

function createReq(overrides = {}) {
    return {
        method: 'GET',
        originalUrl: '/api/plants',
        path: '/api/plants',
        ip: '127.0.0.1',
        headers: {},
        get(name) {
            return this.headers[name.toLowerCase()]
        },
        ...overrides
    }
}

test('requestContext: генерирует X-Request-Id и кладёт его в req', () => {
    const req = createReq()
    const res = createRes()
    requestContext(req, res, () => {})

    assert.match(req.requestId, /^[0-9a-f-]{36}$/)
    assert.equal(res.headers['X-Request-Id'], req.requestId)
})

test('requestContext: принимает входящий X-Request-Id только в безопасном формате', () => {
    const valid = createReq({ headers: { 'x-request-id': 'abc12345-XYZ' } })
    requestContext(valid, createRes(), () => {})
    assert.equal(valid.requestId, 'abc12345-XYZ')

    const invalid = createReq({ headers: { 'x-request-id': 'bad id with spaces' } })
    requestContext(invalid, createRes(), () => {})
    assert.notEqual(invalid.requestId, 'bad id with spaces')
    assert.match(invalid.requestId, /^[0-9a-f-]{36}$/)
})

test('accessLog: учитывает запросы и считает p95 по бакетам', () => {
    resetHttpMetrics()
    const req = createReq({ originalUrl: '/api/plants/42?secret=1', path: '/api/plants/42' })
    const res = createRes()
    accessLog(req, res, () => {})
    res.statusCode = 500
    res.finish()

    const metrics = getHttpMetrics()
    assert.equal(metrics.total, 1)
    assert.equal(metrics.byStatus['500'], 1)
    assert.equal(metrics.byMethod.GET, 1)
    assert.equal(metrics.routes[0].route, '/api/plants/:id')
    assert.equal(metrics.routes[0].errors, 1)
    assert.ok(metrics.latency.p95Ms >= 0)

    resetHttpMetrics()
    assert.equal(getHttpMetrics().total, 0)
})

test('describeErrorForLog: не тащит тело запроса, SQL и cookie в лог', () => {
    const error = new Error('invalid input syntax for type integer')
    error.body = { password: 'super-secret' }
    error.sql = 'SELECT * FROM users WHERE password = ...'
    error.parameters = ['super-secret']

    const described = describeErrorForLog(error, createReq({ requestId: 'req-1', originalUrl: '/api/plants?password=secret' }))
    const serialized = JSON.stringify(described)

    assert.equal(described.requestId, 'req-1')
    assert.match(described.message, /invalid input syntax/)
    assert.equal(serialized.includes('super-secret'), false)
    assert.equal(serialized.includes('SELECT *'), false)
    assert.equal(serialized.includes('password'), false)
})

test('describeErrorForLog: переживает отсутствие ошибки', () => {
    assert.deepEqual(describeErrorForLog(null, null).message, 'unknown error')
})
