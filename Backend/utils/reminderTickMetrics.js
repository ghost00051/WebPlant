export const MAX_REMINDER_TICK_METRICS = 50

const ticks = []

function toNonNegativeInt(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.round(parsed)
}

function toIsoString(value) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : null
    }
    if (typeof value === 'string' && value) {
        const parsed = new Date(value)
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
    }
    return null
}

export function recordReminderTick({
    startedAt = null,
    durationMs = 0,
    batches = 0,
    plantsProcessed = 0,
    notificationsCreated = 0,
    errors = 0
} = {}) {
    const entry = {
        startedAt: toIsoString(startedAt),
        durationMs: toNonNegativeInt(durationMs),
        batches: toNonNegativeInt(batches),
        plantsProcessed: toNonNegativeInt(plantsProcessed),
        notificationsCreated: toNonNegativeInt(notificationsCreated),
        errors: toNonNegativeInt(errors)
    }

    ticks.push(entry)
    if (ticks.length > MAX_REMINDER_TICK_METRICS) {
        ticks.splice(0, ticks.length - MAX_REMINDER_TICK_METRICS)
    }

    return { ...entry }
}

export function getReminderTickMetrics() {
    const snapshot = ticks.map(tick => ({ ...tick }))
    return {
        maxTicks: MAX_REMINDER_TICK_METRICS,
        count: snapshot.length,
        lastTickAt: snapshot.length ? snapshot[snapshot.length - 1].startedAt : null,
        ticks: snapshot
    }
}

export function resetReminderTickMetrics() {
    ticks.length = 0
}
