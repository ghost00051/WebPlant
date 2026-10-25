import test from 'node:test'
import assert from 'node:assert/strict'
import { Op } from 'sequelize'

import {
    DEFAULT_REMINDER_PUSH_CONCURRENCY,
    DEFAULT_REMINDER_TICK_BATCH_SIZE,
    DEFAULT_REMINDER_TICK_MAX_BATCHES,
    fetchBatchById,
    fetchDuePlantsBatch,
    forEachInChunks,
    iterateActiveDuePlants,
    iterateBatchesById,
    readReminderBatchConfig,
    readReminderPushConcurrency
} from './plantBatching.js'

function fakeModel(rows = [], { key = 'id' } = {}) {
    const calls = []
    return {
        calls,
        async findAll(options) {
            calls.push(options)
            const afterId = Number(options.where[key]?.[Op.gt] ?? 0)
            return rows
                .filter(row => row[key] > afterId)
                .sort((left, right) => left[key] - right[key])
                .slice(0, options.limit)
        }
    }
}

test('readReminderBatchConfig: дефолты 500 растений / 20 батчей', () => {
    assert.deepEqual(readReminderBatchConfig({}), {
        batchSize: DEFAULT_REMINDER_TICK_BATCH_SIZE,
        maxBatches: DEFAULT_REMINDER_TICK_MAX_BATCHES
    })
    assert.equal(DEFAULT_REMINDER_TICK_BATCH_SIZE, 500)
    assert.equal(DEFAULT_REMINDER_TICK_MAX_BATCHES, 20)
})

test('readReminderBatchConfig: env переопределяет и ограничивает значения', () => {
    assert.deepEqual(
        readReminderBatchConfig({
            REMINDER_TICK_BATCH_SIZE: '250',
            REMINDER_TICK_MAX_BATCHES: '4'
        }),
        { batchSize: 250, maxBatches: 4 }
    )

    const clamped = readReminderBatchConfig({
        REMINDER_TICK_BATCH_SIZE: '999999',
        REMINDER_TICK_MAX_BATCHES: '999999'
    })
    assert.equal(clamped.batchSize, 5000)
    assert.equal(clamped.maxBatches, 1000)

    assert.deepEqual(
        readReminderBatchConfig({
            REMINDER_TICK_BATCH_SIZE: 'abc',
            REMINDER_TICK_MAX_BATCHES: '-3'
        }),
        {
            batchSize: DEFAULT_REMINDER_TICK_BATCH_SIZE,
            maxBatches: DEFAULT_REMINDER_TICK_MAX_BATCHES
        }
    )
})

test('readReminderPushConcurrency: дефолт 5, env с клампом', () => {
    assert.equal(readReminderPushConcurrency({}), DEFAULT_REMINDER_PUSH_CONCURRENCY)
    assert.equal(DEFAULT_REMINDER_PUSH_CONCURRENCY, 5)
    assert.equal(readReminderPushConcurrency({ REMINDER_PUSH_CONCURRENCY: '2' }), 2)
    assert.equal(readReminderPushConcurrency({ REMINDER_PUSH_CONCURRENCY: '100' }), 20)
    assert.equal(readReminderPushConcurrency({ REMINDER_PUSH_CONCURRENCY: '0' }), 5)
})

test('fetchDuePlantsBatch: keyset WHERE id > afterId, ORDER BY id, LIMIT', async () => {
    const model = fakeModel([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])

    const rows = await fetchDuePlantsBatch(model, {
        where: { is_active: true },
        afterId: 2,
        batchSize: 2,
        attributes: ['id']
    })

    assert.deepEqual(rows.map(row => row.id), [3, 4])

    const options = model.calls[0]
    assert.equal(options.where.is_active, true)
    assert.equal(options.where.id[Op.gt], 2)
    assert.deepEqual(options.order, [['id', 'ASC']])
    assert.equal(options.limit, 2)
    assert.deepEqual(options.attributes, ['id'])
})

test('fetchDuePlantsBatch: пустой результат и некорректная модель', async () => {
    const model = fakeModel([])
    assert.deepEqual(await fetchDuePlantsBatch(model, { where: {} }), [])

    await assert.rejects(() => fetchDuePlantsBatch(null), /findAll/)
})

test('fetchBatchById: keyset по произвольному монотонному ключу', async () => {
    const model = fakeModel([{ user_id: 1 }, { user_id: 4 }, { user_id: 9 }], { key: 'user_id' })

    const rows = await fetchBatchById(model, {
        where: { morning_summary_enabled: true },
        afterId: 4,
        idColumn: 'user_id',
        batchSize: 5
    })

    assert.deepEqual(rows.map(row => row.user_id), [9])
    const options = model.calls[0]
    assert.equal(options.where.morning_summary_enabled, true)
    assert.equal(options.where.user_id[Op.gt], 4)
    assert.deepEqual(options.order, [['user_id', 'ASC']])
    assert.equal(options.limit, 5)
})

