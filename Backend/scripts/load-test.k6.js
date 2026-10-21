import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5000'
const AUTH_COOKIE = __ENV.AUTH_COOKIE || ''
const SCENARIO = (__ENV.SCENARIO || 'load').toLowerCase()

const rateLimited = new Rate('rate_limited')
const serverErrors = new Rate('server_errors')
const plantsLatency = new Trend('plants_latency_ms', true)

const scenarios = SCENARIO === 'soak'
    ? {
        soak: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '30m',
            preAllocatedVUs: 20,
            maxVUs: 100
        }
    }
    : {
        load: {
            executor: 'ramping-arrival-rate',
            startRate: 100,
            timeUnit: '1s',
            preAllocatedVUs: 50,
            maxVUs: 300,
            stages: [
                { target: 100, duration: '1m' },
                { target: 300, duration: '2m' },
                { target: 500, duration: '1m' },
                { target: 500, duration: '2m' }
            ]
        }
    }

export const options = {
    scenarios,
    thresholds: {
        http_req_failed: ['rate<0.02'],
        server_errors: ['rate<0.01'],
        http_req_duration: ['p(95)<800', 'p(99)<2000'],
        plants_latency_ms: ['p(95)<500']
    },
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max']
}

function headers() {
    const result = { 'Content-Type': 'application/json' }
    if (AUTH_COOKIE) result.Cookie = AUTH_COOKIE
    return result
}

export default function () {
    const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } })
    check(health, { 'health 200': r => r.status === 200 })

    if (!AUTH_COOKIE) {
        sleep(0.05)
        return
    }

    const plants = http.get(`${BASE_URL}/api/plants`, {
        headers: headers(),
        tags: { name: 'plants_list' }
    })
    plantsLatency.add(plants.timings.duration)
    rateLimited.add(plants.status === 429)
    serverErrors.add(plants.status >= 500)
    check(plants, {
        'plants: 200 или 429': r => r.status === 200 || r.status === 429
    })

    if (plants.status === 200) {
        const list = plants.json()
        const first = Array.isArray(list) ? list[0] : null
        if (first && first.id) {
            const detail = http.get(`${BASE_URL}/api/plants/${first.id}`, {
                headers: headers(),
                tags: { name: 'plant_detail' }
            })
            serverErrors.add(detail.status >= 500)
        }
    }

    sleep(0.1)
}
