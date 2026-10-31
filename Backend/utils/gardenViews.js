export const GARDEN_VIEW_NOTIFICATION_TYPE = 'garden_view'

export const GARDEN_VIEW_NOTIFICATION_TITLE = 'Ваш сад посмотрели'

export const GARDEN_VIEW_NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000

export const GARDEN_VIEW_BODY_MAX_LENGTH = 1000

function toCount(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function pluralTimes(count) {
    const n = Math.abs(Math.trunc(Number(count) || 0))
    if (n % 10 === 1 && n % 100 !== 11) return 'раз'
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'раза'
    return 'раз'
}

function toDate(value) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
}

export function shouldNotifyGardenViews({
    viewCount,
    viewsNotifiedCount,
    viewsNotifiedAt = null,
    now = new Date(),
    intervalMs = GARDEN_VIEW_NOTIFY_INTERVAL_MS
} = {}) {
    const current = toCount(viewCount)
    if (current < 1) return false

    const notifiedCount = toCount(viewsNotifiedCount)
    if (current <= notifiedCount) return false

    const notifiedAt = toDate(viewsNotifiedAt)
    if (!notifiedAt) return true

    const nowDate = toDate(now) ?? new Date()
    const interval = Number.isFinite(intervalMs) && intervalMs > 0
        ? intervalMs
        : GARDEN_VIEW_NOTIFY_INTERVAL_MS
    return nowDate.getTime() - notifiedAt.getTime() >= interval
}

export function buildGardenViewNotification({ viewCount } = {}) {
    const count = Math.max(1, toCount(viewCount))
    const body = `Публичную ссылку на сад открыли ${count} ${pluralTimes(count)}. ` +
        'Чем чаще делитесь, тем интереснее сад 🌿'

    return {
        type: GARDEN_VIEW_NOTIFICATION_TYPE,
        title: GARDEN_VIEW_NOTIFICATION_TITLE,
        body: body.length > GARDEN_VIEW_BODY_MAX_LENGTH
            ? `${body.slice(0, GARDEN_VIEW_BODY_MAX_LENGTH - 1).trimEnd()}…`
            : body,
        url: '/profile',
        payload: { viewCount: count }
    }
}

export function gardenViewDedupeKey(shareId, viewCount) {
    const id = Number(shareId)
    if (!Number.isInteger(id) || id < 1) return null
    return `garden-share:${id}:view:${Math.max(1, toCount(viewCount))}`
}

export default {
    GARDEN_VIEW_BODY_MAX_LENGTH,
    GARDEN_VIEW_NOTIFICATION_TITLE,
    GARDEN_VIEW_NOTIFICATION_TYPE,
    GARDEN_VIEW_NOTIFY_INTERVAL_MS,
    buildGardenViewNotification,
    gardenViewDedupeKey,
    shouldNotifyGardenViews
}
