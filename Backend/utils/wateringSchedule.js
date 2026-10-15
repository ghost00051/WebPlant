import { resolveTimeZone } from './timeZone.js'

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000
export const APP_TIME_ZONE = 'Europe/Moscow'

export const WATERING_TIME_OF_DAY_HOURS = { morning: 9, day: 14, evening: 19 }

export const MISSED_GRACE_HOUR = 24

const formatterCache = new Map()

function zonedFormatter(timeZone) {
    let formatter = formatterCache.get(timeZone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        })
        formatterCache.set(timeZone, formatter)
    }
    return formatter
}

function zonedParts(date, timeZone) {
    const parts = zonedFormatter(timeZone).formatToParts(date)

    const values = {}
    for (const part of parts) {
        if (part.type !== 'literal') values[part.type] = Number(part.value)
    }
    return values
}

export function zonedDateTimeToUtc(
    { year, month, day, hour = 0, minute = 0, second = 0 },
    timeZone = APP_TIME_ZONE
) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
    const observed = zonedParts(new Date(utcGuess), timeZone)
    const observedAsUtc = Date.UTC(
        observed.year,
        observed.month - 1,
        observed.day,
        observed.hour,
        observed.minute,
        observed.second
    )
    return new Date(utcGuess - (observedAsUtc - utcGuess))
}

export function zonedDayKey(value, timeZone = APP_TIME_ZONE) {
    const date = toValidDate(value)
    if (!date) return null
    const parts = zonedParts(date, timeZone)
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function zonedDayHourAfter(value, days, hour, timeZone = APP_TIME_ZONE) {
    const date = toValidDate(value)
    if (!date || !Number.isInteger(days)) return null

    const parts = zonedParts(date, timeZone)
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    shifted.setUTCDate(shifted.getUTCDate() + days)

    return zonedDateTimeToUtc(
        {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: Number.isInteger(hour) ? hour : 0
        },
        timeZone
    )
}

export function addZonedDays(value, days, timeZone = APP_TIME_ZONE) {
    const date = toValidDate(value)
    if (!date || !Number.isInteger(days)) return null

    const parts = zonedParts(date, timeZone)
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    shifted.setUTCDate(shifted.getUTCDate() + days)

    return zonedDateTimeToUtc(
        {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: parts.hour,
            minute: parts.minute,
            second: parts.second
        },
        timeZone
    )
}

export function nextWateringInstant(
    from,
    days,
    timeOfDay = 'morning',
    { timeZone = APP_TIME_ZONE, hours = WATERING_TIME_OF_DAY_HOURS } = {}
) {
    const hour = hours && Object.hasOwn(hours, timeOfDay)
        ? hours[timeOfDay]
        : WATERING_TIME_OF_DAY_HOURS.morning
    return zonedDayHourAfter(from, days, hour, timeZone)
}

export function wateringMissDeadline(scheduledFor, { timeZone = APP_TIME_ZONE } = {}) {
    const scheduled = toValidDate(scheduledFor)
    if (!scheduled) return null

    return zonedDayHourAfter(scheduled, 1, 0, timeZone)
}

export function isWateringMissed(
    scheduledFor,
    { now = new Date(), timeZone = APP_TIME_ZONE } = {}
) {
    const deadline = wateringMissDeadline(scheduledFor, { timeZone })
    const current = toValidDate(now)
    if (!deadline || !current) return false

    return current.getTime() >= deadline.getTime()
}

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

export function parseWateringSlot(value, timeOfDayHours = 8, timeZone = APP_TIME_ZONE) {
    if (typeof value !== 'string') return null

    const trimmed = value.trim()
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)

    if (dateOnly) {
        const year = Number(dateOnly[1])
        const month = Number(dateOnly[2]) - 1
        const day = Number(dateOnly[3])
        const hour = Number.isInteger(timeOfDayHours) ? timeOfDayHours : 8
        const slot = zonedDateTimeToUtc({ year, month: month + 1, day, hour }, timeZone)

        const check = zonedParts(slot, timeZone)
        if (
            check.year !== year ||
            check.month !== month + 1 ||
            check.day !== day
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
    timeOfDayHours = 8,
    timeZone = APP_TIME_ZONE
} = {}) {
    const slot = toValidDate(scheduledFor)
    const current = toValidDate(now)
    if (!slot || !current) return null
    if (slot.getTime() > current.getTime()) return null

    const interval = Number.isInteger(intervalDays) && intervalDays > 0 ? intervalDays : 7
    const hour = Number.isInteger(timeOfDayHours) ? timeOfDayHours : 8

    const plannedNext = zonedDayHourAfter(slot, interval, hour, timeZone)

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

    const isEarlyWatering = log => {
        const scheduled = toValidDate(log.scheduled_for)
        const actionAt = toValidDate(log.action_at)
        return scheduled !== null && actionAt !== null && scheduled.getTime() > actionAt.getTime()
    }

    const candidates = logs
        .filter(log => log && log.action === action)
        .filter(log => action !== 'watered' || !isEarlyWatering(log))
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

export function isReminderWeekday(weekdays, date, timeZone = APP_TIME_ZONE) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return true
    const scheduledDate = toValidDate(date)
    if (!scheduledDate) return false

    const parts = zonedParts(scheduledDate, resolveTimeZone(timeZone))
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
    return weekdays.includes(weekday)
}
