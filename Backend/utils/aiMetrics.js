/**
 * Телеметрия обращений к ИИ.
 *
 * Счётчики живут в Redis по дням (по часовому поясу приложения) и не теряются
 * при перезапуске подов, в отличие от статистики кэша в памяти процесса.
 * Собираем: обращения к модели, ошибки и таймауты, попадания в кэш, токены,
 * задержки и их распределение по корзинам, а также расход дневного бюджета.
 */

import { getRedisKeyPrefix, redisCommand } from '../redis.js'

const METRICS_TTL_SECONDS = 90 * 24 * 60 * 60

export const AI_SCOPES = ['chat', 'species', 'advice', 'time']
export const AI_SCOPE_LABELS = {
    chat: 'Чат',
    species: 'Определение вида',
    advice: 'Частота полива',
    time: 'Время полива'
}

/** Корзины задержки: по ним считаем распределение, не храня каждое значение. */
export const LATENCY_BUCKETS = [
    { id: 'lt1', label: 'до 1 с', maxMs: 1000 },
    { id: 'lt3', label: '1–3 с', maxMs: 3000 },
    { id: 'lt10', label: '3–10 с', maxMs: 10000 },
    { id: 'lt30', label: '10–30 с', maxMs: 30000 },
    { id: 'gt30', label: 'дольше 30 с', maxMs: Infinity }
]

const COUNTER_FIELDS = [
    'requests',
    'errors',
    'timeouts',
    'cache_hits',
    'cache_misses',
    'tokens_in',
    'tokens_out',
    'tokens_cached',
    'latency_ms',
    'latency_count'
]

export function appTimeZone(env = process.env) {
    return env.APP_TIME_ZONE || 'Europe/Moscow'
}

/** День в формате YYYY-MM-DD по часовому поясу приложения. */
export function aiMetricsDay(now = new Date(), timeZone = appTimeZone()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now)
}

export function buildAiMetricsKey(day, { prefix = getRedisKeyPrefix() } = {}) {
    return `${prefix}:ai:metrics:${day}`
}

export function latencyBucketId(latencyMs) {
    const value = Number(latencyMs)
    if (!Number.isFinite(value) || value < 0) return LATENCY_BUCKETS[0].id
    const bucket = LATENCY_BUCKETS.find(item => value < item.maxMs)
    return (bucket || LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]).id
}

