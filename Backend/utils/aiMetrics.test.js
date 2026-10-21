import test from 'node:test'
import assert from 'node:assert/strict'

import {
    aiMetricsDay,
    buildAiMetricsKey,
    parsePriceValue,
    estimateAiCost,
    getAiDailyRequestBudget,
    isAiBudgetExceeded,
    isTimeoutError,
    latencyBucketId,
    readAiMetricsRange,
    readLocalBudgetFallback,
    readPriceConfig,
    resetLocalBudgetFallback,
    summarizeAiMetrics,
    trackAiCall
} from './aiMetrics.js'

/** Тесты бюджета работают без Redis: это и есть сценарий «Redis недоступен». */
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

test('aiMetricsDay: день считается по часовому поясу приложения', () => {
    const lateEveningUtc = new Date('2026-10-16T21:30:00Z')
    assert.equal(aiMetricsDay(lateEveningUtc, 'Europe/Moscow'), '2026-10-17')
    assert.equal(aiMetricsDay(lateEveningUtc, 'UTC'), '2026-10-16')
})

test('buildAiMetricsKey: ключ содержит префикс и день', () => {
    assert.equal(
        buildAiMetricsKey('2026-10-16', { prefix: 'webplant' }),
        'webplant:ai:metrics:2026-10-16'
    )
})

test('latencyBucketId: раскладывает задержки по корзинам', () => {
    assert.equal(latencyBucketId(400), 'lt1')
    assert.equal(latencyBucketId(1000), 'lt3')
    assert.equal(latencyBucketId(2500), 'lt3')
    assert.equal(latencyBucketId(9000), 'lt10')
    assert.equal(latencyBucketId(20000), 'lt30')
    assert.equal(latencyBucketId(45000), 'gt30')
    assert.equal(latencyBucketId(undefined), 'lt1')
})

test('getAiDailyRequestBudget: по умолчанию выключен, из env включается', () => {
    assert.equal(getAiDailyRequestBudget({}), 0)
    assert.equal(getAiDailyRequestBudget({ AI_DAILY_REQUEST_BUDGET: '500' }), 500)
    assert.equal(getAiDailyRequestBudget({ AI_DAILY_REQUEST_BUDGET: '0' }), 0)
    assert.equal(getAiDailyRequestBudget({ AI_DAILY_REQUEST_BUDGET: 'abc' }), 0)
})

test('цена из .env: точка, запятая и пробелы понимаются одинаково', () => {
    assert.equal(parsePriceValue('0.5'), 0.5)
    assert.equal(parsePriceValue('0,5'), 0.5)
    assert.equal(parsePriceValue(' 1 234,5 '), 1234.5)
    assert.equal(parsePriceValue('0'), 0)
    assert.equal(parsePriceValue(''), null)
    assert.equal(parsePriceValue('abc'), null)
    assert.equal(parsePriceValue('-1'), null)
    assert.equal(parsePriceValue(undefined), null)
})

test('цена и стоимость: без тарифа стоимость не выдумывается', () => {
    assert.equal(readPriceConfig({}), null)
    assert.equal(estimateAiCost({ tokensIn: 1000, tokensOut: 500 }, null), null)

    const price = readPriceConfig({ AI_PRICE_INPUT_PER_1K: '0.5', AI_PRICE_OUTPUT_PER_1K: '1.5' })
    assert.deepEqual(price, { currency: 'RUB', inputPer1k: 0.5, outputPer1k: 1.5, cachedPer1k: null })

    const cost = estimateAiCost({ tokensIn: 2000, tokensOut: 1000 }, price)
    assert.equal(cost.input, 1)
    assert.equal(cost.output, 1.5)
    assert.equal(cost.total, 2.5)
    assert.equal(cost.currency, 'RUB')
})

