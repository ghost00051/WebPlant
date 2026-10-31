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

export const METRIC_STATUSES = Object.freeze(['measured', 'partial', 'unavailable'])
export const METRIC_UNITS = Object.freeze(['seconds', 'percent', 'rub'])
export const MISSING_METRIC_DISPLAY = '—'

export function formatMetricSeconds(value) {
    const numeric = Number(value)
    if (value === null || value === undefined || !Number.isFinite(numeric)) return MISSING_METRIC_DISPLAY
    return `${Math.round(numeric)} с`
}

export function formatMetricPercent(value) {
    const numeric = Number(value)
    if (value === null || value === undefined || !Number.isFinite(numeric)) return MISSING_METRIC_DISPLAY
    const text = numeric.toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${text}%`
}

export function formatMetricRub(value) {
    const numeric = Number(value)
    if (value === null || value === undefined || !Number.isFinite(numeric)) return MISSING_METRIC_DISPLAY
    const text = numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
    return `${text} ₽`
}

export function formatMetricValue(value, unit) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return MISSING_METRIC_DISPLAY
    }
    if (unit === 'seconds') return formatMetricSeconds(value)
    if (unit === 'percent') return formatMetricPercent(value)
    if (unit === 'rub') return formatMetricRub(value)
    return String(Number(value))
}

export function normalizeMetricStatus(value) {
    return METRIC_STATUSES.includes(value) ? value : 'unavailable'
}

export function targetAtLeast(value, target) {
    if (value === null || value === undefined) return null
    const actual = Number(value)
    const threshold = Number(target)
    if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return null
    return actual >= threshold
}

export function targetAtMost(value, target) {
    if (value === null || value === undefined) return null
    const actual = Number(value)
    const threshold = Number(target)
    if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return null
    return actual <= threshold
}

export function buildMetricItem(definition = {}, result = {}) {
    const unit = METRIC_UNITS.includes(result.unit)
        ? result.unit
        : (METRIC_UNITS.includes(definition.unit) ? definition.unit : 'percent')
    const status = normalizeMetricStatus(result.status)
    const numeric = Number(result.value)
    const hasValue = status !== 'unavailable' &&
        result.value !== null &&
        result.value !== undefined &&
        Number.isFinite(numeric)
    const value = hasValue ? numeric : null
    let targetMet = null
    if (hasValue && typeof result.targetMet === 'boolean') targetMet = result.targetMet

    return {
        id: definition.id || '',
        label: definition.label || definition.id || '',
        priority: definition.priority || 'P2',
        horizon: definition.horizon || '',
        target: definition.target || '',
        status,
        value,
        unit,
        display: hasValue ? formatMetricValue(value, unit) : MISSING_METRIC_DISPLAY,
        detail: typeof result.detail === 'string' ? result.detail : '',
        source: definition.source || '',
        targetMet
    }
}

export function buildMetricsSummary(items) {
    const list = Array.isArray(items) ? items : []
    const summary = { total: list.length, measured: 0, partial: 0, unavailable: 0 }
    for (const item of list) {
        summary[normalizeMetricStatus(item?.status)] += 1
    }
    return summary
}
