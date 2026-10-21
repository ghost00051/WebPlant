import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DAY_MS,
    MAX_INTERVAL_DAYS,
    PREDICTION_METADATA_KEY,
    baseIntervalOf,
    buildPrediction,
    buildPredictionMetadata,
    clampIntervalDays,
    confidenceForSamples,
    effectiveIntervalDays,
    intervalBoundsForPlant,
    learnIntervalFromWaterings,
    normalizePrediction,
    predictionWindowDays,
    readPrediction,
    seasonRatio
} from './wateringPrediction.js'

const TZ = 'UTC'
const START = new Date('2026-07-01T09:00:00Z').getTime()

function series(gaps) {
    const points = [new Date(START)]
    for (const gap of gaps) {
        points.push(new Date(points[points.length - 1].getTime() + gap * DAY_MS))
    }
    return points
}

test('clampIntervalDays: границы, округление и защита от мусора', () => {
    assert.equal(clampIntervalDays(7), 7)
    assert.equal(clampIntervalDays('7.6'), 8)
    assert.equal(clampIntervalDays(0), 1)
    assert.equal(clampIntervalDays(999), MAX_INTERVAL_DAYS)
    assert.equal(clampIntervalDays(Number.NaN), null)
    assert.equal(clampIntervalDays(null), null)
    assert.equal(clampIntervalDays(2, { min: 3, max: 20 }), 3)
    assert.equal(clampIntervalDays(30, { min: 3, max: 20 }), 20)
})

test('intervalBoundsForPlant: границы зависят от группы растения', () => {
    const cactus = intervalBoundsForPlant({ name: 'Опунция', species: 'Opuntia' })
    assert.equal(cactus.min, 8)
    assert.equal(cactus.max, 54)

    const fern = intervalBoundsForPlant({ name: 'Нефролепис', species: 'Nephrolepis' })
    assert.equal(fern.min, 1)
    assert.equal(fern.max, 9)

    const unknown = intervalBoundsForPlant({ name: 'Неизвестное растение' })
    assert.equal(unknown.min, 3)
    assert.equal(unknown.max, 18)
})

test('confidenceForSamples и predictionWindowDays: уверенность растёт с наблюдениями', () => {
    assert.equal(confidenceForSamples(0), 'low')
    assert.equal(confidenceForSamples(1), 'low')
    assert.equal(confidenceForSamples(2), 'medium')
    assert.equal(confidenceForSamples(4), 'medium')
    assert.equal(confidenceForSamples(5), 'high')

    assert.equal(predictionWindowDays(2), 1)
    assert.equal(predictionWindowDays(7), 1)
    assert.equal(predictionWindowDays(20), 3)
    assert.equal(predictionWindowDays(60), 4)
})

test('normalizePrediction: читает только корректное состояние', () => {
    assert.equal(normalizePrediction(null), null)
    assert.equal(normalizePrediction({}), null)
    assert.equal(normalizePrediction({ baseIntervalDays: 'abc' }), null)

    const normalized = normalizePrediction({
        baseIntervalDays: 7,
        intervalDays: 9,
        samples: 3,
        lastObservedAt: '2026-07-20T09:00:00.000Z'
    })
    assert.equal(normalized.baseIntervalDays, 7)
    assert.equal(normalized.intervalDays, 9)
    assert.equal(normalized.samples, 3)
    assert.equal(normalized.confidence, 'medium')
    assert.equal(normalized.windowDays, 1)
    assert.equal(normalized.lastObservedAt, '2026-07-20T09:00:00.000Z')

    assert.equal(readPrediction({ [PREDICTION_METADATA_KEY]: normalized }).intervalDays, 9)
    assert.equal(readPrediction({}), null)
})

test('baseIntervalOf: сохранённая база важнее текущего интервала растения', () => {
    assert.equal(baseIntervalOf({ watering_interval_days: 7 }), 7)
    assert.equal(baseIntervalOf({
        watering_interval_days: 9,
        metadata: { [PREDICTION_METADATA_KEY]: { baseIntervalDays: 6, samples: 2 } }
    }), 6)
    assert.equal(baseIntervalOf({}), 7)
})

test('learnIntervalFromWaterings: полив по графику не меняет интервал, но подтверждает его', () => {
    const result = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings: series([7, 7, 7, 7])
    })
    assert.equal(result.intervalDays, 7)
    assert.equal(result.samples, 4)
})

test('learnIntervalFromWaterings: ранние поливы сокращают интервал', () => {
    const result = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings: series([5, 5, 5, 5, 5, 5])
    })
    assert.equal(result.intervalDays, 5)
    assert.ok(result.samples >= 4)
})

test('learnIntervalFromWaterings: редкие поливы без пропусков слегка удлиняют интервал', () => {
    const result = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings: series([9, 9, 9, 9, 9, 9])
    })
    assert.ok(result.intervalDays > 7, `ожидали удлинение, получили ${result.intervalDays}`)
    assert.ok(result.intervalDays <= 9)
    assert.ok(result.samples > 0)
})

