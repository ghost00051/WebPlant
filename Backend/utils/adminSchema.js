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

export function resetAdminSchemaCache() {
    cache.clear()
}
