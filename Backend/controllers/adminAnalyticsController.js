import { QueryTypes } from 'sequelize'
import sequelize from '../db.js'
import {
    hasNotificationClicks,
    hasProductEvents,
    hasSiteVisitDays,
    hasSiteVisitUtm,
    hasUsersCreatedAt
} from '../utils/adminSchema.js'
import {
    TIMEZONE,
    isValidDay,
    normalizeSeries,
    parseRangeDays,
    userCreatedAtSql
} from '../utils/adminAnalytics.js'
import {
    RETENTION_MAX_DAYS,
    RETENTION_WINDOWS,
    buildActivity,
    buildPushMetrics,
    computeFunnel,
    computeRetention
} from '../utils/productMetrics.js'
import { readAiMetricsRange } from '../utils/aiMetrics.js'
import { buildProductMetricsBoard } from '../services/productMetricsService.js'

const MSK = `'${TIMEZONE}'`

const RETENTION_COHORT_COUNT = 8

const dayOf = expression => `((${expression}) AT TIME ZONE ${MSK})::date`

const BOUNDS_CTE = `WITH b AS (
    SELECT (now() AT TIME ZONE ${MSK})::date AS today,
           (now() AT TIME ZONE ${MSK})::date - ($1::int - 1) AS start_day
)`

const IN_RANGE = expression =>
    `${dayOf(expression)} BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)`

const VISITS_SOURCE = tracked => tracked
    ? 'site_visit_days'
    : `(SELECT NULL::date AS day, 0::int AS views, NULL::timestamptz AS created_at,
               NULL::integer AS user_id, NULL::text AS device, NULL::text AS first_path,
               NULL::text AS referrer_host
        WHERE false) site_visit_days`

const PRODUCT_EVENTS_SOURCE = tracked => tracked
    ? 'product_events'
    : `(SELECT NULL::integer AS user_id, NULL::text AS event,
               NULL::timestamptz AS created_at
        WHERE false) product_events`

const RETENTION_FLAGS_SQL = RETENTION_WINDOWS
    .map(window => `bool_or(ev.ev_day BETWEEN s.reg_day + 1 AND s.reg_day + ${window.days}) AS ${window.key}`)
    .join(',\n               ')

const RETENTION_COUNTS_SQL = RETENTION_WINDOWS
    .map(window => `count(*) FILTER (WHERE f.${window.key})::int AS ${window.key}`)
    .join(',\n           ')

function select(sql, params = []) {
    return sequelize.query(sql, { bind: params, type: QueryTypes.SELECT })
}

