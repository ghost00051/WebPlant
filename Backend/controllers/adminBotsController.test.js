import test from 'node:test'
import assert from 'node:assert/strict'

import sequelize from '../db.js'
import { resetAdminSchemaCache } from '../utils/adminSchema.js'
import adminBotsController, { safeRatio, toInteger } from './adminBotsController.js'

process.env.BOTS_ENABLED = 'true'
process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token'
process.env.TELEGRAM_BOT_USERNAME = 'leyka_test_bot'
process.env.MAX_BOT_TOKEN = 'max-test-token'
process.env.MAX_BOT_USERNAME = 'leyka_max_test'

const BOT_TABLES = {
    bot_links: {
        id: {},
        user_id: {},
        channel: {},
        external_user_id: {},
        is_active: {},
        notifications_enabled: {},
        created_at: {}
    },
    bot_link_codes: {
        code: {},
        user_id: {},
        channel: {},
        expires_at: {},
        used_at: {}
    },
    bot_messages: {
        channel: {},
        direction: {},
        status: {},
        created_at: {}
    },
    notification_preferences: {
        weekly_recap_enabled: {},
        last_weekly_recap_date: {}
    }
}

function createRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        }
    }
}

function withSequelizeStubs({ tables = BOT_TABLES, query = async () => [] }, fn) {
    const originalGetQueryInterface = sequelize.getQueryInterface
    const originalQuery = sequelize.query

    sequelize.getQueryInterface = () => ({
        describeTable: async table => {
            if (tables[table]) return tables[table]
            throw new Error(`relation "${table}" does not exist`)
        }
    })
    sequelize.query = query
    resetAdminSchemaCache()

    return Promise.resolve()
        .then(fn)
        .finally(() => {
            sequelize.getQueryInterface = originalGetQueryInterface
            sequelize.query = originalQuery
            resetAdminSchemaCache()
        })
}

async function callAnalytics(query, { tables } = {}) {
    const res = createRes()
    await withSequelizeStubs({
        tables,
        query
    }, () => adminBotsController.getAnalytics({ query }, res))
    return res
}

test('toInteger и safeRatio', () => {
    assert.equal(toInteger('12'), 12)
    assert.equal(toInteger(undefined), 0)
    assert.equal(toInteger('abc'), 0)
    assert.equal(safeRatio(1, 3), 0.33)
    assert.equal(safeRatio(2, 0), 0)
    assert.equal(safeRatio(0, 4), 0)
})

test('analytics: без таблиц ботов — 200 и нули, tablesReady:false', async () => {
    const res = await callAnalytics(async () => {
        throw new Error('should not be called')
    }, { tables: {} })

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.tablesReady, false)
    assert.equal(res.body.days, 30)
    assert.equal(res.body.timezone, 'Europe/Moscow')
    assert.equal(typeof res.body.generatedAt, 'string')
    assert.deepEqual(res.body.totals, {
        linkedActive: 0,
        linkedNew: 0,
        messagesSent: 0,
        messagesFailed: 0,
        deliveryRate: 0,
        reminderShare: 0
    })
    assert.deepEqual(res.body.series, [])
    assert.deepEqual(res.body.recentErrors, [])
    assert.deepEqual(res.body.commands, [])
    assert.deepEqual(res.body.linkFunnel, { codesCreated: 0, codesUsed: 0, conversion: 0 })
    assert.deepEqual(res.body.recap, {
        notificationsCreated: 0,
        delivered: 0,
        failed: 0,
        users: 0,
        telegram: 0,
        max: 0
    })
    assert.deepEqual(res.body.streak, {
        usersWithStreak: 0,
        avgCurrentStreak: 0,
        bestCurrentStreak: 0
    })
    assert.equal(res.body.channels.telegram.configured, true)
    assert.equal(res.body.channels.telegram.botUsername, 'leyka_test_bot')
    assert.equal(res.body.channels.max.configured, true)
})

test('analytics: невалидный days — 400', async () => {
    for (const days of ['0', '-1', 'abc', '999']) {
        const res = createRes()
        await withSequelizeStubs({}, () => adminBotsController.getAnalytics({ query: { days } }, res))
        assert.equal(res.statusCode, 400, `days=${days}`)
        assert.match(res.body.message, /days/)
    }
})

