import { DEFAULT_TIME_ZONE, resolveTimeZone } from './timeZone.js'

export const DAY_MS = 24 * 60 * 60 * 1000

export const ON_TIME_GRACE_HOURS = 24

export const STREAK_WINDOW_DAYS = 365

export const FREEZES_PER_WEEK_DEFAULT = 1

export const MAX_FREEZES_PER_WEEK = 7

export const WEEKLY_RECAP_TYPE = 'weekly_recap'
export const WEEKLY_RECAP_TITLE = '🌿 Итоги недели'
export const WEEKLY_RECAP_URL = '/home'
export const WEEKLY_RECAP_BODY_MAX_LENGTH = 1000

export const WEEK_DAY_STATUS = Object.freeze({
    watered: 'watered',
    late: 'late',
    skipped: 'skipped',
    none: 'none'
})

const RECAP_FALLBACK_BODY = 'На этой неделе без активности 🌱'

function toDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
    if (value === null || value === undefined || value === '') return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

function toCount(value) {
    if (Array.isArray(value)) return value.length
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.trunc(parsed)
}

function clampText(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function pad2(value) {
    return String(value).padStart(2, '0')
}

function dateKeyFromParts({ year, month, day }) {
    return `${year}-${pad2(month)}-${pad2(day)}`
}

function isoWeekdayOfParts({ year, month, day }) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    return weekday === 0 ? 7 : weekday
}

export function zonedDateParts(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = toDate(value) ?? new Date()
    const zone = resolveTimeZone(timeZone)
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date)

    const result = {}
    for (const part of parts) {
        if (part.type !== 'literal') result[part.type] = Number(part.value)
    }
    return { ...result, isoWeekday: isoWeekdayOfParts(result) }
}

function zonedMidnightToUtc({ year, month, day }, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day)
    const zoned = zonedDateParts(new Date(utcGuess), timeZone)
    const zonedAsUtc = Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hour,
        zoned.minute,
        zoned.second
    )
    return new Date(utcGuess - (zonedAsUtc - utcGuess))
}

function addDaysToParts(parts, days) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS)
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate()
    }
}

export function weekWindow(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const zone = resolveTimeZone(timeZone)
    const current = toDate(now) ?? new Date()
    const parts = zonedDateParts(current, zone)
    const mondayParts = addDaysToParts(parts, -(parts.isoWeekday - 1))
    const nextMondayParts = addDaysToParts(mondayParts, 7)

    return {
        startDate: dateKeyFromParts(mondayParts),
        start: zonedMidnightToUtc(mondayParts, zone),
        end: zonedMidnightToUtc(nextMondayParts, zone),
        timeZone: zone
    }
}