function readNumber(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Цена из .env: принимаем и точку, и запятую как разделитель, а также пробелы
 * (0,5 / 0.5 / 1 234,5). Иначе одна опечатка молча превратила бы стоимость в ноль.
 */
export function parsePriceValue(raw) {
    if (raw === undefined || raw === null) return null
    const normalized = String(raw).trim().replace(/[\s\u00A0]/g, '').replace(',', '.')
    if (!normalized) return null
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function readPriceConfig(env = process.env) {
    const input = parsePriceValue(env.AI_PRICE_INPUT_PER_1K)
    const output = parsePriceValue(env.AI_PRICE_OUTPUT_PER_1K)
    if (input === null && output === null) return null
    return {
        currency: env.AI_PRICE_CURRENCY || 'RUB',
        inputPer1k: input ?? 0,
        outputPer1k: output ?? 0,
        // Кешированный вход у Яндекса дешевле обычного; если цена не задана,
        // считаем кешированные токены по цене входа — оценка сверху.
        cachedPer1k: parsePriceValue(env.AI_PRICE_CACHED_PER_1K)
    }
}

export function estimateAiCost(
    { tokensIn = 0, tokensOut = 0, tokensCached = 0 },
    price = readPriceConfig()
) {
    if (!price) return null

    const input = readNumber(tokensIn)
    const output = readNumber(tokensOut)
    // Кешированные токены входят в общее число входных — вычитаем их, чтобы не считать дважды.
    const cached = Math.min(readNumber(tokensCached), input)

    const costIn = price.cachedPer1k === null
        ? (input / 1000) * price.inputPer1k
        : ((input - cached) / 1000) * price.inputPer1k + (cached / 1000) * price.cachedPer1k
    const costOut = (output / 1000) * price.outputPer1k

    return {
        currency: price.currency,
        input: costIn,
        output: costOut,
        cachedTokens: cached,
        cachedPer1k: price.cachedPer1k,
        total: costIn + costOut
    }
}

export function getAiDailyRequestBudget(env = process.env) {
    const parsed = Number.parseInt(env.AI_DAILY_REQUEST_BUDGET, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export function emptyMetricsFields() {
    const fields = {}
    for (const field of COUNTER_FIELDS) fields[field] = 0
    for (const scope of AI_SCOPES) {
        for (const field of COUNTER_FIELDS) fields[`${scope}_${field}`] = 0
    }
    for (const bucket of LATENCY_BUCKETS) {
        fields[`lat_${bucket.id}`] = 0
        for (const scope of AI_SCOPES) fields[`${scope}_lat_${bucket.id}`] = 0
    }
    return fields
}

export function isTimeoutError(error) {
    if (!error) return false
    const code = String(error.code || '')
    const name = String(error.name || '')
    const message = String(error.message || '')
    return code === 'ETIMEDOUT' ||
        name === 'APIConnectionTimeoutError' ||
        /timeout|timed out|истекло время/i.test(message)
}

export async function trackAiCall({
    scope,
    cached = false,
    latencyMs = 0,
    usage = null,
    error = null,
    now = new Date()
} = {}) {
    if (!AI_SCOPES.includes(scope)) return { recorded: false, reason: 'unknown-scope' }

    const day = aiMetricsDay(now)
    const key = buildAiMetricsKey(day)
    const fields = {}
    const add = (field, value) => { fields[field] = (fields[field] || 0) + value }

    if (cached) {
        add('cache_hits', 1)
        add(`${scope}_cache_hits`, 1)
    } else {
        add('cache_misses', 1)
        add(`${scope}_cache_misses`, 1)
        add('requests', 1)
        add(`${scope}_requests`, 1)

        const tokensIn = readNumber(usage?.input_tokens)
        const tokensOut = readNumber(usage?.output_tokens)
        const tokensCached = readNumber(usage?.input_tokens_details?.cached_tokens)
        if (tokensIn > 0) {
            add('tokens_in', tokensIn)
            add(`${scope}_tokens_in`, tokensIn)
        }
        if (tokensOut > 0) {
            add('tokens_out', tokensOut)
            add(`${scope}_tokens_out`, tokensOut)
        }
        if (tokensCached > 0) {
            add('tokens_cached', tokensCached)
            add(`${scope}_tokens_cached`, tokensCached)
        }

        const latency = Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.round(latencyMs) : 0
        if (latency > 0) {
            add('latency_ms', latency)
            add('latency_count', 1)
            add(`${scope}_latency_ms`, latency)
            add(`${scope}_latency_count`, 1)
            add(`lat_${latencyBucketId(latency)}`, 1)
            add(`${scope}_lat_${latencyBucketId(latency)}`, 1)
        }

        if (error) {
            add('errors', 1)
            add(`${scope}_errors`, 1)
            if (isTimeoutError(error)) {
                add('timeouts', 1)
                add(`${scope}_timeouts`, 1)
            }
        }
    }

    const entries = Object.entries(fields)
    const replies = await Promise.all(entries.map(([field, value]) =>
        redisCommand(['HINCRBY', key, field, String(value)])
    ))
    if (replies.some(reply => reply === null)) {
        return { recorded: false, reason: 'redis-error' }
    }
    await redisCommand(['EXPIRE', key, String(METRICS_TTL_SECONDS)])
    return { recorded: true, day, fields }
}

export function summarizeAiMetrics(rawFields = {}) {
    const fields = rawFields || {}
    const totals = {
        requests: readNumber(fields.requests),
        errors: readNumber(fields.errors),
        timeouts: readNumber(fields.timeouts),
        cacheHits: readNumber(fields.cache_hits),
        cacheMisses: readNumber(fields.cache_misses),
        tokensIn: readNumber(fields.tokens_in),
        tokensOut: readNumber(fields.tokens_out),
        tokensCached: readNumber(fields.tokens_cached),
        latencyMs: readNumber(fields.latency_ms),
        latencyCount: readNumber(fields.latency_count)
    }

    const scopes = {}
    for (const scope of AI_SCOPES) {
        scopes[scope] = {
            requests: readNumber(fields[`${scope}_requests`]),
            errors: readNumber(fields[`${scope}_errors`]),
            timeouts: readNumber(fields[`${scope}_timeouts`]),
            cacheHits: readNumber(fields[`${scope}_cache_hits`]),
            cacheMisses: readNumber(fields[`${scope}_cache_misses`]),
            tokensIn: readNumber(fields[`${scope}_tokens_in`]),
            tokensOut: readNumber(fields[`${scope}_tokens_out`]),
            tokensCached: readNumber(fields[`${scope}_tokens_cached`]),
            latencyMs: readNumber(fields[`${scope}_latency_ms`]),
            latencyCount: readNumber(fields[`${scope}_latency_count`])
        }
    }

    const cacheTotal = totals.cacheHits + totals.cacheMisses
    return {
        totals,
        scopes,
        derived: {
            errorRate: totals.requests > 0 ? totals.errors / totals.requests : 0,
            timeoutRate: totals.requests > 0 ? totals.timeouts / totals.requests : 0,
            cacheHitRate: cacheTotal > 0 ? totals.cacheHits / cacheTotal : 0,
            avgLatencyMs: totals.latencyCount > 0 ? totals.latencyMs / totals.latencyCount : 0
        },
        latencyBuckets: LATENCY_BUCKETS.map(bucket => ({
            id: bucket.id,
            label: bucket.label,
            count: readNumber(fields[`lat_${bucket.id}`])
        })),
        cost: estimateAiCost({
            tokensIn: totals.tokensIn,
            tokensOut: totals.tokensOut,
            tokensCached: totals.tokensCached
        })
    }
}

function sumFields(rows) {
    const combined = {}
    for (const row of rows) {
        for (const [field, value] of Object.entries(row?.raw || {})) {
            combined[field] = readNumber(combined[field]) + readNumber(value)
        }
    }
    return combined
}

export async function readAiMetricsRange({ days = 7, now = new Date() } = {}) {
    const safeDays = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 90)
    const today = aiMetricsDay(now)
    const rows = []

    for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
        const date = new Date(`${today}T00:00:00Z`)
        date.setUTCDate(date.getUTCDate() - offset)
        const day = date.toISOString().slice(0, 10)
        const raw = await redisCommand(['HGETALL', buildAiMetricsKey(day)])
        rows.push({ day, raw: raw && typeof raw === 'object' ? raw : {} })
    }

    const budgetLimit = getAiDailyRequestBudget()
    const usedToday = readNumber(rows[rows.length - 1]?.raw?.requests)

    return {
        days: safeDays,
        generatedAt: now.toISOString(),
        summary: summarizeAiMetrics(sumFields(rows)),
        series: rows.map(row => ({ day: row.day, ...summarizeAiMetrics(row.raw) })),
        budget: {
            limit: budgetLimit,
            usedToday,
            remaining: budgetLimit > 0 ? Math.max(0, budgetLimit - usedToday) : null,
            exceeded: budgetLimit > 0 && usedToday >= budgetLimit
        }
    }
}

export async function isAiBudgetExceeded({ now = new Date() } = {}) {
    const limit = getAiDailyRequestBudget()
    if (limit <= 0) return { exceeded: false, limit: 0, usedToday: 0 }

    const day = aiMetricsDay(now)
    const value = await redisCommand(['HGET', buildAiMetricsKey(day), 'requests'])
    if (value === null) return { exceeded: false, limit, usedToday: 0, degraded: true }

    const usedToday = readNumber(value)
    return { exceeded: usedToday >= limit, limit, usedToday }
}