test('analytics: собирает каналы, серию, воронку, recap и streak', async () => {
    const query = async sql => {
        if (sql.includes('FROM bot_links')) {
            return [
                {
                    channel: 'telegram',
                    linked_active: 2,
                    linked_total: 4,
                    linked_in_range: 1,
                    unlinked_in_range: 1,
                    notifications_disabled: 1
                },
                {
                    channel: 'max',
                    linked_active: 1,
                    linked_total: 1,
                    linked_in_range: 1,
                    unlinked_in_range: 0,
                    notifications_disabled: 0
                }
            ]
        }
        if (sql.includes('FROM bot_link_codes')) {
            return [{ channel: 'telegram', codes_created: 4, codes_used: 2 }]
        }
        if (sql.includes('AS messages_sent')) {
            return [
                {
                    channel: 'telegram',
                    messages_sent: 10,
                    messages_failed: 2,
                    messages_skipped: 0,
                    reminders_sent: 6,
                    last_sent_at: new Date('2026-10-25T10:00:00Z')
                },
                {
                    channel: 'max',
                    messages_sent: 5,
                    messages_failed: 0,
                    messages_skipped: 1,
                    reminders_sent: 2,
                    last_sent_at: null
                }
            ]
        }
        if (sql.includes('kind, error, created_at')) {
            return [{
                channel: 'telegram',
                kind: 'reminder',
                error: 'timeout',
                created_at: new Date('2026-10-25T09:00:00Z')
            }]
        }
        if (sql.includes('generate_series')) {
            return [
                {
                    day: '2026-10-24',
                    telegram_sent: 4,
                    telegram_failed: 1,
                    max_sent: 2,
                    max_failed: 0
                },
                {
                    day: new Date('2026-10-25T00:00:00Z'),
                    telegram_sent: 6,
                    telegram_failed: 1,
                    max_sent: 3,
                    max_failed: 0
                }
            ]
        }
        if (sql.includes("command <> ''")) {
            return [
                { channel: 'telegram', command: 'start', count: 3 },
                { channel: 'telegram', command: 'status', count: 1 }
            ]
        }
        if (sql.includes("kind = 'weekly_recap'")) {
            return [{ channel: 'telegram', delivered: 2, failed: 1 }]
        }
        if (sql.includes('notifications_created')) {
            return [{ notifications_created: 3, users: 2 }]
        }
        if (sql.includes('AS users_with_streak')) {
            return [{ users_with_streak: 2, avg_current_streak: 3.5, best_current_streak: 5 }]
        }
        return []
    }

    const res = await callAnalytics(query, { tables: BOT_TABLES })
    assert.equal(res.statusCode, 200)
    const body = res.body

    assert.equal(body.tablesReady, true)
    assert.equal(body.days, 30)

    const telegram = body.channels.telegram
    assert.equal(telegram.linkedActive, 2)
    assert.equal(telegram.linkedTotal, 4)
    assert.equal(telegram.linkedInRange, 1)
    assert.equal(telegram.unlinkedInRange, 1)
    assert.equal(telegram.notificationsDisabled, 1)
    assert.equal(telegram.codesCreated, 4)
    assert.equal(telegram.codesUsed, 2)
    assert.equal(telegram.codeConversion, 0.5)
    assert.equal(telegram.messagesSent, 10)
    assert.equal(telegram.messagesFailed, 2)
    assert.equal(telegram.deliveryRate, 0.83)
    assert.equal(telegram.remindersSent, 6)
    assert.equal(telegram.lastSentAt, '2026-10-25T10:00:00.000Z')
    assert.equal(telegram.lastError, 'timeout')
    assert.equal(telegram.configured, true)
    assert.equal(telegram.botUsername, 'leyka_test_bot')

    const max = body.channels.max
    assert.equal(max.linkedActive, 1)
    assert.equal(max.codeConversion, 0)
    assert.equal(max.deliveryRate, 1)
    assert.equal(max.lastSentAt, null)
    assert.equal(max.lastError, null)

    assert.deepEqual(body.totals, {
        linkedActive: 3,
        linkedNew: 2,
        messagesSent: 15,
        messagesFailed: 2,
        deliveryRate: 0.88,
        reminderShare: 0.53
    })

    assert.deepEqual(body.linkFunnel, { codesCreated: 4, codesUsed: 2, conversion: 0.5 })
    assert.equal(body.series.length, 2)
    assert.deepEqual(body.series[0], {
        day: '2026-10-24',
        telegramSent: 4,
        telegramFailed: 1,
        maxSent: 2,
        maxFailed: 0
    })
    assert.equal(body.series[1].day, '2026-10-25')

    assert.equal(body.recentErrors.length, 1)
    assert.deepEqual(body.recentErrors[0], {
        channel: 'telegram',
        kind: 'reminder',
        error: 'timeout',
        createdAt: '2026-10-25T09:00:00.000Z'
    })

    assert.equal(body.commands.length, 2)
    assert.deepEqual(body.commands[0], { channel: 'telegram', command: 'start', count: 3 })

    assert.deepEqual(body.recap, {
        notificationsCreated: 3,
        delivered: 2,
        failed: 1,
        users: 2,
        telegram: 2,
        max: 0
    })
    assert.deepEqual(body.streak, {
        usersWithStreak: 2,
        avgCurrentStreak: 3.5,
        bestCurrentStreak: 5
    })
})

test('analytics: ошибки запросов не дают 500, отдаёт нули', async () => {
    const res = await callAnalytics(async () => {
        throw new Error('db is down')
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.tablesReady, true)
    assert.equal(res.body.channels.telegram.messagesSent, 0)
    assert.equal(res.body.series.length, 0)
    assert.equal(res.body.streak.bestCurrentStreak, 0)
})

test('analytics: days из query применяется и попадает в ответ', async () => {
    const binds = []
    const res = await withSequelizeStubs({
        query: async (sql, options) => {
            binds.push(options?.bind)
            return []
        }
    }, async () => {
        const response = createRes()
        await adminBotsController.getAnalytics({ query: { days: '7' } }, response)
        return response
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.days, 7)
    assert.ok(binds.length > 0)
    assert.ok(binds.every(bind => Array.isArray(bind)))
    assert.ok(binds.some(bind => bind[0] === 7))
})