function lateHoursOf(event) {
    const parsed = Number(event?.hours_late)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function isOnTimeWatering(event) {
    return event?.action === 'watered' && lateHoursOf(event) <= ON_TIME_GRACE_HOURS
}

function isLateWatering(event) {
    return event?.action === 'watered' && lateHoursOf(event) > ON_TIME_GRACE_HOURS
}

function breaksStreak(event) {
    return event?.action === 'skipped' || isLateWatering(event)
}

function breakKind(event) {
    return event?.action === 'skipped' ? 'skipped' : 'late_watering'
}

function eventTime(event) {
    return toDate(event?.action_at ?? event?.created_at)
}

export function localDateKey(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = toDate(value)
    if (!date) return null
    return dateKeyFromParts(zonedDateParts(date, timeZone))
}

export function resolveFreezesPerWeek(env = process.env) {
    const raw = env?.STREAK_FREEZES_PER_WEEK
    if (raw === undefined || raw === null || raw === '') return FREEZES_PER_WEEK_DEFAULT
    const parsed = Number.parseInt(String(raw).trim(), 10)
    if (!Number.isInteger(parsed) || parsed < 0) return FREEZES_PER_WEEK_DEFAULT
    return Math.min(parsed, MAX_FREEZES_PER_WEEK)
}

function emptyFreezeState(perWeek, currentWeekStart, enabled) {
    return {
        enabled,
        perWeek,
        weekStart: currentWeekStart,
        usedThisWeek: 0,
        availableThisWeek: enabled ? perWeek : 0,
        usedTotal: 0,
        used: []
    }
}

export function computeCareStreak(events = [], {
    now = new Date(),
    windowDays = STREAK_WINDOW_DAYS,
    timeZone = DEFAULT_TIME_ZONE,
    freezesPerWeek = FREEZES_PER_WEEK_DEFAULT
} = {}) {
    const current = toDate(now) ?? new Date()
    const zone = resolveTimeZone(timeZone)
    const windowStartMs = current.getTime() - toCount(windowDays || STREAK_WINDOW_DAYS) * DAY_MS
    const nowMs = current.getTime()
    const perWeek = Number.isInteger(freezesPerWeek) && freezesPerWeek > 0
        ? Math.min(freezesPerWeek, MAX_FREEZES_PER_WEEK)
        : 0
    const freezeEnabled = perWeek > 0
    const currentWeekStart = weekWindow(current, zone).startDate

    const ordered = (Array.isArray(events) ? events : [])
        .map(event => ({ event, at: eventTime(event) }))
        .filter(({ at }) => at && at.getTime() >= windowStartMs && at.getTime() <= nowMs)
        .sort((left, right) => left.at.getTime() - right.at.getTime())

    let streak = 0
    let best = 0
    let lastWateredAt = null
    const freezesByWeek = new Map()
    const frozenDays = new Set()
    const usedFreezes = []
    let streakBreak = null

    for (const { event, at } of ordered) {
        if (event?.action === 'watered') lastWateredAt = at
        if (isOnTimeWatering(event)) {
            streak += 1
            if (streak > best) best = streak
            continue
        }
        if (!breaksStreak(event)) continue

        const dayKey = localDateKey(at, zone)
        const weekStart = weekWindow(at, zone).startDate
        const hoursLate = lateHoursOf(event)

        if (dayKey && frozenDays.has(dayKey)) {
            continue
        }

        const usedInWeek = freezesByWeek.get(weekStart) ?? 0
        const canFreeze = freezeEnabled && dayKey !== null && usedInWeek < perWeek

        if (canFreeze) {
            freezesByWeek.set(weekStart, usedInWeek + 1)
            frozenDays.add(dayKey)
            usedFreezes.push({
                at: at.toISOString(),
                localDate: dayKey,
                weekStart,
                kind: breakKind(event),
                hoursLate
            })
            continue
        }

        streak = 0
        streakBreak = {
            reason: breakKind(event),
            at: at.toISOString(),
            localDate: dayKey,
            hoursLate,
            weekStart,
            freezeAvailable: false
        }
    }

    const usedThisWeek = freezesByWeek.get(currentWeekStart) ?? 0

    return {
        current: streak,
        best,
        lastWateredAt: lastWateredAt ? lastWateredAt.toISOString() : null,
        freeze: {
            ...emptyFreezeState(perWeek, currentWeekStart, freezeEnabled),
            usedThisWeek,
            availableThisWeek: freezeEnabled ? Math.max(0, perWeek - usedThisWeek) : 0,
            usedTotal: usedFreezes.length,
            used: usedFreezes.slice(-20)
        },
        streakBreak
    }
}

export function summarizeWeek(events = [], {
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE,
    photos = 0,
    careActions = 0
} = {}) {
    const current = toDate(now) ?? new Date()
    const window = weekWindow(current, timeZone)
    const startMs = window.start.getTime()
    const endMs = Math.min(window.end.getTime(), current.getTime())

    const days = new Map()
    for (let offset = 0; offset < 7; offset += 1) {
        const parts = addDaysToParts(zonedDateParts(window.start, window.timeZone), offset)
        const key = dateKeyFromParts(parts)
        days.set(key, { date: key, status: WEEK_DAY_STATUS.none })
    }

    let wateredOnTime = 0
    let wateredLate = 0
    let skipped = 0

    for (const event of (Array.isArray(events) ? events : [])) {
        const at = eventTime(event)
        if (!at) continue
        const atMs = at.getTime()
        if (atMs < startMs || atMs > endMs) continue

        const day = days.get(dateKeyFromParts(zonedDateParts(at, window.timeZone)))
        if (!day) continue

        if (isOnTimeWatering(event)) {
            wateredOnTime += 1
            day.status = WEEK_DAY_STATUS.watered
            continue
        }
        if (isLateWatering(event)) {
            wateredLate += 1
            if (day.status === WEEK_DAY_STATUS.none) day.status = WEEK_DAY_STATUS.late
            continue
        }
        if (event?.action === 'skipped') {
            skipped += 1
            if (day.status === WEEK_DAY_STATUS.none) day.status = WEEK_DAY_STATUS.skipped
        }
    }

    return {
        wateredOnTime,
        wateredLate,
        skipped,
        scheduled: wateredOnTime + wateredLate + skipped,
        photos: toCount(photos),
        careActions: toCount(careActions),
        startDate: window.startDate,
        days: [...days.values()]
    }
}

function pluralRu(count, forms) {
    const n = Math.abs(Math.trunc(Number(count) || 0))
    if (n % 10 === 1 && n % 100 !== 11) return forms[0]
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return forms[1]
    return forms[2]
}

function wateringNounAfterIz(count) {
    return pluralRu(count, ['полива', 'поливов', 'поливов'])
}

export function buildWeeklyRecap({ week = {}, streak = {}, now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
    const stats = summarizeWeek([], {
        now,
        timeZone,
        photos: week?.photos,
        careActions: week?.careActions
    })
    const normalizedWeek = {
        ...stats,
        ...(week && typeof week === 'object' && !Array.isArray(week) ? week : {})
    }

    const scheduled = toCount(normalizedWeek.scheduled)
    const watered = toCount(normalizedWeek.wateredOnTime) + toCount(normalizedWeek.wateredLate)
    const parts = []

    if (scheduled > 0) {
        parts.push(`${watered} из ${scheduled} ${wateringNounAfterIz(scheduled)}`)
    }
    if (normalizedWeek.photos > 0) {
        parts.push(`${normalizedWeek.photos} фото`)
    }
    if (normalizedWeek.careActions > 0) {
        parts.push(
            `${normalizedWeek.careActions} ${pluralRu(normalizedWeek.careActions, ['действие', 'действия', 'действий'])} ухода`
        )
    }
    if (toCount(streak.current) > 0) {
        parts.push(`серия ${toCount(streak.current)} 🔥`)
    }

    const body = clampText(
        parts.length ? parts.join(', ') : RECAP_FALLBACK_BODY,
        WEEKLY_RECAP_BODY_MAX_LENGTH
    )

    return {
        title: WEEKLY_RECAP_TITLE,
        body,
        payload: {
            stats: normalizedWeek,
            streak: {
                current: toCount(streak.current),
                best: toCount(streak.best),
                lastWateredAt: streak.lastWateredAt ?? null
            }
        }
    }
}
