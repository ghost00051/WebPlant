import { Op } from 'sequelize'

export const DEFAULT_REMINDER_TICK_BATCH_SIZE = 500
export const DEFAULT_REMINDER_TICK_MAX_BATCHES = 20
export const DEFAULT_REMINDER_PUSH_CONCURRENCY = 5

const MAX_REMINDER_TICK_BATCH_SIZE = 5000
const MAX_REMINDER_TICK_BATCHES = 1000
const MAX_REMINDER_PUSH_CONCURRENCY = 20

function normalizePositiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed < 1) return fallback
    return Math.min(parsed, max)
}

export function readReminderBatchConfig(env = process.env) {
    return {
        batchSize: normalizePositiveInt(
            env.REMINDER_TICK_BATCH_SIZE,
            DEFAULT_REMINDER_TICK_BATCH_SIZE,
            MAX_REMINDER_TICK_BATCH_SIZE
        ),
        maxBatches: normalizePositiveInt(
            env.REMINDER_TICK_MAX_BATCHES,
            DEFAULT_REMINDER_TICK_MAX_BATCHES,
            MAX_REMINDER_TICK_BATCHES
        )
    }
}

export function readReminderPushConcurrency(env = process.env) {
    return normalizePositiveInt(
        env.REMINDER_PUSH_CONCURRENCY,
        DEFAULT_REMINDER_PUSH_CONCURRENCY,
        MAX_REMINDER_PUSH_CONCURRENCY
    )
}

function assertFindableModel(model) {
    if (!model || typeof model.findAll !== 'function') {
        throw new TypeError('plantBatching: model должен поддерживать findAll()')
    }
}

export async function fetchBatchById(model, {
    where = {},
    afterId = 0,
    idColumn = 'id',
    batchSize = DEFAULT_REMINDER_TICK_BATCH_SIZE,
    attributes
} = {}) {
    assertFindableModel(model)

    const limit = normalizePositiveInt(batchSize, DEFAULT_REMINDER_TICK_BATCH_SIZE, MAX_REMINDER_TICK_BATCH_SIZE)
    const options = {
        where: { ...where, [idColumn]: { [Op.gt]: afterId } },
        order: [[idColumn, 'ASC']],
        limit
    }
    if (attributes) options.attributes = attributes

    const rows = await model.findAll(options)
    return Array.isArray(rows) ? rows : []
}

export async function fetchDuePlantsBatch(model, options = {}) {
    return fetchBatchById(model, { ...options, idColumn: 'id' })
}

export async function iterateBatchesById({
    model,
    where = {},
    idColumn = 'id',
    batchSize = DEFAULT_REMINDER_TICK_BATCH_SIZE,
    maxBatches = DEFAULT_REMINDER_TICK_MAX_BATCHES,
    attributes,
    onBatch
} = {}) {
    if (typeof onBatch !== 'function') {
        throw new TypeError('iterateBatchesById: onBatch должен быть функцией')
    }

    const size = normalizePositiveInt(batchSize, DEFAULT_REMINDER_TICK_BATCH_SIZE, MAX_REMINDER_TICK_BATCH_SIZE)
    const limit = normalizePositiveInt(maxBatches, DEFAULT_REMINDER_TICK_MAX_BATCHES, MAX_REMINDER_TICK_BATCHES)

    const summary = { batches: 0, plantsProcessed: 0, truncated: false, lastId: 0 }
    let afterId = 0
    let lastBatchSize = 0

    while (summary.batches < limit) {
        const rows = await fetchBatchById(model, {
            where,
            afterId,
            idColumn,
            batchSize: size,
            attributes
        })
        lastBatchSize = rows.length
        if (rows.length === 0) break

        summary.batches += 1
        summary.plantsProcessed += rows.length
        await onBatch(rows, { batch: summary.batches, afterId })

        const nextId = Number(rows[rows.length - 1]?.[idColumn])
        if (!Number.isInteger(nextId) || nextId <= afterId) {
            console.warn(
                `⚠️ plantBatching: некорректный ${idColumn} последней строки (${nextId}); ` +
                'останавливаю обход, чтобы не зациклиться'
            )
            break
        }

        summary.lastId = nextId
        afterId = nextId

        if (rows.length < size) return summary
    }

    summary.truncated = summary.batches >= limit && lastBatchSize >= size
    return summary
}

export async function iterateActiveDuePlants(options = {}) {
    return iterateBatchesById({ ...options, idColumn: 'id' })
}

export async function forEachInChunks(items, concurrency, worker) {
    if (typeof worker !== 'function') {
        throw new TypeError('forEachInChunks: worker должен быть функцией')
    }

    const list = Array.isArray(items) ? items : []
    const size = normalizePositiveInt(concurrency, DEFAULT_REMINDER_PUSH_CONCURRENCY, MAX_REMINDER_PUSH_CONCURRENCY)
    const settled = []

    for (let start = 0; start < list.length; start += size) {
        const chunk = list.slice(start, start + size)
        const chunkResults = await Promise.allSettled(
            chunk.map((item, offset) => worker(item, start + offset))
        )
        settled.push(...chunkResults)
    }

    return settled
}
