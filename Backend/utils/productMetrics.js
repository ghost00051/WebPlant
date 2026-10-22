const DEFAULT_DIGITS = 1

export const RETENTION_WINDOWS = Object.freeze([
    Object.freeze({ key: 'd1', days: 1 }),
    Object.freeze({ key: 'd7', days: 7 }),
    Object.freeze({ key: 'd30', days: 30 })
])

export const RETENTION_MAX_DAYS = Math.max(...RETENTION_WINDOWS.map(window => window.days))

export function toCount(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

export function percent(part, total, digits = DEFAULT_DIGITS) {
    const denominator = toCount(total)
    if (!denominator) return 0
    return Number(((toCount(part) / denominator) * 100).toFixed(digits))
}

export function computeFunnel(raw = {}) {
    const registered = toCount(raw.registered)
    const plantCreated = toCount(raw.plantCreated)
    const wateringMarked = toCount(raw.wateringMarked)
    const pushSubscribed = toCount(raw.pushSubscribed)

    return {
        registered,
        plantCreated,
        wateringMarked,
        pushSubscribed,
        rates: {
            plantCreated: percent(plantCreated, registered),
            wateringMarked: percent(wateringMarked, registered),
            pushSubscribed: percent(pushSubscribed, registered)
        }
    }
}

export function formatCohortLabel(cohort) {
    if (typeof cohort !== 'string') return ''
    const [year, month, day] = cohort.slice(0, 10).split('-')
    if (!year || !month || !day) return ''
    return `${day}.${month}`
}

export function computeRetention(rows) {
    const list = (Array.isArray(rows) ? rows : [])
        .filter(row => row && typeof row.cohort === 'string' && row.cohort)
        .map(row => {
            const size = toCount(row.size)
            const point = {
                cohort: row.cohort.slice(0, 10),
                cohortLabel: formatCohortLabel(row.cohort),
                size
            }
            for (const window of RETENTION_WINDOWS) {
                point[window.key] = toCount(row[window.key])
            }
            for (const window of RETENTION_WINDOWS) {
                point[`${window.key}Rate`] = percent(point[window.key], size)
            }
            return point
        })

    return list.sort((left, right) => right.cohort.localeCompare(left.cohort))
}

export function buildActivity(raw = {}) {
    return {
        dau: toCount(raw.dau),
        wau: toCount(raw.wau),
        mau: toCount(raw.mau),
        activeUsers: toCount(raw.activeUsers),
        newUsers: toCount(raw.newUsers),
        eventsToday: toCount(raw.eventsToday),
        eventsInRange: toCount(raw.eventsInRange)
    }
}

export function buildPushMetrics(raw = {}) {
    const notifications = toCount(raw.notifications)
    const clicks = toCount(raw.clicks)
    return {
        notifications,
        clicks,
        ctr: percent(clicks, notifications),
        clickedToday: toCount(raw.clickedToday)
    }
}