function toInteger(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function rowsOf(result) {
    return Array.isArray(result) ? result : []
}

function firstRow(result) {
    const rows = rowsOf(result)
    return rows[0] || {}
}

function camelizeCounters(row, mapping) {
    const output = {}
    for (const [key, source] of Object.entries(mapping)) {
        output[key] = toInteger(row[source])
    }
    return output
}

function fail(res, error, label) {
    console.error(`❌ Ошибка админ-аналитики (${label}):`, error)
    return res.status(500).json({ message: 'Не удалось получить аналитику' })
}

function ratio(part, total) {
    const denominator = toInteger(total)
    if (!denominator) return 0
    return Number((toInteger(part) / denominator).toFixed(2))
}

function buildAverages(row) {
    return {
        plantsPerUser: ratio(row.plants, row.users),
        wateringsPerUser: ratio(row.waterings, row.users),
        messagesPerUser: ratio(row.messages, row.users),
        photosPerPlant: ratio(row.photos, row.plants)
    }
}

const TIMESERIES_KEYS = {
    registrations: 'registrations',
    plantsAdded: 'plants_added',
    waterings: 'waterings',
    wateringsSkipped: 'waterings_skipped',
    chatMessages: 'chat_messages',
    photos: 'photos',
    guests: 'guests',
    activeUsers: 'active_users',
    visitors: 'visitors',
    views: 'views'
}

class AdminAnalyticsController {
    async getOverview(req, res) {
        const days = parseRangeDays(req.query.days)
        if (days === null) {
            return res.status(400).json({ message: 'Параметр days должен быть целым числом от 1 до 365' })
        }

        try {
            const [hasCreatedAt, visitsTracked] = await Promise.all([
                hasUsersCreatedAt(),
                hasSiteVisitDays()
            ])
            const createdExpr = userCreatedAtSql(hasCreatedAt)

            const [userRow, plantRow, contentRow, trafficRow] = await Promise.all([
                select(`
                    ${BOUNDS_CTE}
                    SELECT
                        count(*)::int AS total,
                        count(*) FILTER (WHERE ${dayOf(createdExpr)} = b.today)::int AS new_today,
                        count(*) FILTER (WHERE ${dayOf(createdExpr)} >= b.today - 6)::int AS new_7d,
                        count(*) FILTER (WHERE ${dayOf(createdExpr)} >= b.today - 29)::int AS new_30d,
                        count(*) FILTER (WHERE ${dayOf(createdExpr)} BETWEEN b.start_day AND b.today)::int AS new_in_range,
                        count(*) FILTER (WHERE u.role = 'ADMIN')::int AS admins,
                        count(*) FILTER (WHERE u.privilege_level <> 'free')::int AS paying,
                        (SELECT count(DISTINCT pk.user_id)::int FROM passkeys pk) AS with_passkey,
                        (SELECT count(DISTINCT ps.user_id)::int FROM push_subscriptions ps
                            WHERE ps.user_id IS NOT NULL) AS with_push
                    FROM users u CROSS JOIN b
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT
                        count(*)::int AS total,
                        count(*) FILTER (WHERE p.is_active)::int AS active,
                        count(*) FILTER (WHERE NOT p.is_active)::int AS archived,
                        count(*) FILTER (WHERE ${dayOf('p.created_at')} = b.today)::int AS new_today,
                        count(*) FILTER (WHERE ${dayOf('p.created_at')} >= b.today - 6)::int AS new_7d,
                        count(*) FILTER (WHERE ${dayOf('p.created_at')} BETWEEN b.start_day AND b.today)::int AS new_in_range
                    FROM plants p CROSS JOIN b
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT
                        (SELECT count(*)::int FROM watering_logs) AS w_total,
                        (SELECT count(*)::int FROM watering_logs WHERE action = 'watered') AS w_watered,
                        (SELECT count(*)::int FROM watering_logs WHERE action = 'skipped') AS w_skipped,
                        (SELECT count(*)::int FROM watering_logs WHERE ${IN_RANGE('action_at')}) AS w_in_range,
                        (SELECT count(*)::int FROM watering_logs WHERE ${dayOf('action_at')} = (SELECT today FROM b)) AS w_today,
                        (SELECT count(DISTINCT user_id)::int FROM watering_logs WHERE ${IN_RANGE('action_at')}) AS w_active_users,
                        (SELECT count(DISTINCT plant_id)::int FROM watering_logs WHERE ${IN_RANGE('action_at')}) AS w_active_plants,
                        (SELECT count(*)::int FROM plant_photos) AS ph_total,
                        (SELECT count(DISTINCT plant_id)::int FROM plant_photos) AS ph_plants,
                        (SELECT count(*)::int FROM plant_photos WHERE ${IN_RANGE('created_at')}) AS ph_in_range,
                        (SELECT count(*)::int FROM chat_logs) AS c_total,
                        (SELECT count(*)::int FROM chat_logs WHERE role = 'user') AS c_user,
                        (SELECT count(DISTINCT session_id)::int FROM chat_logs) AS c_sessions,
                        (SELECT count(DISTINCT user_id)::int FROM chat_logs WHERE user_id IS NOT NULL) AS c_users,
                        (SELECT count(*)::int FROM chat_logs WHERE ${IN_RANGE('created_at')}) AS c_in_range,
                        (SELECT count(*)::int FROM chat_logs WHERE ${dayOf('created_at')} = (SELECT today FROM b)) AS c_today
                    FROM b
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT
                        (SELECT count(*)::int FROM ${VISITS_SOURCE(visitsTracked)} WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)) AS v_unique_range,
                        (SELECT COALESCE(sum(views), 0)::int FROM ${VISITS_SOURCE(visitsTracked)} WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)) AS v_views_range,
                        (SELECT count(*)::int FROM ${VISITS_SOURCE(visitsTracked)} WHERE day = (SELECT today FROM b)) AS v_unique_today,
                        (SELECT COALESCE(sum(views), 0)::int FROM ${VISITS_SOURCE(visitsTracked)} WHERE day = (SELECT today FROM b)) AS v_views_today,
                        (SELECT count(*)::int FROM ${VISITS_SOURCE(visitsTracked)}) AS v_unique_total,
                        (SELECT COALESCE(sum(views), 0)::int FROM ${VISITS_SOURCE(visitsTracked)}) AS v_views_total,
                        (SELECT count(*)::int FROM site_visit_days
                            WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)
                              AND ${dayOf('created_at')} = day) AS v_new_range,
                        (SELECT count(DISTINCT user_id)::int FROM site_visit_days
                            WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)
                              AND user_id IS NOT NULL) AS v_registered_range,
                        (SELECT count(DISTINCT guest_token)::int FROM user_cookie_consents
                            WHERE guest_token IS NOT NULL) AS g_unique_total,
                        (SELECT count(DISTINCT guest_token)::int FROM user_cookie_consents
                            WHERE guest_token IS NOT NULL AND ${IN_RANGE('created_at')}) AS g_unique_range,
                        (SELECT count(DISTINCT guest_token)::int FROM user_cookie_consents
                            WHERE guest_token IS NOT NULL
                              AND ${dayOf('created_at')} = (SELECT today FROM b)) AS g_today,
                        (SELECT count(*)::int FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()) AS s_active,
                        (SELECT count(*)::int FROM auth_sessions WHERE ${IN_RANGE('created_at')}) AS s_in_range,
                        (SELECT count(*)::int FROM auth_sessions WHERE revoked_at IS NOT NULL AND ${IN_RANGE('revoked_at')}) AS s_revoked,
                        (SELECT count(*)::int FROM push_subscriptions) AS push_total,
                        (SELECT count(*)::int FROM push_subscriptions WHERE user_id IS NULL) AS push_guests,
                        (SELECT count(*)::int FROM notifications) AS n_total,
                        (SELECT count(*)::int FROM notifications WHERE ${IN_RANGE('created_at')}) AS n_in_range,
                        (SELECT count(*)::int FROM notifications WHERE read_at IS NOT NULL) AS n_read,
                        (SELECT count(*)::int FROM push_broadcasts) AS b_total,
                        (SELECT count(*)::int FROM push_broadcasts WHERE ${IN_RANGE('created_at')}) AS b_in_range,
                        (SELECT count(*)::int FROM user_legal_consents) AS lc_total,
                        (SELECT count(*)::int FROM user_legal_consents WHERE is_accepted) AS lc_accepted,
                        (SELECT COALESCE(json_agg(row_to_json(ct)), '[]'::json) FROM (
                            SELECT consent_type,
                                   count(*)::int AS total,
                                   count(*) FILTER (WHERE is_accepted AND NOT is_revoked)::int AS accepted
                            FROM user_cookie_consents
                            GROUP BY consent_type
                            ORDER BY consent_type
                        ) ct) AS consent_types
                    FROM b
                `, [days])
            ])

            const users = camelizeCounters(firstRow(userRow), {
                total: 'total',
                newToday: 'new_today',
                new7d: 'new_7d',
                new30d: 'new_30d',
                newInRange: 'new_in_range',
                admins: 'admins',
                paying: 'paying',
                withPasskey: 'with_passkey',
                withPush: 'with_push'
            })

            const plants = camelizeCounters(firstRow(plantRow), {
                total: 'total',
                active: 'active',
                archived: 'archived',
                newToday: 'new_today',
                new7d: 'new_7d',
                newInRange: 'new_in_range'
            })
            plants.avgPerUser = users.total > 0
                ? Number((plants.total / users.total).toFixed(2))
                : 0

            const content = firstRow(contentRow)
            const traffic = firstRow(trafficRow)

            return res.json({
                generatedAt: new Date().toISOString(),
                timezone: TIMEZONE,
                days,
                userCreatedAtTracked: hasCreatedAt,
                visitsTracked,
                users,
                plants,
                waterings: camelizeCounters(content, {
                    total: 'w_total',
                    watered: 'w_watered',
                    skipped: 'w_skipped',
                    today: 'w_today',
                    inRange: 'w_in_range',
                    activeUsers: 'w_active_users',
                    activePlants: 'w_active_plants'
                }),
                photos: camelizeCounters(content, {
                    total: 'ph_total',
                    plantsWithPhoto: 'ph_plants',
                    inRange: 'ph_in_range'
                }),
                chat: camelizeCounters(content, {
                    messages: 'c_total',
                    userMessages: 'c_user',
                    sessions: 'c_sessions',
                    users: 'c_users',
                    today: 'c_today',
                    inRange: 'c_in_range'
                }),
                visits: camelizeCounters(traffic, {
                    uniqueToday: 'v_unique_today',
                    viewsToday: 'v_views_today',
                    uniqueInRange: 'v_unique_range',
                    viewsInRange: 'v_views_range',
                    newInRange: 'v_new_range',
                    registeredInRange: 'v_registered_range',
                    uniqueTotal: 'v_unique_total',
                    viewsTotal: 'v_views_total'
                }),
                guests: camelizeCounters(traffic, {
                    uniqueToday: 'g_today',
                    uniqueInRange: 'g_unique_range',
                    uniqueTotal: 'g_unique_total'
                }),
                sessions: camelizeCounters(traffic, {
                    active: 's_active',
                    createdInRange: 's_in_range',
                    revokedInRange: 's_revoked'
                }),
                push: {
                    ...camelizeCounters(traffic, {
                        subscriptions: 'push_total',
                        guestSubscriptions: 'push_guests',
                        notifications: 'n_total',
                        notificationsInRange: 'n_in_range',
                        notificationsRead: 'n_read',
                        broadcasts: 'b_total',
                        broadcastsInRange: 'b_in_range'
                    }),
                    usersWithPush: users.withPush
                },
                legalConsents: camelizeCounters(traffic, {
                    total: 'lc_total',
                    accepted: 'lc_accepted'
                }),
                consents: rowsOf(traffic.consent_types).map(item => ({
                    type: item.consent_type,
                    total: toInteger(item.total),
                    accepted: toInteger(item.accepted)
                }))
            })
        } catch (error) {
            return fail(res, error, 'overview')
        }
    }

    async getTimeseries(req, res) {
        const days = parseRangeDays(req.query.days)
        if (days === null) {
            return res.status(400).json({ message: 'Параметр days должен быть целым числом от 1 до 365' })
        }

        try {
            const [hasCreatedAt, visitsTracked] = await Promise.all([
                hasUsersCreatedAt(),
                hasSiteVisitDays()
            ])
            const createdExpr = userCreatedAtSql(hasCreatedAt)

            const visitCte = visitsTracked
                ? `SELECT day,
                          count(*)::int AS visitors,
                          COALESCE(sum(views), 0)::int AS views
                   FROM site_visit_days
                   WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)
                   GROUP BY day`
                : `SELECT NULL::date AS day, 0::int AS visitors, 0::int AS views WHERE false`

            const rows = await select(`
                ${BOUNDS_CTE},
                d AS (
                    SELECT generate_series(b.start_day, b.today, interval '1 day')::date AS day FROM b
                ),
                reg AS (
                    SELECT ${dayOf(createdExpr)} AS day, count(*)::int AS c
                    FROM users u
                    WHERE ${dayOf(createdExpr)} IS NOT NULL AND ${IN_RANGE(createdExpr)}
                    GROUP BY 1
                ),
                pl AS (
                    SELECT ${dayOf('p.created_at')} AS day, count(*)::int AS c
                    FROM plants p WHERE ${IN_RANGE('p.created_at')} GROUP BY 1
                ),
                wl AS (
                    SELECT ${dayOf('w.action_at')} AS day,
                           count(*)::int AS c,
                           count(*) FILTER (WHERE w.action = 'skipped')::int AS skipped
                    FROM watering_logs w WHERE ${IN_RANGE('w.action_at')} GROUP BY 1
                ),
                ch AS (
                    SELECT ${dayOf('c.created_at')} AS day, count(*)::int AS c
                    FROM chat_logs c WHERE ${IN_RANGE('c.created_at')} GROUP BY 1
                ),
                ph AS (
                    SELECT ${dayOf('p.created_at')} AS day, count(*)::int AS c
                    FROM plant_photos p WHERE ${IN_RANGE('p.created_at')} GROUP BY 1
                ),
                g AS (
                    SELECT ${dayOf('created_at')} AS day, count(DISTINCT guest_token)::int AS c
                    FROM user_cookie_consents
                    WHERE guest_token IS NOT NULL AND ${IN_RANGE('created_at')}
                    GROUP BY 1
                ),
                act AS (
                    SELECT day, count(DISTINCT user_id)::int AS c FROM (
                        SELECT ${dayOf('w.action_at')} AS day, w.user_id
                        FROM watering_logs w WHERE ${IN_RANGE('w.action_at')}
                        UNION ALL
                        SELECT ${dayOf('c.created_at')} AS day, c.user_id
                        FROM chat_logs c WHERE c.user_id IS NOT NULL AND ${IN_RANGE('c.created_at')}
                        UNION ALL
                        SELECT ${dayOf('p.created_at')} AS day, p.user_id
                        FROM plants p WHERE ${IN_RANGE('p.created_at')}
                    ) t GROUP BY day
                ),
                vi AS (${visitCte})
                SELECT d.day,
                       COALESCE(reg.c, 0)::int AS registrations,
                       COALESCE(pl.c, 0)::int AS plants_added,
                       COALESCE(wl.c, 0)::int AS waterings,
                       COALESCE(wl.skipped, 0)::int AS waterings_skipped,
                       COALESCE(ch.c, 0)::int AS chat_messages,
                       COALESCE(ph.c, 0)::int AS photos,
                       COALESCE(g.c, 0)::int AS guests,
                       COALESCE(act.c, 0)::int AS active_users,
                       COALESCE(vi.visitors, 0)::int AS visitors,
                       COALESCE(vi.views, 0)::int AS views
                FROM d
                LEFT JOIN reg ON reg.day = d.day
                LEFT JOIN pl ON pl.day = d.day
                LEFT JOIN wl ON wl.day = d.day
                LEFT JOIN ch ON ch.day = d.day
                LEFT JOIN ph ON ph.day = d.day
                LEFT JOIN g ON g.day = d.day
                LEFT JOIN act ON act.day = d.day
                LEFT JOIN vi ON vi.day = d.day
                ORDER BY d.day
            `, [days])

            const dayList = rowsOf(rows).map(row => String(row.day).slice(0, 10))
            const points = normalizeSeries(rows, dayList, TIMESERIES_KEYS)

            return res.json({
                days,
                timezone: TIMEZONE,
                visitsTracked,
                userCreatedAtTracked: hasCreatedAt,
                startDate: dayList[0] || null,
                endDate: dayList[dayList.length - 1] || null,
                points
            })
        } catch (error) {
            return fail(res, error, 'timeseries')
        }
    }

    async getBreakdown(req, res) {
        const days = parseRangeDays(req.query.days)
        if (days === null) {
            return res.status(400).json({ message: 'Параметр days должен быть целым числом от 1 до 365' })
        }

        try {
            const [hasCreatedAt, visitsTracked, utmTracked] = await Promise.all([
                hasUsersCreatedAt(),
                hasSiteVisitDays(),
                hasSiteVisitUtm()
            ])
            const createdExpr = userCreatedAtSql(hasCreatedAt)

            const [topSpecies, topByPlants, topByWaterings, topByChat, byWeekday, byHour, byInterval,
                consentTypes, registrationsByWeekday, recentUsers, totals, utmSources] = await Promise.all([
                select(`
                    SELECT COALESCE(NULLIF(TRIM(p.species), ''), 'Не указан') AS species,
                           count(*)::int AS count
                    FROM plants p
                    GROUP BY 1
                    ORDER BY count DESC, species ASC
                    LIMIT 12
                `),

                select(`
                    SELECT u.id, u.email, u.name, u.username, count(p.id)::int AS plants
                    FROM users u
                    JOIN plants p ON p.user_id = u.id
                    GROUP BY u.id
                    ORDER BY plants DESC, u.id ASC
                    LIMIT 10
                `),

                select(`
                    ${BOUNDS_CTE}
                    SELECT u.id, u.email, u.name, u.username, count(w.id)::int AS waterings
                    FROM users u
                    JOIN watering_logs w ON w.user_id = u.id
                    WHERE ${IN_RANGE('w.action_at')}
                    GROUP BY u.id
                    ORDER BY waterings DESC, u.id ASC
                    LIMIT 10
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT u.id, u.email, u.name, u.username, count(c.id)::int AS messages
                    FROM users u
                    JOIN chat_logs c ON c.user_id = u.id
                    WHERE ${IN_RANGE('c.created_at')}
                    GROUP BY u.id
                    ORDER BY messages DESC, u.id ASC
                    LIMIT 10
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT extract(isodow FROM ${dayOf('w.action_at')})::int AS weekday,
                           count(*)::int AS count
                    FROM watering_logs w
                    WHERE w.action = 'watered' AND ${IN_RANGE('w.action_at')}
                    GROUP BY 1
                    ORDER BY 1
                `, [days]),

                select(`
                    ${BOUNDS_CTE}
                    SELECT extract(hour FROM (w.action_at AT TIME ZONE ${MSK}))::int AS hour,
                           count(*)::int AS count
                    FROM watering_logs w
                    WHERE w.action = 'watered' AND ${IN_RANGE('w.action_at')}
                    GROUP BY 1
                    ORDER BY 1
                `, [days]),

                select(`
                    SELECT COALESCE(p.watering_interval_days, 0)::int AS interval_days,
                           count(*)::int AS count
                    FROM plants p
                    GROUP BY 1
                    ORDER BY 1
                `),

                select(`
                    SELECT consent_type,
                           count(*)::int AS total,
                           count(*) FILTER (WHERE is_accepted AND NOT is_revoked)::int AS accepted
                    FROM user_cookie_consents
                    GROUP BY 1
                    ORDER BY 1
                `),

                select(`
                    ${BOUNDS_CTE}
                    SELECT extract(isodow FROM ${dayOf(createdExpr)})::int AS weekday,
                           count(*)::int AS count
                    FROM users u
                    WHERE ${dayOf(createdExpr)} IS NOT NULL AND ${IN_RANGE(createdExpr)}
                    GROUP BY 1
                    ORDER BY 1
                `, [days]),

                select(`
                    SELECT u.id, u.email, u.name, u.username, u.role, u.privilege_level,
                           ${createdExpr} AS created_at
                    FROM users u
                    ORDER BY ${createdExpr} DESC NULLS LAST, u.id DESC
                    LIMIT 10
                `),

                select(`
                    SELECT
                        (SELECT count(*)::int FROM users) AS users,
                        (SELECT count(*)::int FROM plants) AS plants,
                        (SELECT count(*)::int FROM watering_logs) AS waterings,
                        (SELECT count(*)::int FROM chat_logs) AS messages,
                        (SELECT count(*)::int FROM plant_photos) AS photos
                `),

                utmTracked
                    ? select(`
                        ${BOUNDS_CTE}
                        SELECT NULLIF(TRIM(utm_source), '') AS source,
                               NULLIF(TRIM(utm_medium), '') AS medium,
                               NULLIF(TRIM(utm_campaign), '') AS campaign,
                               count(*)::int AS visitors
                        FROM site_visit_days
                        WHERE day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)
                          AND NULLIF(TRIM(utm_source), '') IS NOT NULL
                        GROUP BY 1, 2, 3
                        ORDER BY visitors DESC, source ASC
                        LIMIT 10
                    `, [days])
                    : []
            ])

            return res.json({
                days,
                timezone: TIMEZONE,
                visitsTracked,
                userCreatedAtTracked: hasCreatedAt,
                topSpecies: rowsOf(topSpecies).map(row => ({
                    species: row.species,
                    count: toInteger(row.count)
                })),
                topUsersByPlants: rowsOf(topByPlants).map(row => ({
                    id: toInteger(row.id),
                    email: row.email,
                    name: row.name,
                    username: row.username,
                    plants: toInteger(row.plants)
                })),
                topUsersByWaterings: rowsOf(topByWaterings).map(row => ({
                    id: toInteger(row.id),
                    email: row.email,
                    name: row.name,
                    username: row.username,
                    waterings: toInteger(row.waterings)
                })),
                topUsersByChat: rowsOf(topByChat).map(row => ({
                    id: toInteger(row.id),
                    email: row.email,
                    name: row.name,
                    username: row.username,
                    messages: toInteger(row.messages)
                })),
                wateringsByWeekday: rowsOf(byWeekday).map(row => ({
                    weekday: toInteger(row.weekday),
                    count: toInteger(row.count)
                })),
                wateringsByHour: rowsOf(byHour).map(row => ({
                    hour: toInteger(row.hour),
                    count: toInteger(row.count)
                })),
                plantsByInterval: rowsOf(byInterval).map(row => ({
                    intervalDays: toInteger(row.interval_days),
                    count: toInteger(row.count)
                })),
                consentTypes: rowsOf(consentTypes).map(row => ({
                    type: row.consent_type,
                    total: toInteger(row.total),
                    accepted: toInteger(row.accepted)
                })),
                registrationsByWeekday: rowsOf(registrationsByWeekday).map(row => ({
                    weekday: toInteger(row.weekday),
                    count: toInteger(row.count)
                })),
                recentUsers: rowsOf(recentUsers).map(row => ({
                    id: toInteger(row.id),
                    email: row.email,
                    name: row.name,
                    username: row.username,
                    role: row.role,
                    privilegeLevel: row.privilege_level,
                    createdAt: row.created_at
                })),
                utmTracked,
                utmSources: rowsOf(utmSources).map(row => ({
                    source: row.source,
                    medium: row.medium,
                    campaign: row.campaign,
                    visitors: toInteger(row.visitors)
                })),
                averages: buildAverages(firstRow(totals))
            })
        } catch (error) {
            return fail(res, error, 'breakdown')
        }
    }

    async getProductAnalytics(req, res) {
        const days = parseRangeDays(req.query.days)
        if (days === null) {
            return res.status(400).json({ message: 'Параметр days должен быть целым числом от 1 до 365' })
        }

        try {
            const [hasCreatedAt, eventsTracked, clicksTracked, visitsTracked] = await Promise.all([
                hasUsersCreatedAt(),
                hasProductEvents(),
                hasNotificationClicks(),
                hasSiteVisitDays()
            ])
            const createdExpr = userCreatedAtSql(hasCreatedAt)
            const eventsSource = PRODUCT_EVENTS_SOURCE(eventsTracked)
            const retentionTracked = eventsTracked || visitsTracked

            const pushClicksSql = clicksTracked
                ? `(SELECT COALESCE(sum(click_count), 0)::int
                        FROM notifications
                        WHERE ${IN_RANGE('created_at')}) AS clicks,
                   (SELECT count(*)::int
                        FROM notifications
                        WHERE clicked_at IS NOT NULL
                          AND ${dayOf('clicked_at')} = (SELECT today FROM b)) AS clicked_today`
                : '0::int AS clicks,\n                   0::int AS clicked_today'

            const activitySql = `
                ${BOUNDS_CTE}
                SELECT
                    count(DISTINCT user_id) FILTER (WHERE ${dayOf('created_at')} = (SELECT today FROM b))::int AS dau,
                    count(DISTINCT user_id) FILTER (WHERE ${dayOf('created_at')} >= (SELECT today FROM b) - 6)::int AS wau,
                    count(DISTINCT user_id) FILTER (WHERE ${dayOf('created_at')} >= (SELECT today FROM b) - 29)::int AS mau,
                    count(DISTINCT user_id) FILTER (WHERE ${IN_RANGE('created_at')})::int AS active_users,
                    count(*) FILTER (WHERE ${dayOf('created_at')} = (SELECT today FROM b))::int AS events_today,
                    count(*) FILTER (WHERE ${IN_RANGE('created_at')})::int AS events_in_range
                FROM ${eventsSource}
            `

            const newUsersSql = `
                ${BOUNDS_CTE}
                SELECT count(*)::int AS new_users
                FROM users u
                WHERE ${IN_RANGE(createdExpr)}
            `

            const funnelSql = `
                ${BOUNDS_CTE}
                SELECT
                    count(*) FILTER (WHERE u.role <> 'ADMIN' AND ${IN_RANGE(createdExpr)})::int AS registered,
                    (SELECT count(DISTINCT p.user_id)::int
                        FROM plants p
                        WHERE ${IN_RANGE('p.created_at')}) AS plant_created,
                    (SELECT count(DISTINCT w.user_id)::int
                        FROM watering_logs w
                        WHERE w.action = 'watered' AND ${IN_RANGE('w.action_at')}) AS watering_marked,
                    (SELECT count(DISTINCT ps.user_id)::int
                        FROM push_subscriptions ps
                        WHERE ps.user_id IS NOT NULL AND ${IN_RANGE('ps.created_at')}) AS push_subscribed
                FROM users u
            `

            const retentionEvSources = []
            if (eventsTracked) {
                retentionEvSources.push(`SELECT DISTINCT s.user_id, s.reg_day,
                           ${dayOf('pe.created_at')} AS ev_day
                    FROM selected s
                    JOIN product_events pe ON pe.user_id = s.user_id
                    WHERE ${dayOf('pe.created_at')} BETWEEN s.reg_day + 1 AND s.reg_day + ${RETENTION_MAX_DAYS}`)
            }
            if (visitsTracked) {
                retentionEvSources.push(`SELECT DISTINCT s.user_id, s.reg_day,
                           sv.day AS ev_day
                    FROM selected s
                    JOIN site_visit_days sv ON sv.user_id = s.user_id
                    WHERE sv.day BETWEEN s.reg_day + 1 AND s.reg_day + ${RETENTION_MAX_DAYS}`)
            }
            const retentionEvSql = retentionEvSources.join('\n                    UNION\n                    ')

            const retentionSql = `
                ${BOUNDS_CTE},
                week_starts AS (
                    SELECT ((SELECT (today - (extract(isodow FROM today)::int - 1))::date FROM b)
                            - offsets.days_back)::date AS cohort
                    FROM (SELECT generate_series(0, ${(RETENTION_COHORT_COUNT - 1) * 7}, 7) AS days_back) offsets
                ),
                u0 AS (
                    SELECT u.id AS user_id,
                           ${dayOf(createdExpr)} AS reg_day
                    FROM users u
                    WHERE u.role <> 'ADMIN'
                ),
                registered AS (
                    SELECT user_id, reg_day,
                           (reg_day - (extract(isodow FROM reg_day)::int - 1))::date AS cohort
                    FROM u0
                    WHERE reg_day IS NOT NULL
                ),
                selected AS (
                    SELECT r.user_id, r.reg_day, r.cohort
                    FROM registered r
                    JOIN week_starts w ON w.cohort = r.cohort
                ),
                ev AS (
                    ${retentionEvSql}
                ),
                flags AS (
                    SELECT s.cohort, s.user_id,
                           ${RETENTION_FLAGS_SQL}
                    FROM selected s
                    LEFT JOIN ev ON ev.user_id = s.user_id
                    GROUP BY s.cohort, s.user_id
                )
                SELECT f.cohort,
                       count(*)::int AS size,
                       ${RETENTION_COUNTS_SQL}
                FROM flags f
                GROUP BY f.cohort
                ORDER BY f.cohort DESC
            `

            const eventsSql = `
                ${BOUNDS_CTE}
                SELECT event, count(*)::int AS count, count(DISTINCT user_id)::int AS users
                FROM product_events
                WHERE ${IN_RANGE('created_at')}
                GROUP BY event
                ORDER BY count DESC, event ASC
                LIMIT 10
            `

            const pushSql = `
                ${BOUNDS_CTE}
                SELECT
                    (SELECT count(*)::int FROM notifications WHERE ${IN_RANGE('created_at')}) AS notifications,
                    ${pushClicksSql}
            `

            const [activityRows, newUsersRows, funnelRows, retentionRows, eventRows, pushRows] =
                await Promise.all([
                    select(activitySql, [days]),
                    select(newUsersSql, [days]),
                    select(funnelSql, [days]),
                    retentionTracked ? select(retentionSql, [days]) : [],
                    eventsTracked ? select(eventsSql, [days]) : [],
                    select(pushSql, [days])
                ])

            const activity = camelizeCounters(firstRow(activityRows), {
                dau: 'dau',
                wau: 'wau',
                mau: 'mau',
                activeUsers: 'active_users',
                eventsToday: 'events_today',
                eventsInRange: 'events_in_range'
            })
            activity.newUsers = toInteger(firstRow(newUsersRows).new_users)

            const funnelRow = firstRow(funnelRows)
            const pushRow = firstRow(pushRows)

            let aiCost = null
            let aiRequests = null
            try {
                const aiMetrics = await readAiMetricsRange({ days })
                const cost = Number(aiMetrics?.summary?.cost?.total)
                aiCost = Number.isFinite(cost) ? cost : null
                const requests = Number(aiMetrics?.summary?.totals?.requests)
                aiRequests = Number.isFinite(requests) ? requests : null
            } catch (error) {
                console.warn('⚠️ Стоимость ИИ для метрик продукта недоступна:', error?.message || error)
            }

            const metrics = await buildProductMetricsBoard({ days, aiCost, aiRequests })

            return res.json({
                generatedAt: new Date().toISOString(),
                timezone: TIMEZONE,
                days,
                eventsTracked,
                usersCreatedAtTracked: hasCreatedAt,
                activity: eventsTracked ? buildActivity(activity) : buildActivity({}),
                funnel: computeFunnel({
                    registered: funnelRow.registered,
                    plantCreated: funnelRow.plant_created,
                    wateringMarked: funnelRow.watering_marked,
                    pushSubscribed: funnelRow.push_subscribed
                }),
                retention: retentionTracked ? computeRetention(rowsOf(retentionRows)) : [],
                events: rowsOf(eventRows).map(row => ({
                    event: row.event,
                    count: toInteger(row.count),
                    users: toInteger(row.users)
                })),
                push: buildPushMetrics({
                    notifications: pushRow.notifications,
                    clicks: pushRow.clicks,
                    clickedToday: pushRow.clicked_today
                }),
                metrics
            })
        } catch (error) {
            return fail(res, error, 'product')
        }
    }

    async getVisits(req, res) {
        const from = req.query.from === undefined || req.query.from === '' ? undefined : req.query.from
        const to = req.query.to === undefined || req.query.to === '' ? undefined : req.query.to
        if ((from !== undefined && !isValidDay(from)) || (to !== undefined && !isValidDay(to))) {
            return res.status(400).json({ message: 'Даты должны быть в формате YYYY-MM-DD' })
        }
        if (from && to && from > to) {
            return res.status(400).json({ message: 'Дата начала позже даты окончания' })
        }

        try {
            const visitsTracked = await hasSiteVisitDays()
            if (!visitsTracked) {
                return res.json({
                    tracked: false,
                    from: from || null,
                    to: to || null,
                    totals: {
                        uniqueVisitors: 0,
                        views: 0,
                        newVisitors: 0,
                        registeredVisitors: 0
                    },
                    days: [],
                    devices: [],
                    pages: [],
                    referrers: []
                })
            }

            const [totalRow, dayRows, deviceRows, pageRows, referrerRows] = await Promise.all([
                select(`
                    WITH bounds AS (
                        SELECT COALESCE($1::date, (now() AT TIME ZONE ${MSK})::date - 29) AS from_day,
                               COALESCE($2::date, (now() AT TIME ZONE ${MSK})::date) AS to_day
                    )
                    SELECT count(*)::int AS unique_visitors,
                           COALESCE(sum(views), 0)::int AS views,
                           count(*) FILTER (WHERE ${dayOf('created_at')} = day)::int AS new_visitors,
                           count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS registered_visitors
                    FROM site_visit_days, bounds
                    WHERE day BETWEEN bounds.from_day AND bounds.to_day
                `, [from || null, to || null]),

                select(`
                    WITH bounds AS (
                        SELECT COALESCE($1::date, (now() AT TIME ZONE ${MSK})::date - 29) AS from_day,
                               COALESCE($2::date, (now() AT TIME ZONE ${MSK})::date) AS to_day
                    )
                    SELECT day,
                           count(*)::int AS unique_visitors,
                           COALESCE(sum(views), 0)::int AS views,
                           count(*) FILTER (WHERE ${dayOf('created_at')} = day)::int AS new_visitors,
                           count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS registered_visitors
                    FROM site_visit_days, bounds
                    WHERE day BETWEEN bounds.from_day AND bounds.to_day
                    GROUP BY day
                    ORDER BY day
                `, [from || null, to || null]),

                select(`
                    WITH bounds AS (
                        SELECT COALESCE($1::date, (now() AT TIME ZONE ${MSK})::date - 29) AS from_day,
                               COALESCE($2::date, (now() AT TIME ZONE ${MSK})::date) AS to_day
                    )
                    SELECT COALESCE(NULLIF(device, ''), 'unknown') AS device,
                           count(*)::int AS visitors,
                           COALESCE(sum(views), 0)::int AS views
                    FROM site_visit_days, bounds
                    WHERE day BETWEEN bounds.from_day AND bounds.to_day
                    GROUP BY 1
                    ORDER BY visitors DESC
                `, [from || null, to || null]),

                select(`
                    WITH bounds AS (
                        SELECT COALESCE($1::date, (now() AT TIME ZONE ${MSK})::date - 29) AS from_day,
                               COALESCE($2::date, (now() AT TIME ZONE ${MSK})::date) AS to_day
                    )
                    SELECT COALESCE(NULLIF(first_path, ''), '/') AS path,
                           count(*)::int AS visitors,
                           COALESCE(sum(views), 0)::int AS views
                    FROM site_visit_days, bounds
                    WHERE day BETWEEN bounds.from_day AND bounds.to_day
                    GROUP BY 1
                    ORDER BY views DESC, visitors DESC
                    LIMIT 15
                `, [from || null, to || null]),

                select(`
                    WITH bounds AS (
                        SELECT COALESCE($1::date, (now() AT TIME ZONE ${MSK})::date - 29) AS from_day,
                               COALESCE($2::date, (now() AT TIME ZONE ${MSK})::date) AS to_day
                    )
                    SELECT COALESCE(NULLIF(referrer_host, ''), 'прямой заход') AS host,
                           count(*)::int AS visitors,
                           COALESCE(sum(views), 0)::int AS views
                    FROM site_visit_days, bounds
                    WHERE day BETWEEN bounds.from_day AND bounds.to_day
                    GROUP BY 1
                    ORDER BY visitors DESC
                    LIMIT 15
                `, [from || null, to || null])
            ])

            const days = rowsOf(dayRows).map(row => ({
                day: String(row.day).slice(0, 10),
                uniqueVisitors: toInteger(row.unique_visitors),
                views: toInteger(row.views),
                newVisitors: toInteger(row.new_visitors),
                registeredVisitors: toInteger(row.registered_visitors)
            }))

            const totals = {
                uniqueVisitors: toInteger(firstRow(totalRow).unique_visitors),
                views: toInteger(firstRow(totalRow).views),
                newVisitors: toInteger(firstRow(totalRow).new_visitors),
                registeredVisitors: toInteger(firstRow(totalRow).registered_visitors)
            }

            return res.json({
                tracked: true,
                from: from || days[0]?.day || null,
                to: to || days[days.length - 1]?.day || null,
                totals,
                days,
                devices: rowsOf(deviceRows).map(row => ({
                    device: row.device,
                    visitors: toInteger(row.visitors),
                    views: toInteger(row.views)
                })),
                pages: rowsOf(pageRows).map(row => ({
                    path: row.path,
                    visitors: toInteger(row.visitors),
                    views: toInteger(row.views)
                })),
                referrers: rowsOf(referrerRows).map(row => ({
                    host: row.host,
                    visitors: toInteger(row.visitors),
                    views: toInteger(row.views)
                }))
            })
        } catch (error) {
            return fail(res, error, 'visits')
        }
    }
}

export default new AdminAnalyticsController()
