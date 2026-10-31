import { resolveTimeZone, DEFAULT_TIME_ZONE } from './timeZone.js'
import {
    isWateringMissed,
    resolveMissedLateness,
    splitMissedWaterings,
    zonedDayKey,
    MISSED_GRACE_HOUR,
    MISSED_GRACE_MS,
    WATERING_TIME_OF_DAY_HOURS
} from './wateringSchedule.js'

export const MISSED_POLICY = Object.freeze({
    PRESERVE: 'preserve',
    AUTO_SKIP: 'auto_skip'
})

export const DEFAULT_MISSED_POLICY = MISSED_POLICY.PRESERVE

export const MISSED_BACKFILL_WINDOW_DAYS = 30

export const WATERING_STATE_STATUS = Object.freeze({
    SCHEDULED: 'scheduled',
    DUE_TODAY: 'due_today',
    MISSED: 'missed',
    PAUSED: 'paused'
})

export const MISSED_REASON = Object.freeze({
    AUTO_SKIPPED: 'auto_skipped',
    MISSED_SLOT: 'missed_slot',
    REMINDERS_PAUSED: 'reminders_paused'
})

export const MISSED_ACTION = Object.freeze({
    NOOP: 'noop',
    MARK_MISSED: 'mark_missed',
    ADVANCE: 'advance'
})

const DAY_MS = 24 * 60 * 60 * 1000
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'preserve'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'auto_skip', 'advance', 'autoskip'])

function toDate(value) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

