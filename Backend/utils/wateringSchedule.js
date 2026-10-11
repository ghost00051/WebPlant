const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000

export function generateWateringOccurrences(
    nextWateringAt,
    intervalDays,
    { now = new Date(), daysAhead = 90 } = {}
) {
    const firstOccurrence = new Date(nextWateringAt)
    const start = new Date(now)
    if (
        !Number.isFinite(firstOccurrence.getTime()) ||
        !Number.isFinite(start.getTime()) ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 1 ||
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
    ) {
        return []
    }

    const interval = intervalDays * DAY_IN_MILLISECONDS
    const end = start.getTime() + daysAhead * DAY_IN_MILLISECONDS
    const occurrences = []

    if (firstOccurrence < start) {
        occurrences.push(new Date(firstOccurrence))
        const periodsToAdvance = Math.floor(
            (start.getTime() - firstOccurrence.getTime()) / interval
        ) + 1
        firstOccurrence.setTime(firstOccurrence.getTime() + periodsToAdvance * interval)
    }

    while (firstOccurrence.getTime() <= end) {
        occurrences.push(new Date(firstOccurrence))
        firstOccurrence.setTime(firstOccurrence.getTime() + interval)
    }

    return occurrences
}

export function findFirstWateringAfter(wateringTimes, scheduledFor) {
    const scheduled = new Date(scheduledFor).getTime()
    if (!Number.isFinite(scheduled) || !Array.isArray(wateringTimes)) {
        return null
    }

    let first = null
    for (const time of wateringTimes) {
        const at = time instanceof Date ? time.getTime() : new Date(time).getTime()
        if (!Number.isFinite(at) || at < scheduled) continue
        if (first === null || at < first) first = at
    }

    return first
}

export function resolveMissedLateness(
    scheduledFor,
    { now = new Date(), wateredAt = null } = {}
) {
    const scheduled = new Date(scheduledFor)
    const current = new Date(now)
    if (!Number.isFinite(scheduled.getTime()) || !Number.isFinite(current.getTime())) {
        return null
    }

    const watered = wateredAt ? new Date(wateredAt) : null
    const resolvedAt = watered && Number.isFinite(watered.getTime()) && watered >= scheduled
        ? watered
        : current

    const hoursLate = Math.max(
        0,
        Math.round((resolvedAt.getTime() - scheduled.getTime()) / HOUR_IN_MILLISECONDS)
    )

    return { hoursLate, daysLate: Math.floor(hoursLate / 24) }
}

export function parseWateringSlot(value, timeOfDayHours = 8) {
    if (typeof value !== 'string') return null

    const trimmed = value.trim()
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)

    if (dateOnly) {
        const year = Number(dateOnly[1])
        const month = Number(dateOnly[2]) - 1
        const day = Number(dateOnly[3])
        const hour = Number.isInteger(timeOfDayHours) ? timeOfDayHours : 8
        const slot = new Date(year, month, day, hour, 0, 0, 0)

        if (
            slot.getFullYear() !== year ||
            slot.getMonth() !== month ||
            slot.getDate() !== day
        ) {
            return null
        }

        return slot
    }

    const parsed = new Date(trimmed)
    return Number.isFinite(parsed.getTime()) ? parsed : null
}

export function resolvePastWatering(scheduledFor, {
    now = new Date(),
    lastWateredAt = null,
    nextWateringAt = null,
    intervalDays = 7,
    timeOfDayHours = 8
} = {}) {
    const slot = toValidDate(scheduledFor)
    const current = toValidDate(now)
    if (!slot || !current) return null
    if (slot.getTime() > current.getTime()) return null

    const interval = Number.isInteger(intervalDays) && intervalDays > 0 ? intervalDays : 7
    const hour = Number.isInteger(timeOfDayHours) ? timeOfDayHours : 8

    const plannedNext = new Date(slot.getTime())
    plannedNext.setDate(plannedNext.getDate() + interval)
    plannedNext.setHours(hour, 0, 0, 0)

    const previousNext = toValidDate(nextWateringAt)
    const next = previousNext && previousNext > plannedNext ? previousNext : plannedNext

    const previousLast = toValidDate(lastWateredAt)
    const last = previousLast && previousLast > slot ? previousLast : slot

    return {
        actionAt: slot,
        scheduledFor: slot,
        hoursLate: 0,
        lastWateredAt: last,
        nextWateringAt: next,
        scheduleChanged: !previousNext || previousNext.getTime() !== next.getTime()
    }
}

function toValidDate(value) {
    if (value === undefined || value === null) return null
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

export function utcDayRange(date) {
    const start = toValidDate(date)
    if (!start) return null

    start.setUTCHours(0, 0, 0, 0)
    return { from: start, to: new Date(start.getTime() + DAY_IN_MILLISECONDS - 1) }
}

export function pickWateringLogForSlot(logs, action, slot) {
    const slotAt = toValidDate(slot)
    const range = utcDayRange(slotAt)
    if (!slotAt || !range || !Array.isArray(logs)) return null

    const inDay = value => {
        const at = toValidDate(value)
        return at !== null && at.getTime() >= range.from.getTime() && at.getTime() <= range.to.getTime()
    }

    const candidates = logs.filter(log => log && log.action === action)
    const bySlot = candidates.filter(log => inDay(log.scheduled_for))
    const pool = bySlot.length
        ? bySlot
        : candidates.filter(log => !toValidDate(log.scheduled_for) && inDay(log.action_at))
    if (!pool.length) return null

    const exact = pool.find(
        log => toValidDate(log.scheduled_for)?.getTime() === slotAt.getTime()
    )
    if (exact) return exact

    const distanceTo = log => {
        const at = toValidDate(log.scheduled_for)
        return at === null ? Number.MAX_SAFE_INTEGER : Math.abs(at.getTime() - slotAt.getTime())
    }

    return pool.reduce((best, log) => (distanceTo(log) < distanceTo(best) ? log : best))
}

export function weekdayRestrictionApplies(intervalDays) {
    return Number.isInteger(intervalDays) && intervalDays > 0 &&
        (intervalDays === 1 || intervalDays % 7 === 0)
}

export function isReminderWeekday(weekdays, date) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return true
    const scheduledDate = new Date(date)
    return Number.isFinite(scheduledDate.getTime()) &&
        weekdays.includes(scheduledDate.getDay())
}