test('iterateBatchesById: обходит страницы по ключу user_id', async () => {
    const model = fakeModel(
        [{ user_id: 2 }, { user_id: 5 }, { user_id: 8 }],
        { key: 'user_id' }
    )
    const batches = []

    const summary = await iterateBatchesById({
        model,
        where: { morning_summary_enabled: true },
        idColumn: 'user_id',
        batchSize: 2,
        onBatch: async page => {
            batches.push(page.map(row => row.user_id))
        }
    })

    assert.deepEqual(batches, [[2, 5], [8]])
    assert.equal(summary.batches, 2)
    assert.equal(summary.plantsProcessed, 3)
    assert.equal(summary.lastId, 8)
    assert.equal(summary.truncated, false)
})

test('iterateActiveDuePlants: обходит все страницы без дублей и пропусков', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }))
    const model = fakeModel(rows)
    const batches = []

    const summary = await iterateActiveDuePlants({
        model,
        where: { is_active: true },
        batchSize: 3,
        maxBatches: 20,
        onBatch: async page => {
            batches.push(page.map(row => row.id))
        }
    })

    assert.deepEqual(batches, [[1, 2, 3], [4, 5, 6], [7]])
    assert.equal(summary.batches, 3)
    assert.equal(summary.plantsProcessed, 7)
    assert.equal(summary.lastId, 7)
    assert.equal(summary.truncated, false)
})

test('iterateActiveDuePlants: maxBatches — предохранитель от зацикливания', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }))
    const model = fakeModel(rows)
    let calls = 0

    const summary = await iterateActiveDuePlants({
        model,
        where: { is_active: true },
        batchSize: 2,
        maxBatches: 3,
        onBatch: async () => {
            calls += 1
        }
    })

    assert.equal(calls, 3)
    assert.equal(summary.batches, 3)
    assert.equal(summary.plantsProcessed, 6)
    assert.equal(summary.lastId, 6)
    assert.equal(summary.truncated, true, 'упёрлись в лимит — остаток пойдёт следующим тиком')
})

test('iterateActiveDuePlants: пустая выборка не вызывает onBatch', async () => {
    const model = fakeModel([])
    let calls = 0

    const summary = await iterateActiveDuePlants({
        model,
        where: { is_active: true },
        onBatch: async () => {
            calls += 1
        }
    })

    assert.equal(calls, 0)
    assert.equal(summary.batches, 0)
    assert.equal(summary.plantsProcessed, 0)
    assert.equal(summary.truncated, false)
})

test('iterateActiveDuePlants: onBatch обязателен, защита от немонотонного id', async () => {
    await assert.rejects(
        () => iterateActiveDuePlants({ model: fakeModel([]), where: {} }),
        /onBatch/
    )

    let served = false
    const brokenModel = {
        findAll: async () => {
            if (served) return []
            served = true
            return [{ id: 5 }, { id: 4 }]
        }
    }
    const summary = await iterateActiveDuePlants({
        model: brokenModel,
        where: {},
        batchSize: 2,
        maxBatches: 5,
        onBatch: async () => {}
    })
    assert.equal(summary.batches, 1, 'после некорректного id обход останавливается')
})

test('forEachInChunks: не превышает конкурентность и обрабатывает все элементы', async () => {
    const items = Array.from({ length: 11 }, (_, index) => index + 1)
    let inFlight = 0
    let maxInFlight = 0
    const seen = []

    const results = await forEachInChunks(items, 3, async (item, index) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        inFlight -= 1
        seen.push({ item, index })
        return item * 2
    })

    assert.ok(maxInFlight <= 3, `конкурентность ${maxInFlight} больше лимита 3`)
    assert.deepEqual(seen.map(entry => entry.item), items)
    assert.deepEqual(seen.map(entry => entry.index), items.map((_, index) => index))
    assert.equal(results.length, items.length)
    assert.ok(results.every(result => result.status === 'fulfilled'))
    assert.deepEqual(results.map(result => result.value), items.map(item => item * 2))
})

test('forEachInChunks: ошибка одного элемента не валит остальные', async () => {
    const results = await forEachInChunks([1, 2, 3, 4], 2, async item => {
        if (item === 2) throw new Error('boom')
        return item
    })

    assert.equal(results.length, 4)
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.match(results[1].reason.message, /boom/)
    assert.equal(results[2].status, 'fulfilled')
    assert.equal(results[3].status, 'fulfilled')
})

test('forEachInChunks: пустой список и worker обязателен', async () => {
    assert.deepEqual(await forEachInChunks([], 5, async () => 1), [])
    await assert.rejects(() => forEachInChunks([1], 5, null), /worker/)
})