test('learnIntervalFromWaterings: автоскипы между поливами — не доказательство', () => {
    const waterings = series([9, 9, 9])
    const skips = []
    for (let index = 1; index < waterings.length; index += 1) {
        const previous = waterings[index - 1].getTime()
        const current = waterings[index].getTime()
        skips.push(new Date(previous + 8 * DAY_MS))
        assert.ok(skips[skips.length - 1].getTime() < current)
    }

    const result = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings,
        skips
    })
    assert.equal(result.intervalDays, 7)
    assert.equal(result.samples, 0)
})

test('learnIntervalFromWaterings: границы группы не дают уйти в крайность', () => {
    const cactus = learnIntervalFromWaterings({
        baseIntervalDays: 14,
        bounds: { min: 8, max: 54 },
        waterings: series([2, 2, 2, 2, 2])
    })
    assert.equal(cactus.intervalDays, 8)
    assert.ok(cactus.samples > 0)
})

test('learnIntervalFromWaterings: мусорные интервалы и порядок дат не ломают расчёт', () => {
    const waterings = series([5, 5, 5])
    const shuffled = [waterings[2], waterings[0], waterings[1]]
    const result = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings: shuffled
    })

    const zeroAndHuge = learnIntervalFromWaterings({
        baseIntervalDays: 7,
        waterings: [
            new Date(START),
            new Date(START),
            new Date(START + 90 * DAY_MS)
        ]
    })
    assert.ok(result.intervalDays < 7)
    assert.equal(zeroAndHuge.intervalDays, 7)
    assert.equal(zeroAndHuge.samples, 0)
})

test('seasonRatio: учитывает только смену сезона', () => {
    assert.equal(seasonRatio('winter', 'winter'), 1)
    assert.equal(seasonRatio('summer', 'summer'), 1)
    assert.equal(seasonRatio('winter', 'summer'), 1.25)
    assert.equal(seasonRatio('summer', 'winter'), 0.8)
    assert.equal(seasonRatio('spring', 'autumn'), 1)
    assert.equal(seasonRatio(null, 'summer'), 1)
})

test('effectiveIntervalDays: сезон меняет интервал только после наблюдений и на стыке сезонов', () => {
    const winterNow = new Date('2027-01-15T09:00:00Z')
    const lastSummer = new Date('2026-07-15T09:00:00Z')

    assert.equal(effectiveIntervalDays({
        learnedIntervalDays: 10,
        samples: 1,
        lastObservedAt: lastSummer,
        previousObservedAt: new Date('2026-07-10T09:00:00Z'),
        now: winterNow,
        timeZone: TZ
    }), 10)

    const transition = effectiveIntervalDays({
        learnedIntervalDays: 10,
        samples: 5,
        lastObservedAt: lastSummer,
        previousObservedAt: new Date('2026-01-10T09:00:00Z'),
        now: winterNow,
        timeZone: TZ
    })
    assert.equal(transition, 11)

    assert.equal(effectiveIntervalDays({
        learnedIntervalDays: 10,
        samples: 5,
        lastObservedAt: lastSummer,
        previousObservedAt: new Date('2026-07-01T09:00:00Z'),
        now: new Date('2026-08-20T09:00:00Z'),
        timeZone: TZ
    }), 10)

    assert.equal(effectiveIntervalDays({
        learnedIntervalDays: 10,
        samples: 5,
        lastObservedAt: lastSummer,
        previousObservedAt: new Date('2026-01-10T09:00:00Z'),
        now: winterNow,
        timeZone: TZ,
        bounds: { min: 8, max: 11 }
    }), 11)
})

test('buildPrediction: собирает интервал, уверенность и базу', () => {
    const plant = {
        name: 'Монстера',
        species: 'Monstera deliciosa',
        watering_interval_days: 7,
        metadata: { care_hints: { watering_answers: [] } }
    }
    const result = buildPrediction({
        plant,
        waterings: series([5, 5, 5, 5, 5]),
        now: new Date('2026-08-01T09:00:00Z'),
        timeZone: TZ
    })

    assert.ok(result.intervalDays < 7)
    assert.ok(result.prediction)
    assert.equal(result.prediction.baseIntervalDays, 7)
    assert.equal(result.prediction.intervalDays, result.intervalDays)
    assert.ok(['medium', 'high'].includes(result.prediction.confidence))
    assert.ok(result.prediction.lastObservedAt)

    const metadata = buildPredictionMetadata(plant.metadata, result.prediction)
    assert.deepEqual(metadata.care_hints, { watering_answers: [] })
    assert.equal(metadata[PREDICTION_METADATA_KEY].intervalDays, result.intervalDays)
})

test('buildPredictionMetadata: предсказание заменяется, остальное сохраняется', () => {
    const metadata = buildPredictionMetadata(
        { notifications: {}, [PREDICTION_METADATA_KEY]: { baseIntervalDays: 7 } },
        { baseIntervalDays: 6, intervalDays: 6, samples: 0 }
    )
    assert.equal(metadata[PREDICTION_METADATA_KEY].baseIntervalDays, 6)
    assert.deepEqual(metadata.notifications, {})

    const cleared = buildPredictionMetadata(metadata, null)
    assert.equal(cleared[PREDICTION_METADATA_KEY], undefined)
})
