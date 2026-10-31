import { Op } from 'sequelize'

export const NOTIFICATION_CATEGORIES = Object.freeze({
    watering: Object.freeze([
        'watering_due',
        'watering_day_before',
        'morning_summary',
        'weekly_recap'
    ]),
    care: Object.freeze(['care_reminder', 'care_tip']),
    garden: Object.freeze(['garden_view'])
})

export const DEFAULT_NOTIFICATION_CATEGORY = 'all'
export const NOTIFICATION_CATEGORY_KEYS = Object.freeze(Object.keys(NOTIFICATION_CATEGORIES))
export const NOTIFICATION_CATEGORY_TYPES = Object.freeze(
    Object.values(NOTIFICATION_CATEGORIES).flat()
)

export function parseNotificationCategory(value) {
    if (value === undefined) return DEFAULT_NOTIFICATION_CATEGORY
    if (typeof value !== 'string') return null
    if (value === DEFAULT_NOTIFICATION_CATEGORY) return value
    if (!Object.hasOwn(NOTIFICATION_CATEGORIES, value)) return null
    return value
}

export function categoryWhere(category) {
    if (category === DEFAULT_NOTIFICATION_CATEGORY) return {}
    const types = NOTIFICATION_CATEGORIES[category]
    return { type: { [Op.in]: [...types] } }
}

export function typeToNotificationCategory(type) {
    if (typeof type !== 'string') return null
    for (const category of NOTIFICATION_CATEGORY_KEYS) {
        if (NOTIFICATION_CATEGORIES[category].includes(type)) return category
    }
    return null
}

export function buildUnreadByCategory(rows) {
    const result = emptyNotificationCategoryTotals()
    if (!Array.isArray(rows)) return result

    for (const row of rows) {
        const count = Number(row?.count)
        if (!Number.isFinite(count) || count <= 0) continue
        const type = typeof row?.type === 'string' ? row.type : null
        const category = typeToNotificationCategory(type)
        if (!category) continue
        result.all += count
        result[category] += count
    }
    return result
}

export function emptyNotificationCategoryTotals() {
    const result = { all: 0 }
    for (const category of NOTIFICATION_CATEGORY_KEYS) result[category] = 0
    return result
}
