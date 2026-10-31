import { QueryTypes } from 'sequelize'

import sequelize from '../db.js'
import * as adminSchema from '../utils/adminSchema.js'
import { TIMEZONE, parseRangeDays } from '../utils/adminAnalytics.js'
import * as botConfig from '../utils/botConfig.js'

const DAY_INTERVAL = `($1::int * INTERVAL '1 day')`

const LINKS_SQL = `
SELECT channel,
       count(*) FILTER (WHERE is_active)::int AS linked_active,
       count(*)::int AS linked_total,
       count(*) FILTER (
           WHERE created_at >= now() - ${DAY_INTERVAL}
       )::int AS linked_in_range,
       count(*) FILTER (
           WHERE unlinked_at >= now() - ${DAY_INTERVAL}
       )::int AS unlinked_in_range,
       count(*) FILTER (
           WHERE is_active AND notifications_enabled = false
       )::int AS notifications_disabled
FROM bot_links
WHERE channel IN ('telegram', 'max')
GROUP BY channel`

const CODES_SQL = `
SELECT channel,
       count(*) FILTER (
           WHERE created_at >= now() - ${DAY_INTERVAL}
       )::int AS codes_created,
       count(*) FILTER (
           WHERE used_at >= now() - ${DAY_INTERVAL}
       )::int AS codes_used
FROM bot_link_codes
WHERE channel IN ('telegram', 'max')
GROUP BY channel`

const MESSAGES_SQL = `
SELECT channel,
       count(*) FILTER (
           WHERE direction = 'out' AND status = 'sent'
             AND created_at >= now() - ${DAY_INTERVAL}
       )::int AS messages_sent,
       count(*) FILTER (
           WHERE direction = 'out' AND status = 'failed'
             AND created_at >= now() - ${DAY_INTERVAL}
       )::int AS messages_failed,
       count(*) FILTER (
           WHERE direction = 'out' AND status = 'skipped'
             AND created_at >= now() - ${DAY_INTERVAL}
       )::int AS messages_skipped,
       count(*) FILTER (
           WHERE direction = 'out' AND status = 'sent' AND kind = 'reminder'
             AND created_at >= now() - ${DAY_INTERVAL}
       )::int AS reminders_sent,
       max(sent_at) FILTER (
           WHERE direction = 'out' AND status = 'sent'
       ) AS last_sent_at
FROM bot_messages
WHERE channel IN ('telegram', 'max')
GROUP BY channel`

const ERRORS_SQL = `
SELECT channel, kind, error, created_at
FROM bot_messages
WHERE direction = 'out' AND status = 'failed'
  AND created_at >= now() - ${DAY_INTERVAL}
ORDER BY created_at DESC
LIMIT 10`

const SERIES_SQL = `
WITH days AS (
    SELECT generate_series(
        (now() AT TIME ZONE '${TIMEZONE}')::date - ($1::int - 1),
        (now() AT TIME ZONE '${TIMEZONE}')::date,
        INTERVAL '1 day'
    )::date AS day
),
agg AS (
    SELECT (created_at AT TIME ZONE '${TIMEZONE}')::date AS day,
           channel,
           count(*) FILTER (
               WHERE direction = 'out' AND status = 'sent'
           )::int AS sent,
           count(*) FILTER (
               WHERE direction = 'out' AND status = 'failed'
           )::int AS failed
    FROM bot_messages
    WHERE created_at >= now() - ${DAY_INTERVAL}
      AND channel IN ('telegram', 'max')
    GROUP BY 1, 2
)
SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(CASE WHEN a.channel = 'telegram' THEN a.sent END), 0)::int AS telegram_sent,
       COALESCE(SUM(CASE WHEN a.channel = 'telegram' THEN a.failed END), 0)::int AS telegram_failed,
       COALESCE(SUM(CASE WHEN a.channel = 'max' THEN a.sent END), 0)::int AS max_sent,
       COALESCE(SUM(CASE WHEN a.channel = 'max' THEN a.failed END), 0)::int AS max_failed
FROM days d
LEFT JOIN agg a ON a.day = d.day
GROUP BY d.day
ORDER BY d.day`

