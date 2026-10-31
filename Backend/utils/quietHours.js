import { DEFAULT_TIME_ZONE, resolveTimeZone } from './timeZone.js'

export const DELIVERY_MODE = Object.freeze({
    DIGEST: 'digest',
    PER_PLANT: 'per_plant'
})

export const DELIVERY_MODES = Object.freeze([DELIVERY_MODE.DIGEST, DELIVERY_MODE.PER_PLANT])

export const DEFAULT_DELIVERY_MODE = DELIVERY_MODE.DIGEST

export const DEFAULT_QUIET_HOURS_START = '22:00'

export const DEFAULT_QUIET_HOURS_END = '08:00'

export const DEFAULT_DIGEST_HOUR = 9

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const MINUTES_IN_DAY = 24 * 60

export function resolveDeliveryMode(value) {
    return DELIVERY_MODES.includes(value) ? value : DEFAULT_DELIVERY_MODE
}

export function isValidDeliveryMode(value) {
    return DELIVERY_MODES.includes(value)
}

export function isValidClockTime(value) {
    return typeof value === 'string' && CLOCK_PATTERN.test(value.trim())
}

export function parseClockMinutes(value) {
    if (typeof value !== 'string') return null
    const match = CLOCK_PATTERN.exec(value.trim())
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
}

export function formatClockMinutes(minutes) {
    const parsed = Number(minutes)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= MINUTES_IN_DAY) return null
    return `${String(Math.floor(parsed / 60)).padStart(2, '0')}:${String(parsed % 60).padStart(2, '0')}`
}

export function normalizeClockTime(value, fallback) {
    return isValidClockTime(value) ? value.trim() : fallback
}

export function resolveQuietHours({ enabled = false, start, end } = {}) {
    const startTime = normalizeClockTime(start, DEFAULT_QUIET_HOURS_START)
    const endTime = normalizeClockTime(end, DEFAULT_QUIET_HOURS_END)
    return {
        enabled: enabled === true,
        start: startTime,
        end: endTime,
        startMinutes: parseClockMinutes(startTime),
        endMinutes: parseClockMinutes(endTime),
        wrapsMidnight: parseClockMinutes(startTime) > parseClockMinutes(endTime)
    }
}

export function minuteOfLocalDay(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const date = now instanceof Date ? now : new Date(now)
    if (!Number.isFinite(date.getTime())) return null
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: resolveTimeZone(timeZone),
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date)
    const values = {}
    for (const part of parts) {
        if (part.type !== 'literal') values[part.type] = Number(part.value)
    }
    if (!Number.isInteger(values.hour) || !Number.isInteger(values.minute)) return null
    return values.hour * 60 + values.minute
}

export function isMinuteInQuietWindow(minute, quietHours) {
    if (!quietHours || quietHours.enabled !== true) return false
    if (!Number.isInteger(minute)) return false
    const { startMinutes, endMinutes } = quietHours
    if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) return false
    if (startMinutes === endMinutes) return false
    if (startMinutes < endMinutes) return minute >= startMinutes && minute < endMinutes
    return minute >= startMinutes || minute < endMinutes
}

export function isQuietTime({ now = new Date(), timeZone = DEFAULT_TIME_ZONE, quietHours } = {}) {
    if (!quietHours || quietHours.enabled !== true) return false
    const minute = minuteOfLocalDay(now, timeZone)
    return isMinuteInQuietWindow(minute, quietHours)
}

export function quietHoursFromPreference(preference = {}) {
    return resolveQuietHours({
        enabled: preference?.quiet_hours_enabled === true,
        start: preference?.quiet_hours_start,
        end: preference?.quiet_hours_end
    })
}

export function isQuietTimeForPreference(preference, {
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE
} = {}) {
    return isQuietTime({
        now,
        timeZone,
        quietHours: quietHoursFromPreference(preference)
    })
}

export function resolveDigestHour({ digestHour = DEFAULT_DIGEST_HOUR, quietHours } = {}) {
    const base = Number.isInteger(digestHour) && digestHour >= 0 && digestHour <= 23
        ? digestHour
        : DEFAULT_DIGEST_HOUR
    if (!quietHours || quietHours.enabled !== true) return base
    if (quietHours.startMinutes === quietHours.endMinutes) return base
    if (isMinuteInQuietWindow(base * 60, quietHours)) {
        return Math.floor(quietHours.endMinutes / 60) % 24
    }
    return base
}

export function describeQuietHoursWindow({ start, end } = {}) {
    const startTime = normalizeClockTime(start, DEFAULT_QUIET_HOURS_START)
    const endTime = normalizeClockTime(end, DEFAULT_QUIET_HOURS_END)
    if (parseClockMinutes(startTime) > parseClockMinutes(endTime)) {
        return `${startTime}–${endTime} (через полночь)`
    }
    return `${startTime}–${endTime}`
}

export default {
    DEFAULT_DELIVERY_MODE,
    DEFAULT_DIGEST_HOUR,
    DEFAULT_QUIET_HOURS_END,
    DEFAULT_QUIET_HOURS_START,
    DELIVERY_MODES,
    DELIVERY_MODE,
    describeQuietHoursWindow,
    formatClockMinutes,
    isMinuteInQuietWindow,
    isQuietTime,
    isQuietTimeForPreference,
    isValidClockTime,
    isValidDeliveryMode,
    minuteOfLocalDay,
    normalizeClockTime,
    parseClockMinutes,
    quietHoursFromPreference,
    resolveDeliveryMode,
    resolveDigestHour,
    resolveQuietHours
}
