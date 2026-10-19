import { resolveTimeZone } from './timeZone.js'

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000
export const APP_TIME_ZONE = 'Europe/Moscow'

export const WATERING_TIME_OF_DAY_HOURS = { morning: 9, day: 14, evening: 19 }

export const MISSED_GRACE_HOUR = 24
export const MISSED_GRACE_MS = MISSED_GRACE_HOUR * HOUR_IN_MILLISECONDS

const MAX_ADVANCE_STEPS = 40000
const MIN_SLOT_YEAR = 2000
const MAX_SLOT_YEAR = 2100

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
    { now = new Date(), daysAhead = 90, timeZone = APP_TIME_ZONE } = {}
) {
    const first = toValidDate(nextWateringAt)
    const start = toValidDate(now)
    if (
        !first ||
        !start ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 1 ||
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
    ) {
        return []
    }

    const zone = resolveTimeZone(timeZone)
    const hour = zonedParts(first, zone).hour
    const end = start.getTime() + daysAhead * DAY_IN_MILLISECONDS
    const occurrences = []
    let cursor = zonedDayHourAfter(first, 0, hour, zone)
    let steps = 0

    if (!cursor) return []

    if (cursor.getTime() < start.getTime()) {
        occurrences.push(new Date(cursor))
        do {
            cursor = zonedDayHourAfter(cursor, intervalDays, hour, zone)
            steps += 1
        } while (cursor && cursor.getTime() <= start.getTime() && steps < MAX_ADVANCE_STEPS)
    }

    while (cursor && cursor.getTime() <= end && steps < MAX_ADVANCE_STEPS) {
        occurrences.push(new Date(cursor))
        cursor = zonedDayHourAfter(cursor, intervalDays, hour, zone)
        steps += 1
    }

    return occurrences
}

export function advanceZonedWatering(
    value,
    intervalDays,
    hour,
    timeZone = APP_TIME_ZONE,
    now = new Date()
) {
    const date = toValidDate(value)
    const current = toValidDate(now)
    if (!date || !current || !Number.isInteger(intervalDays) || intervalDays < 1) return null

    const zone = resolveTimeZone(timeZone)
    const safeHour = Number.isInteger(hour) ? hour : 0
    let next = zonedDayHourAfter(date, 0, safeHour, zone)
    if (!next) return null





    if (next.getTime() <= current.getTime()) {
        const daysBehind = Math.ceil(
            (current.getTime() - next.getTime()) / DAY_IN_MILLISECONDS
        )
        const jumps = Math.floor(daysBehind / intervalDays) - 1
        if (jumps > 1) {
            const jumped = zonedDayHourAfter(next, intervalDays * jumps, safeHour, zone)
            if (jumped && Number.isFinite(jumped.getTime())) {
                next = jumped
            }
        }
    }

    let steps = 0
    while (next && next.getTime() <= current.getTime() && steps < MAX_ADVANCE_STEPS) {
        next = zonedDayHourAfter(next, intervalDays, safeHour, zone)
        steps += 1
    }

    return next
}


export function splitMissedWaterings(
    scheduledFor,
    intervalDays,
    hour,
    timeZone = APP_TIME_ZONE,
    now = new Date(),
    { graceMs = MISSED_GRACE_MS } = {}
) {
    const scheduled = toValidDate(scheduledFor)
    const current = toValidDate(now)
    if (!scheduled || !current || !Number.isInteger(intervalDays) || intervalDays < 1) {
        return { missed: [], next: null }
    }

    const grace = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : MISSED_GRACE_MS
    const missedDeadline = current.getTime() - grace
    const zone = resolveTimeZone(timeZone)
    const safeHour = Number.isInteger(hour) ? hour : 0
    const missed = []
    let cursor = zonedDayHourAfter(scheduled, 0, safeHour, zone)
    let steps = 0

    while (
        cursor &&
        cursor.getTime() <= missedDeadline &&
        steps < MAX_ADVANCE_STEPS
    ) {
        missed.push(cursor)
        cursor = zonedDayHourAfter(cursor, intervalDays, safeHour, zone)
        steps += 1
    }

    return { missed, next: cursor ?? null }
}

export function localDayRange(value, timeZone = APP_TIME_ZONE) {
    const date = toValidDate(value)
    if (!date) return null

    const zone = resolveTimeZone(timeZone)
    const from = zonedDayHourAfter(date, 0, 0, zone)
    const to = zonedDayHourAfter(date, 1, 0, zone)
    if (!from || !to) return null

    return { from, to: new Date(to.getTime() - 1) }
}

export function weekdayOfZonedDate(value, timeZone = APP_TIME_ZONE) {
    const date = toValidDate(value)
    if (!date) return null

    const parts = zonedParts(date, resolveTimeZone(timeZone))
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

export function reminderWeekdaysForInterval(intervalDays, date, timeZone = APP_TIME_ZONE) {
    if (!weekdayRestrictionApplies(intervalDays)) return []
    if (intervalDays === 1) return [0, 1, 2, 3, 4, 5, 6]

    const weekday = weekdayOfZonedDate(date, timeZone)
    return weekday === null ? [] : [weekday]
}

export function normalizeReminderWeekdays(
    intervalDays,
    weekdays,
    nextWateringAt,
    timeZone = APP_TIME_ZONE
) {
    const list = Array.isArray(weekdays)
        ? weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
        : []
    const unique = [...new Set(list)]

    if (!weekdayRestrictionApplies(intervalDays)) return []
    if (intervalDays === 1) return unique

    const weekday = weekdayOfZonedDate(nextWateringAt, timeZone)
    if (weekday === null || unique.length === 0 || unique.includes(weekday)) return unique
    return [weekday]
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
    if (!trimmed || trimmed.length > 64) return null
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)

    if (dateOnly) {
        const year = Number(dateOnly[1])
        const month = Number(dateOnly[2]) - 1
        const day = Number(dateOnly[3])
        if (year < MIN_SLOT_YEAR || year > MAX_SLOT_YEAR) return null
        const hour = Number.isInteger(timeOfDayHours) ? timeOfDayHours : 8
        if (hour < 0 || hour > 23) return null
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

    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null

    const parsed = new Date(trimmed)
    if (!Number.isFinite(parsed.getTime())) return null

    const year = parsed.getUTCFullYear()
    if (year < MIN_SLOT_YEAR || year > MAX_SLOT_YEAR) return null

    return parsed
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
    const hoursLate = Math.max(
        0,
        Math.round((current.getTime() - slot.getTime()) / HOUR_IN_MILLISECONDS)
    )

    return {
        actionAt: slot,
        scheduledFor: slot,
        hoursLate,
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

export function pickWateringLogForSlot(logs, action, slot, timeZone = APP_TIME_ZONE) {
    const slotAt = toValidDate(slot)
    const range = localDayRange(slotAt, timeZone)
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