test('цена с запятой в .env работает так же, как с точкой', () => {
    const price = readPriceConfig({
        AI_PRICE_INPUT_PER_1K: '0,3',
        AI_PRICE_OUTPUT_PER_1K: '0,5',
        AI_PRICE_CACHED_PER_1K: '0,075'
    })
    assert.deepEqual(price, { currency: 'RUB', inputPer1k: 0.3, outputPer1k: 0.5, cachedPer1k: 0.075 })

    const cost = estimateAiCost({ tokensIn: 2000, tokensOut: 1000 }, price)
    assert.equal(Number(cost.input.toFixed(4)), 0.6)
    assert.equal(Number(cost.output.toFixed(4)), 0.5)
    assert.equal(Number(cost.total.toFixed(4)), 1.1)
})

test('стоимость: кешированный вход считается по своей цене', () => {
    const price = readPriceConfig({
        AI_PRICE_INPUT_PER_1K: '0.3',
        AI_PRICE_OUTPUT_PER_1K: '0.5',
        AI_PRICE_CACHED_PER_1K: '0.075'
    })

    const withCache = estimateAiCost({ tokensIn: 10000, tokensOut: 2000, tokensCached: 8000 }, price)
    assert.equal(Number(withCache.input.toFixed(4)), 1.2)
    assert.equal(Number(withCache.output.toFixed(4)), 1)
    assert.equal(Number(withCache.total.toFixed(4)), 2.2)
    assert.equal(withCache.cachedTokens, 8000)

    const withoutCachedPrice = estimateAiCost(
        { tokensIn: 10000, tokensOut: 2000, tokensCached: 8000 },
        readPriceConfig({ AI_PRICE_INPUT_PER_1K: '0.3', AI_PRICE_OUTPUT_PER_1K: '0.5' })
    )
    assert.equal(Number(withoutCachedPrice.input.toFixed(4)), 3)
    assert.equal(Number(withoutCachedPrice.total.toFixed(4)), 4)

    const clamped = estimateAiCost({ tokensIn: 1000, tokensOut: 0, tokensCached: 5000 }, price)
    assert.equal(clamped.cachedTokens, 1000)
    assert.equal(Number(clamped.input.toFixed(4)), 0.075)
})

test('summarizeAiMetrics: считает доли, среднюю задержку и корзины', () => {
    const summary = summarizeAiMetrics({
        requests: 10,
        errors: 2,
        timeouts: 1,
        cache_hits: 30,
        cache_misses: 10,
        tokens_in: 4000,
        tokens_out: 2000,
        tokens_cached: 3000,
        latency_ms: 12000,
        latency_count: 4,
        lat_lt1: 1,
        lat_lt3: 1,
        lat_lt10: 2,
        chat_requests: 6,
        advice_requests: 4,
        advice_errors: 2
    })

    assert.equal(summary.totals.requests, 10)
    assert.equal(summary.totals.tokensCached, 3000)
    assert.equal(summary.derived.errorRate, 0.2)
    assert.equal(summary.derived.timeoutRate, 0.1)
    assert.equal(summary.derived.cacheHitRate, 0.75)
    assert.equal(summary.derived.avgLatencyMs, 3000)
    assert.equal(summary.scopes.chat.requests, 6)
    assert.equal(summary.scopes.advice.requests, 4)
    assert.equal(summary.scopes.advice.errors, 2)
    assert.deepEqual(
        summary.latencyBuckets.map(bucket => [bucket.id, bucket.count]),
        [['lt1', 1], ['lt3', 1], ['lt10', 2], ['lt30', 0], ['gt30', 0]]
    )
})

test('summarizeAiMetrics: пустые данные не приводят к делению на ноль', () => {
    const summary = summarizeAiMetrics({})
    assert.equal(summary.derived.errorRate, 0)
    assert.equal(summary.derived.cacheHitRate, 0)
    assert.equal(summary.derived.avgLatencyMs, 0)
    assert.equal(summary.cost, null)
})

test('isTimeoutError: узнаёт таймауты провайдера', () => {
    assert.equal(isTimeoutError({ code: 'ETIMEDOUT' }), true)
    assert.equal(isTimeoutError({ name: 'APIConnectionTimeoutError' }), true)
    assert.equal(isTimeoutError({ message: 'Request timed out.' }), true)
    assert.equal(isTimeoutError({ message: 'Connection error' }), false)
    assert.equal(isTimeoutError(null), false)
})