const COMMANDS_SQL = `
SELECT channel, command, count(*)::int AS count
FROM bot_messages
WHERE direction = 'in'
  AND command IS NOT NULL
  AND command <> ''
  AND created_at >= now() - ${DAY_INTERVAL}
GROUP BY channel, command
ORDER BY count DESC, command ASC
LIMIT 20`

const RECAP_SQL = `
SELECT
    (SELECT count(*)
       FROM notifications
      WHERE type = 'weekly_recap'
        AND created_at >= now() - ${DAY_INTERVAL})::int AS notifications_created,
    (SELECT count(DISTINCT user_id)
       FROM notifications
      WHERE type = 'weekly_recap'
        AND created_at >= now() - ${DAY_INTERVAL})::int AS users`

const RECAP_DELIVERY_SQL = `
SELECT channel,
       count(*) FILTER (WHERE status = 'sent')::int AS delivered,
       count(*) FILTER (WHERE status = 'failed')::int AS failed
FROM bot_messages
WHERE direction = 'out'
  AND kind = 'weekly_recap'
  AND created_at >= now() - ${DAY_INTERVAL}
GROUP BY channel`

const STREAK_SQL = `
WITH logs AS (
    SELECT user_id,
           action_at,
           CASE
               WHEN action = 'watered' AND COALESCE(hours_late, 0) <= 24 THEN true
               ELSE false
           END AS on_time,
           ROW_NUMBER() OVER (
               PARTITION BY user_id
               ORDER BY action_at DESC, id DESC
           ) AS rn
    FROM watering_logs
    WHERE action IN ('watered', 'skipped')
      AND action_at >= now() - INTERVAL '365 days'
),
per_user AS (
    SELECT user_id,
           MIN(rn) FILTER (WHERE NOT on_time) AS break_rn
    FROM logs
    GROUP BY user_id
),
current AS (
    SELECT l.user_id,
           count(*) FILTER (
               WHERE l.on_time AND (p.break_rn IS NULL OR l.rn < p.break_rn)
           )::int AS current_streak
    FROM logs l
    JOIN per_user p ON p.user_id = l.user_id
    GROUP BY l.user_id
)
SELECT count(*) FILTER (WHERE current_streak > 0)::int AS users_with_streak,
       COALESCE(round(avg(current_streak) FILTER (WHERE current_streak > 0), 1), 0)::float
           AS avg_current_streak,
       COALESCE(max(current_streak), 0)::int AS best_current_streak
FROM current`

async function selectRows(sql, bind = [], fallback = []) {
    try {
        const rows = await sequelize.query(sql, { bind, type: QueryTypes.SELECT })
        return Array.isArray(rows) ? rows : []
    } catch (error) {
        if (process.env.BOT_DEBUG === 'true') {
            console.warn('⚠️ Боты: запрос админ-аналитики не выполнен:', error?.message || error)
        }
        return fallback
    }
}

