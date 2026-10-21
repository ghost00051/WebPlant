import { randomUUID } from 'node:crypto'

const SILENT_PATHS = new Set(['/livez', '/health'])

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/

const MAX_LOG_STRING = 300

const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 5000, Infinity]
const MAX_ROUTES = 100

const httpMetrics = {
    startedAt: new Date().toISOString(),
    total: 0,
    byStatus: Object.create(null),
    byMethod: Object.create(null),
    latencyBuckets: new Array(LATENCY_BUCKETS_MS.length).fill(0),
    routes: new Map()
}

function routeKey(path) {
    return String(path || '').replace(/\/\d+/g, '/:id')
}

function recordMetrics(req, res, durationMs, requestPath) {
    httpMetrics.total += 1
    const status = String(res.statusCode)
    httpMetrics.byStatus[status] = (httpMetrics.byStatus[status] || 0) + 1
    httpMetrics.byMethod[req.method] = (httpMetrics.byMethod[req.method] || 0) + 1

    const bucketIndex = LATENCY_BUCKETS_MS.findIndex(limit => durationMs < limit)
    httpMetrics.latencyBuckets[bucketIndex === -1 ? LATENCY_BUCKETS_MS.length - 1 : bucketIndex] += 1

    const key = routeKey(requestPath)
    if (!httpMetrics.routes.has(key) && httpMetrics.routes.size >= MAX_ROUTES) return
    const route = httpMetrics.routes.get(key) || {
        count: 0,
        errors: 0,
        latencyBuckets: new Array(LATENCY_BUCKETS_MS.length).fill(0)
    }
    route.count += 1
    if (res.statusCode >= 500) route.errors += 1
    const routeBucket = LATENCY_BUCKETS_MS.findIndex(limit => durationMs < limit)
    route.latencyBuckets[routeBucket === -1 ? LATENCY_BUCKETS_MS.length - 1 : routeBucket] += 1
    httpMetrics.routes.set(key, route)
}

function percentileFromBuckets(buckets, total, percentile) {
    if (!total) return null
    const target = Math.ceil(total * percentile)
    let seen = 0
    for (let index = 0; index < buckets.length; index++) {
        seen += buckets[index]
        if (seen >= target) {
            const limit = LATENCY_BUCKETS_MS[index]
            return Number.isFinite(limit) ? limit : LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 2]
        }
    }
    return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 2]
}

export function getHttpMetrics() {
    const routes = [...httpMetrics.routes.entries()]
        .map(([route, data]) => ({
            route,
            count: data.count,
            errors: data.errors,
            p95Ms: percentileFromBuckets(data.latencyBuckets, data.count, 0.95)
        }))
        .sort((a, b) => b.count - a.count)

    return {
        startedAt: httpMetrics.startedAt,
        total: httpMetrics.total,
        byStatus: httpMetrics.byStatus,
        byMethod: httpMetrics.byMethod,
        latency: {
            bucketsMs: LATENCY_BUCKETS_MS.map((limit, index) => ({
                leMs: Number.isFinite(limit) ? limit : null,
                count: httpMetrics.latencyBuckets[index]
            })),
            p50Ms: percentileFromBuckets(httpMetrics.latencyBuckets, httpMetrics.total, 0.5),
            p95Ms: percentileFromBuckets(httpMetrics.latencyBuckets, httpMetrics.total, 0.95),
            p99Ms: percentileFromBuckets(httpMetrics.latencyBuckets, httpMetrics.total, 0.99)
        },
        routes
    }
}

export function resetHttpMetrics() {
    httpMetrics.total = 0
    httpMetrics.byStatus = Object.create(null)
    httpMetrics.byMethod = Object.create(null)
    httpMetrics.latencyBuckets = new Array(LATENCY_BUCKETS_MS.length).fill(0)
    httpMetrics.routes.clear()
}

function truncate(value, limit = MAX_LOG_STRING) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function requestContext(req, res, next) {
    const incoming = req.get('x-request-id')
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID()

    req.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    next()
}

export function accessLog(req, res, next) {
    const startedAt = process.hrtime.bigint()
    const loggedPath = String(req.originalUrl || req.url || '').split('?')[0]

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
        recordMetrics(req, res, durationMs, loggedPath)

        if (SILENT_PATHS.has(loggedPath)) return

        console.log(JSON.stringify({
            level: 'info',
            msg: 'http_request',
            requestId: req.requestId,
            method: req.method,
            path: loggedPath,
            status: res.statusCode,
            durationMs: Math.round(durationMs),
            ip: req.ip
        }))
    })

    next()
}

export function describeErrorForLog(error, req) {
    if (!error) return { message: 'unknown error' }

    const stackLines = typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 6)
        : []

    return {
        requestId: req?.requestId ?? null,
        method: req?.method ?? null,
        path: String(req?.originalUrl || req?.url || req?.path || '').split('?')[0] || null,
        userId: req?.user?.id ?? null,
        name: truncate(error.name || 'Error', 80),
        code: error.code ?? null,
        status: error.status ?? null,
        message: truncate(error.message || ''),
        stack: stackLines
    }
}

export function logError(error, req, label = 'request_failed') {
    console.error(JSON.stringify({
        level: 'error',
        msg: label,
        ...describeErrorForLog(error, req)
    }))
}
