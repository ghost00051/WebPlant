const PROGRESS_KEYS = ['missed_since', 'reminders_paused', 'consecutive_skips']

export const MISSED_WATERING_METADATA_KEY = 'missed_since'
export const MAX_CONSECUTIVE_AUTO_SKIPS = 3

export function sanitizePlantMetadata(metadata) {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {}
}

export function clearWateringProgress(metadata) {
    const next = sanitizePlantMetadata(metadata)
    for (const key of PROGRESS_KEYS) delete next[key]
    return next
}

export function hasWateringProgress(metadata) {
    const source = sanitizePlantMetadata(metadata)
    return PROGRESS_KEYS.some(key => Object.hasOwn(source, key))
}

export function withNotificationsReset(metadata) {
    return { ...sanitizePlantMetadata(metadata), notifications: {} }
}

export function markWateringMissed(metadata, missedSince) {
    const missed = missedSince instanceof Date ? missedSince : new Date(missedSince)
    const next = withNotificationsReset(metadata)
    if (!Object.hasOwn(next, MISSED_WATERING_METADATA_KEY) && Number.isFinite(missed.getTime())) {
        next[MISSED_WATERING_METADATA_KEY] = missed.toISOString()
    }
    return next
}

export function registerAutoSkip(metadata, { missedSince = null, maxConsecutive = MAX_CONSECUTIVE_AUTO_SKIPS } = {}) {
    const next = markWateringMissed(metadata, missedSince ?? new Date())
    const previous = Number.isInteger(next.consecutive_skips) ? next.consecutive_skips : 0
    const consecutive = previous + 1
    next.consecutive_skips = consecutive
    next.reminders_paused = consecutive >= maxConsecutive
    return next
}

export function isRemindersPaused(metadata) {
    return sanitizePlantMetadata(metadata).reminders_paused === true
}


export function resumeReminders(metadata) {
    const next = sanitizePlantMetadata(metadata)
    delete next.reminders_paused
    delete next.consecutive_skips
    return next
}

export function hasMissedWatering(metadata) {
    const value = sanitizePlantMetadata(metadata)[MISSED_WATERING_METADATA_KEY]
    return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
}
