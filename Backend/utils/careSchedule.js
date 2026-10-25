import { CARE_ACTION_CODES, careTitleFor } from './careLogs.js'
import { diffLocalDays, localDayKey } from './localDay.js'
import { getSeasonInfo } from './wateringKnowledge.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIME_ZONE = 'Europe/Moscow'
const DEFAULT_DAYS = 90

function toValidDate(value) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

function normalizePlan(plan) {
    return plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {}
}

function collectLastActions(logs) {
    const lastActions = new Map()
    for (const log of Array.isArray(logs) ? logs : []) {
        const performedAt = toValidDate(log?.performed_at)
        const actionCode = typeof log?.action_code === 'string' ? log.action_code : ''
        const plantId = Number(log?.plant_id)
        if (!performedAt || !CARE_ACTION_CODES.includes(actionCode) || !Number.isInteger(plantId)) {
            continue
        }

        const key = `${plantId}:${actionCode}`
        const current = lastActions.get(key)
        if (!current || performedAt.getTime() > current.getTime()) {
            lastActions.set(key, performedAt)
        }
    }
    return lastActions
}

function resolveIntervalDays(entry) {
    const maxPerMonth = Number(entry?.maxPerMonth)
    if (Number.isFinite(maxPerMonth) && maxPerMonth <= 0) return null

    const minIntervalDays = Number(entry?.minIntervalDays)
    if (!Number.isFinite(minIntervalDays) || minIntervalDays < 1) return null
    return Math.round(minIntervalDays)
}

function isSeasonAllowed(entry, date, timeZone) {
    if (!Array.isArray(entry?.seasons)) return true
    const season = getSeasonInfo(date, timeZone).season
    return entry.seasons.includes(season)
}

export function buildCareSchedule({
    plants = [],
    logs = [],
    now = new Date(),
    days = DEFAULT_DAYS,
    timeZone = DEFAULT_TIME_ZONE
} = {}) {
    const nowDate = toValidDate(now) || new Date()
    const zone = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : DEFAULT_TIME_ZONE
    const parsedDays = Number(days)
    const horizonDays = Number.isFinite(parsedDays) ? Math.max(0, Math.trunc(parsedDays)) : DEFAULT_DAYS
    const lastActions = collectLastActions(logs)
    const items = []
    const seen = new Set()

    for (const plant of Array.isArray(plants) ? plants : []) {
        const plantId = Number(plant?.id)
        if (!Number.isInteger(plantId)) continue

        const plan = normalizePlan(plant?.plan)
        for (const actionCode of CARE_ACTION_CODES) {
            const entry = plan[actionCode]
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue

            const intervalDays = resolveIntervalDays(entry)
            if (intervalDays === null) continue

            const base = lastActions.get(`${plantId}:${actionCode}`) || nowDate
            let next = new Date(base.getTime() + intervalDays * DAY_MS)
            if (!Number.isFinite(next.getTime())) continue
            if (next.getTime() < nowDate.getTime()) next = nowDate

            const dateKey = localDayKey(next, zone)
            if (!dateKey) continue

            const daysAhead = diffLocalDays(next, nowDate, zone)
            if (daysAhead === null || daysAhead < 0 || daysAhead > horizonDays) continue
            if (!isSeasonAllowed(entry, next, zone)) continue

            const dedupeKey = `${dateKey}:${plantId}:${actionCode}`
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)

            items.push({
                date: dateKey,
                action_code: actionCode,
                title: careTitleFor(actionCode),
                plant_id: plantId,
                plant_name: plant?.name ?? null
            })
        }
    }

    items.sort((left, right) => {
        if (left.date !== right.date) return left.date < right.date ? -1 : 1
        if (left.plant_id !== right.plant_id) return left.plant_id - right.plant_id
        if (left.action_code === right.action_code) return 0
        return left.action_code < right.action_code ? -1 : 1
    })

    return { items }
}
