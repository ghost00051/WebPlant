import { detectPlantGroup, getSeasonInfo } from './wateringKnowledge.js'

export const PREDICTION_METADATA_KEY = 'prediction'
export const MIN_INTERVAL_DAYS = 1
export const MAX_INTERVAL_DAYS = 60
export const MAX_GAP_DAYS = 60
export const MAX_WATERING_SAMPLES = 20
export const MAX_STEP_DAYS = 2

const DAY_MS = 24 * 60 * 60 * 1000

const SEASON_FACTORS = { winter: 1.2, spring: 1, summer: 0.9, autumn: 1 }

function toDate(value) {
    if (value === null || value === undefined) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

export function clampIntervalDays(value, { min = MIN_INTERVAL_DAYS, max = MAX_INTERVAL_DAYS } = {}) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    const safeMin = Number.isFinite(min) ? Math.max(MIN_INTERVAL_DAYS, Math.round(min)) : MIN_INTERVAL_DAYS
    const safeMax = Number.isFinite(max) ? Math.max(safeMin, Math.min(MAX_INTERVAL_DAYS, Math.round(max))) : MAX_INTERVAL_DAYS
    return Math.min(safeMax, Math.max(safeMin, Math.round(parsed)))
}

export function intervalBoundsForPlant({ name, species } = {}) {
    const group = detectPlantGroup({ name, species })
    const range = Array.isArray(group?.intervalRange) ? group.intervalRange : [5, 10]
    const [min, max] = range
    return {
        min: Math.max(1, Math.round(min * 0.6)),
        max: Math.min(MAX_INTERVAL_DAYS, Math.max(2, Math.round(max * 1.8)))
    }
}

export function confidenceForSamples(samples) {
    const count = Number.isInteger(samples) && samples > 0 ? samples : 0
    if (count >= 5) return 'high'
    if (count >= 2) return 'medium'
    return 'low'
}

export function predictionWindowDays(intervalDays) {
    const interval = clampIntervalDays(intervalDays) ?? 7
    return Math.min(4, Math.max(1, Math.round(interval * 0.15)))
}

export function normalizePrediction(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    const base = clampIntervalDays(value.baseIntervalDays)
    if (!base) return null

    const samples = Number.isInteger(value.samples) && value.samples > 0
        ? Math.min(value.samples, 999)
        : 0
    const interval = clampIntervalDays(value.intervalDays) ?? base
    const lastObserved = toDate(value.lastObservedAt)
    const baseChanged = toDate(value.baseChangedAt)

    return {
        baseIntervalDays: base,
        intervalDays: interval,
        samples,
        confidence: confidenceForSamples(samples),
        windowDays: predictionWindowDays(interval),
        lastObservedAt: lastObserved ? lastObserved.toISOString() : null,
        baseChangedAt: baseChanged ? baseChanged.toISOString() : null
    }
}

export function readPrediction(metadata) {
    return normalizePrediction(metadata?.[PREDICTION_METADATA_KEY])
}

export function buildPredictionMetadata(metadata, prediction) {
    const next = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {}
    const normalized = normalizePrediction(prediction)
    if (normalized) next[PREDICTION_METADATA_KEY] = normalized
    else delete next[PREDICTION_METADATA_KEY]
    return next
}

export function baseIntervalOf(plant) {
    const stored = readPrediction(plant?.metadata)
    if (stored) return stored.baseIntervalDays
    return clampIntervalDays(plant?.watering_interval_days) ?? 7
}

function normalizePoints(values = []) {
    if (!Array.isArray(values)) return []
    return values
        .map(value => toDate(value))
        .filter(Boolean)
        .map(date => date.getTime())
        .sort((left, right) => left - right)
}

function intervalLimits(bounds = {}) {
    const min = Number.isFinite(bounds.min) ? Math.max(MIN_INTERVAL_DAYS, bounds.min) : MIN_INTERVAL_DAYS
    const max = Number.isFinite(bounds.max)
        ? Math.max(min, Math.min(MAX_INTERVAL_DAYS, bounds.max))
        : MAX_INTERVAL_DAYS
    return { min, max }
}

