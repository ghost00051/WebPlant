import sequelize from '../db.js'


const cache = new Map()

async function describe(table) {
    if (cache.has(table)) return cache.get(table)
    let columns = {}
    try {
        columns = await sequelize.getQueryInterface().describeTable(table)
    } catch {
        columns = {}
    }
    cache.set(table, columns)
    return columns
}

export async function hasColumn(table, column) {
    const columns = await describe(table)
    return Boolean(columns && columns[column])
}

export async function hasUsersCreatedAt() {
    return hasColumn('users', 'created_at')
}

export async function hasSiteVisitDays() {
    const columns = await describe('site_visit_days')
    return Boolean(columns && columns.day)
}

export async function hasSiteVisitUtm() {
    return hasColumn('site_visit_days', 'utm_source')
}

export async function hasProductEvents() {
    const columns = await describe('product_events')
    return Boolean(columns && columns.event && columns.created_at)
}

export async function hasNotificationClicks() {
    const columns = await describe('notifications')
    return Boolean(columns && columns.click_count && columns.clicked_at)
}

export async function hasNotifications() {
    const columns = await describe('notifications')
    return Boolean(columns && columns.created_at && columns.user_id)
}

export async function hasChatLogs() {
    const columns = await describe('chat_logs')
    return Boolean(columns && columns.user_id && columns.role && columns.created_at)
}

export async function hasAiAdviceLogs() {
    const columns = await describe('ai_advice_logs')
    return Boolean(columns && columns.user_id && columns.created_at)
}

export async function hasUsersPrivilegeLevel() {
    return hasColumn('users', 'privilege_level')
}

export async function hasUserLegalConsents() {
    const columns = await describe('user_legal_consents')
    return Boolean(columns && columns.user_id && columns.accepted_at && columns.source)
}

export async function hasGardenShares() {
    const columns = await describe('garden_shares')
    return Boolean(
        columns &&
        columns.id &&
        columns.user_id &&
        columns.token &&
        columns.view_count &&
        columns.revoked_at
    )
}

export async function hasGardenShareSignups() {
    const columns = await describe('garden_share_signups')
    return Boolean(
        columns &&
        columns.id &&
        columns.share_id &&
        columns.user_id &&
        columns.created_at
    )
}

export function resetAdminSchemaCache() {
    cache.clear()
}