function toIso(value) {
    const date = toDate(value)
    return date ? date.toISOString() : null
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveMissedPolicy(env = process.env) {
    const raw = env?.REMINDER_MISSED_POLICY
    if (raw === undefined || raw === null || raw === '') return DEFAULT_MISSED_POLICY
    const normalized = String(raw).trim().toLowerCase()
    if (TRUE_VALUES.has(normalized)) return MISSED_POLICY.PRESERVE
    if (FALSE_VALUES.has(normalized)) return MISSED_POLICY.AUTO_SKIP
    return DEFAULT_MISSED_POLICY
}

export function isValidMissedPolicy(value) {
    return value === MISSED_POLICY.PRESERVE || value === MISSED_POLICY.AUTO_SKIP
}

function intervalDaysOf(plant) {
    return toPositiveInt(plant?.watering_interval_days, 7)
}

function wateringHour(plant) {
    const hours = WATERING_TIME_OF_DAY_HOURS
    return hours[plant?.watering_time_of_day] ?? hours.morning
}

export function countMissedSlots({ nextWateringAt, intervalDays, hour, timeZone, now = new Date() } = {}) {
    const { missed } = splitMissedWaterings(
        nextWateringAt,
        intervalDays,
        hour,
        timeZone,
        now
    )
    return missed
}

export function planMissedWateringHandling({
    policy = DEFAULT_MISSED_POLICY,
    plant,
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE
} = {}) {
    const effectivePolicy = isValidMissedPolicy(policy) ? policy : DEFAULT_MISSED_POLICY
    const zone = resolveTimeZone(timeZone)
    const nextWateringAt = toDate(plant?.next_watering_at)
    const missed = nextWateringAt
        ? countMissedSlots({
            nextWateringAt,
            intervalDays: intervalDaysOf(plant),
            hour: wateringHour(plant),
            timeZone: zone,
            now
        })
        : []

    if (!missed.length) {
        return { action: MISSED_ACTION.NOOP, policy: effectivePolicy, missed: [], next: null }
    }

    const { next } = splitMissedWaterings(
        nextWateringAt,
        intervalDaysOf(plant),
        wateringHour(plant),
        zone,
        now
    )

    if (effectivePolicy === MISSED_POLICY.AUTO_SKIP) {
        return {
            action: MISSED_ACTION.ADVANCE,
            policy: effectivePolicy,
            missed,
            next
        }
    }

    const metadata = plant?.metadata && typeof plant.metadata === 'object' && !Array.isArray(plant.metadata)
        ? plant.metadata
        : {}
    const alreadyMarked = Boolean(toDate(metadata.missed_since))

    return {
        action: alreadyMarked ? MISSED_ACTION.NOOP : MISSED_ACTION.MARK_MISSED,
        policy: effectivePolicy,
        missed,
        next,
        missedSince: alreadyMarked ? toDate(metadata.missed_since) : missed[0]
    }
}

export function buildWateringState({
    plant,
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE,
    policy = DEFAULT_MISSED_POLICY
} = {}) {
    const current = toDate(now) ?? new Date()
    const zone = resolveTimeZone(timeZone)
    const effectivePolicy = isValidMissedPolicy(policy) ? policy : DEFAULT_MISSED_POLICY
    const metadata = plant?.metadata && typeof plant.metadata === 'object' && !Array.isArray(plant.metadata)
        ? plant.metadata
        : {}

    const remindersPaused = metadata.reminders_paused === true
    const consecutiveSkips = Number.isInteger(metadata.consecutive_skips)
        ? Math.max(0, metadata.consecutive_skips)
        : 0

    const nextWateringAt = toDate(plant?.next_watering_at)
    const storedMissedSince = toDate(metadata.missed_since)
    const intervalDays = intervalDaysOf(plant)
    const hour = wateringHour(plant)

    const overdue = Boolean(nextWateringAt) &&
        isWateringMissed(nextWateringAt, { now: current, timeZone: zone })

    const missedSlots = nextWateringAt
        ? countMissedSlots({
            nextWateringAt,
            intervalDays,
            hour,
            timeZone: zone,
            now: current
        })
        : []

    const missingSinceIso = storedMissedSince
        ? storedMissedSince.toISOString()
        : missedSlots.length
            ? missedSlots[0].toISOString()
            : overdue
                ? nextWateringAt.toISOString()
                : null

    const missed = overdue || Boolean(missingSinceIso) || missedSlots.length > 0
    const missedSlotDate = toDate(missingSinceIso)
    const lateness = missedSlotDate
        ? resolveMissedLateness(missedSlotDate, { now: current })
        : { hoursLate: 0, daysLate: 0 }

    const backfillUntilDate = missedSlotDate
        ? new Date(missedSlotDate.getTime() + MISSED_BACKFILL_WINDOW_DAYS * DAY_MS)
        : null
    const canBackfill = Boolean(
        missedSlotDate && current.getTime() <= backfillUntilDate.getTime()
    )

    let reason = null
    if (remindersPaused) reason = MISSED_REASON.REMINDERS_PAUSED
    else if (missed) reason = consecutiveSkips > 0 ? MISSED_REASON.AUTO_SKIPPED : MISSED_REASON.MISSED_SLOT

    const nextDayKey = nextWateringAt ? zonedDayKey(nextWateringAt, zone) : null
    const todayKey = zonedDayKey(current, zone)
    const dueToday = Boolean(nextWateringAt) && !overdue && nextDayKey === todayKey

    let status = WATERING_STATE_STATUS.SCHEDULED
    if (remindersPaused) status = WATERING_STATE_STATUS.PAUSED
    else if (overdue || missed) status = WATERING_STATE_STATUS.MISSED
    else if (dueToday) status = WATERING_STATE_STATUS.DUE_TODAY

    return {
        status,
        policy: effectivePolicy,
        scheduled_for: toIso(nextWateringAt),
        overdue,
        missed,
        missed_since: missingSinceIso,
        missed_slots: missedSlots.length || (missingSinceIso ? 1 : 0),
        hours_late: missed ? Math.max(0, Number(lateness.hoursLate) || 0) : 0,
        days_late: missed ? Math.max(0, Number(lateness.daysLate) || 0) : 0,
        can_backfill: canBackfill,
        backfill_until: canBackfill ? backfillUntilDate.toISOString() : null,
        reason,
        grace_hours: MISSED_GRACE_HOUR,
        consecutive_skips: consecutiveSkips,
        reminders_paused: remindersPaused,
        timezone: zone
    }
}

export function buildMissedWateringNotification(plant, {
    missedSince,
    timeZone = DEFAULT_TIME_ZONE,
    now = new Date()
} = {}) {
    const name = truncateText(plant?.name || 'Растение', 80)
    const location = plant?.location
        ? ` (${truncateText(plant.location, 40)})`
        : ''
    const slot = toDate(missedSince)
    const slotLabel = slot ? formatSlotLabel(slot, timeZone) : ''
    const late = slot ? resolveMissedLateness(slot, { now }) : null
    const lateText = late && late.daysLate >= 1
        ? ` Пропуск уже ${late.daysLate} ${pluralDays(late.daysLate)}.`
        : ''

    const body = `«${name}»${location}: полив ${slotLabel ? `был ${slotLabel}` : 'пропущен'}.` +
        `${lateText} Поливайте, если грунт сухой, или отметьте «Пропустить» — план сдвинется сам.`

    return {
        title: '💧 Полив пропущен',
        body: truncateText(body, 1000),
        missed_since: slot ? slot.toISOString() : null
    }
}

function pluralDays(count) {
    const n = Math.abs(Math.trunc(Number(count) || 0))
    if (n % 10 === 1 && n % 100 !== 11) return 'день'
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дня'
    return 'дней'
}

function truncateText(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function formatSlotLabel(slot, timeZone = DEFAULT_TIME_ZONE) {
    const date = toDate(slot)
    if (!date) return ''
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: resolveTimeZone(timeZone),
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(date)
}

export { MISSED_GRACE_MS }

export default {
    DEFAULT_MISSED_POLICY,
    MISSED_ACTION,
    MISSED_BACKFILL_WINDOW_DAYS,
    MISSED_POLICY,
    MISSED_REASON,
    WATERING_STATE_STATUS,
    buildMissedWateringNotification,
    buildWateringState,
    countMissedSlots,
    isValidMissedPolicy,
    planMissedWateringHandling,
    resolveMissedPolicy
}