test('trackAiCall: без Redis телеметрия молча пропускается', { skip: Boolean(process.env.REDIS_URL) }, async () => {
    const result = await trackAiCall({ scope: 'chat', latencyMs: 100 })
    assert.equal(result.recorded, false)
})

test('trackAiCall: неизвестный scope не пишется', async () => {
    const result = await trackAiCall({ scope: 'unknown' })
    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'unknown-scope')
})

test('бюджет: при недоступном Redis включается локальный предохранитель', async () => {
    const restore = withoutRedis()
    const savedBudget = process.env.AI_DAILY_REQUEST_BUDGET
    try {
        resetLocalBudgetFallback()
        process.env.AI_DAILY_REQUEST_BUDGET = '2'

        const before = await isAiBudgetExceeded()
        assert.equal(before.exceeded, false, 'пока расход нулевой, бюджет не исчерпан')

        await trackAiCall({ scope: 'chat', latencyMs: 10 })
        await trackAiCall({ scope: 'advice', latencyMs: 10 })
        assert.equal(readLocalBudgetFallback(aiMetricsDay()), 2)

        const after = await isAiBudgetExceeded()
        assert.equal(after.exceeded, true, 'без Redis бюджет не должен открываться бесконечно')
        assert.equal(after.degraded, true)
        assert.equal(after.localFallback, true)
        assert.equal(after.usedToday, 2)
    } finally {
        if (savedBudget === undefined) delete process.env.AI_DAILY_REQUEST_BUDGET
        else process.env.AI_DAILY_REQUEST_BUDGET = savedBudget
        resetLocalBudgetFallback()
        restore()
    }
})

test('бюджет: кэш-хиты не расходуют локальный предохранитель', async () => {
    const restore = withoutRedis()
    const savedBudget = process.env.AI_DAILY_REQUEST_BUDGET
    try {
        resetLocalBudgetFallback()
        process.env.AI_DAILY_REQUEST_BUDGET = '1'

        await trackAiCall({ scope: 'chat', cached: true })
        assert.equal(readLocalBudgetFallback(aiMetricsDay()), 0)

        const budget = await isAiBudgetExceeded()
        assert.equal(budget.exceeded, false)
    } finally {
        if (savedBudget === undefined) delete process.env.AI_DAILY_REQUEST_BUDGET
        else process.env.AI_DAILY_REQUEST_BUDGET = savedBudget
        resetLocalBudgetFallback()
        restore()
    }
})

test('бюджет: выключенный лимит не ограничивает и не считает локально', async () => {
    const restore = withoutRedis()
    const savedBudget = process.env.AI_DAILY_REQUEST_BUDGET
    try {
        resetLocalBudgetFallback()
        delete process.env.AI_DAILY_REQUEST_BUDGET

        await trackAiCall({ scope: 'chat', latencyMs: 5 })
        const budget = await isAiBudgetExceeded()

        assert.equal(budget.limit, 0)
        assert.equal(budget.exceeded, false)
    } finally {
        if (savedBudget !== undefined) process.env.AI_DAILY_REQUEST_BUDGET = savedBudget
        resetLocalBudgetFallback()
        restore()
    }
})

test('readAiMetricsRange: без Redis отдаёт нулевую серию и локальный расход', async () => {
    const restore = withoutRedis()
    try {
        resetLocalBudgetFallback()
        const range = await readAiMetricsRange({ days: 3, now: new Date('2026-10-17T09:00:00Z') })

        assert.equal(range.days, 3)
        assert.equal(range.series.length, 3)
        assert.deepEqual(
            range.series.map(row => row.day),
            ['2026-10-15', '2026-10-16', '2026-10-17']
        )
        assert.equal(range.summary.totals.requests, 0)
        assert.equal(range.budget.localFallbackUsed, 0)
    } finally {
        resetLocalBudgetFallback()
        restore()
    }
})