export function toInteger(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

export function safeRatio(part, total) {
    const denominator = toInteger(total)
    if (!denominator) return 0
    return Number((toInteger(part) / denominator).toFixed(2))
}

function isoOrNull(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function dayKey(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const text = String(value ?? '')
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''
}

function indexByChannel(rows) {
    const map = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
        const channel = botConfig.normalizeChannel(row?.channel)
        if (channel) map.set(channel, row)
    }
    return map
}

function emptyRecap() {
    return {
        notificationsCreated: 0,
        delivered: 0,
        failed: 0,
        users: 0,
        telegram: 0,
        max: 0
    }
}

function emptyStreak() {
    return {
        usersWithStreak: 0,
        avgCurrentStreak: 0,
        bestCurrentStreak: 0
    }
}

function emptyTotals() {
    return {
        linkedActive: 0,
        linkedNew: 0,
        messagesSent: 0,
        messagesFailed: 0,
        deliveryRate: 0,
        reminderShare: 0
    }
}

function emptyLinkFunnel() {
    return { codesCreated: 0, codesUsed: 0, conversion: 0 }
}

export function channelStatsBase(channel) {
    const config = botConfig.getChannelConfig(channel)
    return {
        configured: Boolean(config?.configured),
        botUsername: config?.username || null,
        linkedActive: 0,
        linkedTotal: 0,
        linkedInRange: 0,
        unlinkedInRange: 0,
        notificationsDisabled: 0,
        codesCreated: 0,
        codesUsed: 0,
        codeConversion: 0,
        messagesSent: 0,
        messagesFailed: 0,
        messagesSkipped: 0,
        deliveryRate: 0,
        remindersSent: 0,
        lastSentAt: null,
        lastError: null
    }
}

function statsForChannel(channel, { linksBy, codesBy, messagesBy, errorsBy }) {
    const stats = channelStatsBase(channel)
    const link = linksBy.get(channel) || {}
    const code = codesBy.get(channel) || {}
    const message = messagesBy.get(channel) || {}
    const lastError = errorsBy.get(channel)

    stats.linkedActive = toInteger(link.linked_active)
    stats.linkedTotal = toInteger(link.linked_total)
    stats.linkedInRange = toInteger(link.linked_in_range)
    stats.unlinkedInRange = toInteger(link.unlinked_in_range)
    stats.notificationsDisabled = toInteger(link.notifications_disabled)
    stats.codesCreated = toInteger(code.codes_created)
    stats.codesUsed = toInteger(code.codes_used)
    stats.messagesSent = toInteger(message.messages_sent)
    stats.messagesFailed = toInteger(message.messages_failed)
    stats.messagesSkipped = toInteger(message.messages_skipped)
    stats.remindersSent = toInteger(message.reminders_sent)
    stats.lastSentAt = isoOrNull(message.last_sent_at)
    stats.lastError = lastError?.error ? String(lastError.error).slice(0, 300) : null
    stats.codeConversion = safeRatio(stats.codesUsed, stats.codesCreated)
    stats.deliveryRate = safeRatio(stats.messagesSent, stats.messagesSent + stats.messagesFailed)
    return stats
}

function buildTotals(channels) {
    const sent = channels.telegram.messagesSent + channels.max.messagesSent
    const failed = channels.telegram.messagesFailed + channels.max.messagesFailed
    const reminders = channels.telegram.remindersSent + channels.max.remindersSent
    return {
        linkedActive: channels.telegram.linkedActive + channels.max.linkedActive,
        linkedNew: channels.telegram.linkedInRange + channels.max.linkedInRange,
        messagesSent: sent,
        messagesFailed: failed,
        deliveryRate: safeRatio(sent, sent + failed),
        reminderShare: safeRatio(reminders, sent)
    }
}

function buildSeries(rows) {
    const series = []
    for (const row of Array.isArray(rows) ? rows : []) {
        const day = dayKey(row?.day)
        if (!day) continue
        series.push({
            day,
            telegramSent: toInteger(row.telegram_sent),
            telegramFailed: toInteger(row.telegram_failed),
            maxSent: toInteger(row.max_sent),
            maxFailed: toInteger(row.max_failed)
        })
    }
    return series
}

function buildRecentErrors(rows) {
    const errors = []
    for (const row of Array.isArray(rows) ? rows : []) {
        const channel = botConfig.normalizeChannel(row?.channel)
        if (!channel) continue
        errors.push({
            channel,
            kind: row.kind ? String(row.kind).slice(0, 32) : null,
            error: row.error ? String(row.error).slice(0, 300) : '',
            createdAt: isoOrNull(row.created_at)
        })
    }
    return errors
}

function buildCommands(rows) {
    const commands = []
    for (const row of Array.isArray(rows) ? rows : []) {
        const channel = botConfig.normalizeChannel(row?.channel)
        if (!channel || !row.command) continue
        commands.push({
            channel,
            command: String(row.command).slice(0, 64),
            count: toInteger(row.count)
        })
    }
    return commands
}

function buildRecap(recapRow, deliveryRows) {
    const base = recapRow && typeof recapRow === 'object' ? recapRow : {}
    const deliveryBy = indexByChannel(deliveryRows)
    const telegram = toInteger(deliveryBy.get('telegram')?.delivered)
    const max = toInteger(deliveryBy.get('max')?.delivered)
    return {
        notificationsCreated: toInteger(base.notifications_created),
        delivered: telegram + max,
        failed: toInteger(deliveryBy.get('telegram')?.failed) +
            toInteger(deliveryBy.get('max')?.failed),
        users: toInteger(base.users),
        telegram,
        max
    }
}

function buildStreak(rows) {
    const row = Array.isArray(rows) ? rows[0] : null
    const avg = Number(row?.avg_current_streak)
    return {
        usersWithStreak: toInteger(row?.users_with_streak),
        avgCurrentStreak: Number.isFinite(avg) ? Number(avg.toFixed(1)) : 0,
        bestCurrentStreak: toInteger(row?.best_current_streak)
    }
}

export async function buildAnalyticsPayload({
    days,
    tablesReady = true,
    weeklyRecapReady = false
} = {}) {
    const generatedAt = new Date().toISOString()

    if (!tablesReady) {
        return {
            generatedAt,
            days,
            timezone: TIMEZONE,
            tablesReady: false,
            channels: {
                telegram: channelStatsBase('telegram'),
                max: channelStatsBase('max')
            },
            totals: emptyTotals(),
            series: [],
            linkFunnel: emptyLinkFunnel(),
            recentErrors: [],
            commands: [],
            recap: emptyRecap(),
            streak: emptyStreak()
        }
    }

    const [
        linksRows,
        codesRows,
        messagesRows,
        errorsRows,
        seriesRows,
        commandsRows
    ] = await Promise.all([
        selectRows(LINKS_SQL, [days]),
        selectRows(CODES_SQL, [days]),
        selectRows(MESSAGES_SQL, [days]),
        selectRows(ERRORS_SQL, [days]),
        selectRows(SERIES_SQL, [days]),
        selectRows(COMMANDS_SQL, [days])
    ])

    const [recapRows, recapDeliveryRows] = weeklyRecapReady
        ? await Promise.all([
            selectRows(RECAP_SQL, [days]),
            selectRows(RECAP_DELIVERY_SQL, [days])
        ])
        : [[], []]

    const streakRows = await selectRows(STREAK_SQL, [])

    const linksBy = indexByChannel(linksRows)
    const codesBy = indexByChannel(codesRows)
    const messagesBy = indexByChannel(messagesRows)
    const errorsBy = new Map()
    for (const row of Array.isArray(errorsRows) ? errorsRows : []) {
        const channel = botConfig.normalizeChannel(row?.channel)
        if (channel && !errorsBy.has(channel)) errorsBy.set(channel, row)
    }

    const channels = {
        telegram: statsForChannel('telegram', { linksBy, codesBy, messagesBy, errorsBy }),
        max: statsForChannel('max', { linksBy, codesBy, messagesBy, errorsBy })
    }

    const codesCreated = channels.telegram.codesCreated + channels.max.codesCreated
    const codesUsed = channels.telegram.codesUsed + channels.max.codesUsed

    return {
        generatedAt,
        days,
        timezone: TIMEZONE,
        tablesReady: true,
        channels,
        totals: buildTotals(channels),
        series: buildSeries(seriesRows),
        linkFunnel: {
            codesCreated,
            codesUsed,
            conversion: safeRatio(codesUsed, codesCreated)
        },
        recentErrors: buildRecentErrors(errorsRows),
        commands: buildCommands(commandsRows),
        recap: buildRecap(Array.isArray(recapRows) ? recapRows[0] : null, recapDeliveryRows),
        streak: buildStreak(streakRows)
    }
}

export class AdminBotsController {
    async getAnalytics(req, res) {
        const days = parseRangeDays(req.query?.days)
        if (days === null) {
            return res.status(400).json({
                message: 'Параметр days должен быть целым числом от 1 до 365'
            })
        }

        try {
            const tablesReady = await adminSchema.hasBotChannelTables()
            const weeklyRecapReady = tablesReady ? await adminSchema.hasWeeklyRecap() : false
            const payload = await buildAnalyticsPayload({
                days,
                tablesReady,
                weeklyRecapReady
            })
            return res.json(payload)
        } catch (error) {
            console.error('❌ Боты: ошибка админ-аналитики:', error)
            return res.status(500).json({ message: 'Не удалось получить аналитику по ботам' })
        }
    }
}

const adminBotsController = new AdminBotsController()

export default adminBotsController