export function updateIntervalEstimate({
    estimateDays,
    gapDays,
    skipped = false,
    bounds = {},
    weights = {}
} = {}) {
    const { min, max } = intervalLimits(bounds)
    const clampEstimate = value => Math.min(max, Math.max(min, value))
    const estimate = clampEstimate(Number.isFinite(estimateDays) ? estimateDays : 7)
    const gap = Math.round(Number(gapDays))

    if (!Number.isFinite(gap) || gap < 1 || gap > MAX_GAP_DAYS) {
        return { estimateDays: estimate, learned: false }
    }

    const earlyWeight = Number.isFinite(weights.early) ? weights.early : 0.35
    const lateWeight = Number.isFinite(weights.late) ? weights.late : 0.12
    const delta = gap - estimate

    let weight = 0
    if (delta <= -0.5) {
        weight = earlyWeight
    } else if (delta >= 1 && delta <= 4 && !skipped) {
        weight = lateWeight
    }
    if (!weight) return { estimateDays: estimate, learned: false }

    const step = (gap - estimate) * weight
    const cappedStep = Math.max(-MAX_STEP_DAYS, Math.min(MAX_STEP_DAYS, step))
    const next = clampEstimate(estimate + cappedStep)

    return {
        estimateDays: Math.abs(next - estimate) < 1e-6 ? estimate : next,
        learned: Math.abs(next - estimate) >= 1e-6
    }
}

export function learnIntervalFromWaterings({
    baseIntervalDays,
    waterings = [],
    skips = [],
    bounds = {},
    weights = {}
} = {}) {
    const { min, max } = intervalLimits(bounds)
    const base = clampIntervalDays(baseIntervalDays, { min, max }) ?? 7
    const points = normalizePoints(waterings).slice(-(MAX_WATERING_SAMPLES + 1))
    const skipPoints = normalizePoints(skips)

    let estimate = Math.min(max, Math.max(min, base))
    let samples = 0

    for (let index = 1; index < points.length; index += 1) {
        const gapDays = Math.round((points[index] - points[index - 1]) / DAY_MS)
        if (gapDays < 1 || gapDays > MAX_GAP_DAYS) continue

        const skippedBetween = skipPoints.some(skip =>
            skip >= points[index - 1] && skip < points[index]
        )
        if (!skippedBetween) samples += 1

        const updated = updateIntervalEstimate({
            estimateDays: estimate,
            gapDays,
            skipped: skippedBetween,
            bounds,
            weights
        })
        if (updated.learned) {
            estimate = updated.estimateDays
        }
    }

    return { intervalDays: clampIntervalDays(estimate, { min, max }) ?? base, samples }
}

export function seasonOf(value, timeZone) {
    const date = toDate(value)
    if (!date) return null
    return getSeasonInfo(date, timeZone).season
}

export function seasonRatio(currentSeason, lastSeason) {
    if (!currentSeason || !lastSeason || currentSeason === lastSeason) return 1
    const current = SEASON_FACTORS[currentSeason] ?? 1
    const last = SEASON_FACTORS[lastSeason] ?? 1
    return Math.min(1.25, Math.max(0.8, current / last))
}

export function effectiveIntervalDays({
    learnedIntervalDays,
    samples = 0,
    lastObservedAt = null,
    previousObservedAt = null,
    now = new Date(),
    timeZone,
    bounds = {}
} = {}) {
    const learned = clampIntervalDays(learnedIntervalDays, bounds) ?? 7
    if (!Number.isInteger(samples) || samples < 2) return learned

    const currentSeason = seasonOf(now, timeZone)
    const lastSeason = seasonOf(lastObservedAt, timeZone)
    const previousSeason = seasonOf(previousObservedAt, timeZone)
    if (!currentSeason || !lastSeason || !previousSeason) return learned
    if (previousSeason === lastSeason) return learned

    const ratio = 1 + (seasonRatio(currentSeason, lastSeason) - 1) * 0.5
    if (ratio === 1) return learned

    return clampIntervalDays(learned * ratio, bounds) ?? learned
}

export function buildPrediction({ plant, waterings = [], skips = [], now = new Date(), timeZone } = {}) {
    const bounds = intervalBoundsForPlant(plant)
    const stored = readPrediction(plant?.metadata)
    const base = baseIntervalOf(plant)
    const learned = learnIntervalFromWaterings({
        baseIntervalDays: base,
        waterings,
        skips,
        bounds
    })
    const points = normalizePoints(waterings)
    const lastWatering = points.length ? new Date(points[points.length - 1]) : null
    const previousWatering = points.length > 1 ? new Date(points[points.length - 2]) : null
    const intervalDays = effectiveIntervalDays({
        learnedIntervalDays: learned.intervalDays,
        samples: learned.samples,
        lastObservedAt: lastWatering,
        previousObservedAt: previousWatering,
        now,
        timeZone,
        bounds
    })

    return {
        intervalDays,
        bounds,
        prediction: normalizePrediction({
            baseIntervalDays: base,
            intervalDays,
            samples: learned.samples,
            lastObservedAt: lastWatering ? lastWatering.toISOString() : null,
            baseChangedAt: stored?.baseChangedAt ?? null
        })
    }
}

export { DAY_MS }
