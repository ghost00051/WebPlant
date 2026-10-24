import { QueryTypes } from 'sequelize'

import sequelize from '../db.js'
import {
    hasAiAdviceLogs,
    hasChatLogs,
    hasGardenShares,
    hasGardenShareSignups,
    hasNotificationClicks,
    hasNotifications,
    hasProductEvents,
    hasSiteVisitDays,
    hasSiteVisitUtm,
    hasUserLegalConsents,
    hasUsersCreatedAt,
    hasUsersPrivilegeLevel
} from '../utils/adminSchema.js'
import {
    DEFAULT_RANGE_DAYS,
    MAX_RANGE_DAYS,
    TIMEZONE,
    userCreatedAtSql
} from '../utils/adminAnalytics.js'
import {
    buildMetricItem,
    buildMetricsSummary,
    formatMetricPercent,
    formatMetricRub,
    percent,
    targetAtLeast,
    targetAtMost,
    toCount
} from '../utils/productMetrics.js'

const MSK = `'${TIMEZONE}'`

const dayOf = expression => `((${expression}) AT TIME ZONE ${MSK})::date`

const BOUNDS_CTE = `WITH b AS (
    SELECT (now() AT TIME ZONE ${MSK})::date AS today,
           (now() AT TIME ZONE ${MSK})::date - ($1::int - 1) AS start_day
)`

const TODAY_CTE = `WITH b AS (
    SELECT (now() AT TIME ZONE ${MSK})::date AS today
)`

const inRange = expression =>
    `${dayOf(expression)} BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)`

export const METRIC_IDS = Object.freeze([
    'ttfv',
    'activation',
    'plants2',
    'd1',
    'd7',
    'd30',
    'push_ctr',
    'returns_no_push',
    'ai_usage',
    'ai_cost',
    'premium',
    'share_organic'
])

export const METRIC_DEFINITIONS = Object.freeze({
    ttfv: {
        label: 'TTFV — время до первой ценности',
        priority: 'P0',
        horizon: '3 недели',
        target: '< 60 сек у 60% новых',
        source: 'product_events: landing_view → plant_created; admin → Продукт (медиана и доля ≤ 60 с)',
        unit: 'seconds'
    },
    activation: {
        label: 'Activation rate',
        priority: 'P0',
        horizon: '4 недели',
        target: '≥ 50%',
        source: 'product_events / БД: register + plant_created + push_subscribed; admin → Продукт',
        unit: 'percent'
    },
    plants2: {
        label: 'Доля аккаунтов с ≥2 растениями',
        priority: 'P1',
        horizon: '8 недель',
        target: '≥ 40%',
        source: 'SQL по plants + users: доля аккаунтов с ≥2 растениями; admin → Продукт',
        unit: 'percent'
    },
    d1: {
        label: 'D1 retention',
        priority: 'P0',
        horizon: '4 недели',
        target: '≥ 40%',
        source: 'users.created_at + product_events + site_visit_days (возврат в окне D1); admin → Продукт',
        unit: 'percent'
    },
    d7: {
        label: 'D7 retention',
        priority: 'P1',
        horizon: '8 недель',
        target: '≥ 25%',
        source: 'users.created_at + product_events + site_visit_days (возврат в окне D7); admin → Продукт',
        unit: 'percent'
    },
    d30: {
        label: 'D30 retention',
        priority: 'P1',
        horizon: '12 недель',
        target: '≥ 12%',
        source: 'users.created_at + product_events + site_visit_days (возврат в окне D30); admin → Продукт',
        unit: 'percent'
    },
    push_ctr: {
        label: 'Push CTR',
        priority: 'P1',
        horizon: '6 недель',
        target: '≥ 10%',
        source: 'notifications.click_count / отправленные push + redirect-эндпоинт; admin → Продукт',
        unit: 'percent'
    },
    returns_no_push: {
        label: 'Возвраты без push',
        priority: 'P1',
        horizon: '8 недель',
        target: '≥ 30% возвратов',
        source: 'product_events + site_visit_days + уведомления за предыдущие 24 ч; admin → Продукт',
        unit: 'percent'
    },
    ai_usage: {
        label: 'Использование ИИ',
        priority: 'P1',
        horizon: '6 недель',
        target: '≥ 15% DAU',
        source: 'chat_logs + ai_advice_logs / активные пользователи; admin → Продукт',
        unit: 'percent'
    },
    ai_cost: {
        label: 'Стоимость ИИ на активного',
        priority: 'P2',
        horizon: '6 недель',
        target: '≤ 3–5 ₽/DAU',
        source: 'AI-телеметрия (Redis) × тариф AI_PRICE_* / DAU; admin → Продукт',
        unit: 'rub'
    },
    premium: {
        label: 'Конверсия в Premium',
        priority: 'P2',
        horizon: '12+ недель',
        target: '2–5% MAU',
        source: 'users.privilege_level ≠ free / MAU; биллинг и entitlements (F15) ещё не внедрены',
        unit: 'percent'
    },
    share_organic: {
        label: 'Органика из шаринга',
        priority: 'P2',
        horizon: '12 недель',
        target: '≥ 10% новых',
        source: 'garden_shares + garden_share_signups / регистрации; UTM/Web Share; admin → Продукт',
        unit: 'percent'
    }
})

const RETENTION_METRICS = Object.freeze([
    { id: 'd1', days: 1, target: 40, label: 'D1' },
    { id: 'd7', days: 7, target: 25, label: 'D7' },
    { id: 'd30', days: 30, target: 12, label: 'D30' }
])

const BILLING_DETAIL = 'биллинг и entitlements (F15) не внедрены: платящие = privilege_level ≠ free'
const SHARING_DETAIL = 'шаринг не внедрён: нет таблиц garden_shares/garden_share_signups'
const NO_METRIC_DATA = 'нет данных за период'

function normalizeDays(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RANGE_DAYS
    return Math.min(parsed, MAX_RANGE_DAYS)
}

function unavailable(detail) {
    return { status: 'unavailable', value: null, targetMet: null, detail }
}

function partial(detail, { value = null, targetMet = null } = {}) {
    return { status: 'partial', value, targetMet, detail }
}

function measured({ value, targetMet = null, detail = '' }) {
    return { status: 'measured', value, targetMet, detail }
}

async function selectRows(sql, params = []) {
    const result = await sequelize.query(sql, { bind: params, type: QueryTypes.SELECT })
    return Array.isArray(result) ? result : []
}

function firstRow(result) {
    return (Array.isArray(result) ? result : [])[0] || {}
}

async function safeMetric(id, compute) {
    try {
        return await compute()
    } catch (error) {
        console.error(`❌ Метрика продукта «${id}» не рассчитана:`, error)
        return unavailable('не удалось рассчитать метрику: ошибка запроса')
    }
}

function resolveCreatedAt(flags) {
    if (flags.usersCreatedAt) return userCreatedAtSql(true)
    if (flags.userLegalConsents) return userCreatedAtSql(false)
    return null
}

function numberLabel(value, digits = 2) {
    return String(Number(Number(value).toFixed(digits))).replace('.', ',')
}

async function loadSchemaFlags() {
    const [
        usersCreatedAt,
        userLegalConsents,
        productEvents,
        siteVisitDays,
        siteVisitUtm,
        gardenShares,
        gardenShareSignups,
        notificationClicks,
        notifications,
        chatLogs,
        aiAdviceLogs,
        usersPrivilegeLevel
    ] = await Promise.all([
        hasUsersCreatedAt(),
        hasUserLegalConsents(),
        hasProductEvents(),
        hasSiteVisitDays(),
        hasSiteVisitUtm(),
        hasGardenShares(),
        hasGardenShareSignups(),
        hasNotificationClicks(),
        hasNotifications(),
        hasChatLogs(),
        hasAiAdviceLogs(),
        hasUsersPrivilegeLevel()
    ])

    return {
        usersCreatedAt,
        userLegalConsents,
        productEvents,
        siteVisitDays,
        siteVisitUtm,
        gardenShares,
        gardenShareSignups,
        notificationClicks,
        notifications,
        chatLogs,
        aiAdviceLogs,
        usersPrivilegeLevel
    }
}

function retentionActivitySourceSql(flags) {
    const parts = []
    if (flags.productEvents) {
        parts.push(`SELECT pe.user_id, ${dayOf('pe.created_at')} AS ev_day
            FROM product_events pe
            WHERE pe.user_id IS NOT NULL`)
    }
    if (flags.siteVisitDays) {
        parts.push(`SELECT sv.user_id, sv.day AS ev_day
            FROM site_visit_days sv
            WHERE sv.user_id IS NOT NULL`)
    }
    if (parts.length === 0) return null
    return parts.join('\n            UNION\n            ')
}

function activeDaysSourceSql(flags) {
    const parts = []
    if (flags.productEvents) {
        parts.push(`SELECT DISTINCT pe.user_id, ${dayOf('pe.created_at')} AS active_day
            FROM product_events pe
            WHERE pe.user_id IS NOT NULL
              AND ${inRange('pe.created_at')}`)
    }
    if (flags.siteVisitDays) {
        parts.push(`SELECT DISTINCT sv.user_id, sv.day AS active_day
            FROM site_visit_days sv
            WHERE sv.user_id IS NOT NULL
              AND sv.day BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)`)
    }
    if (parts.length === 0) return null
    return parts.join('\n            UNION\n            ')
}

async function computeTtfvMetric({ days, flags }) {
    if (!flags.productEvents) {
        return unavailable('нет таблицы product_events: TTFV не измеряется')
    }

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        plant_first_all AS (
            SELECT pe.user_id, MIN(pe.created_at) AS plant_at
            FROM product_events pe
            JOIN users u ON u.id = pe.user_id
            WHERE pe.event = 'plant_created'
              AND u.role <> 'ADMIN'
              AND pe.user_id IS NOT NULL
            GROUP BY pe.user_id
        ),
        plant_first AS (
            SELECT user_id, plant_at
            FROM plant_first_all
            WHERE ${dayOf('plant_at')} BETWEEN (SELECT start_day FROM b) AND (SELECT today FROM b)
        ),
        visitors AS (
            SELECT DISTINCT pe.user_id, pe.visitor_id
            FROM product_events pe
            JOIN plant_first pf ON pf.user_id = pe.user_id
            WHERE pe.visitor_id IS NOT NULL
        ),
        landing AS (
            SELECT v.user_id, MIN(le.created_at) AS landing_at
            FROM visitors v
            JOIN product_events le
              ON le.visitor_id = v.visitor_id
             AND le.event = 'landing_view'
            JOIN plant_first pf ON pf.user_id = v.user_id
            WHERE le.created_at <= pf.plant_at
            GROUP BY v.user_id
        ),
        samples AS (
            SELECT EXTRACT(EPOCH FROM (pf.plant_at - l.landing_at)) AS seconds
            FROM plant_first pf
            JOIN landing l ON l.user_id = pf.user_id
            WHERE pf.plant_at >= l.landing_at
        )
        SELECT count(*)::int AS n,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds::float8), 0)::float AS p50,
               count(*) FILTER (WHERE seconds <= 60)::int AS within_60
        FROM samples
    `, [days]))

    const samples = toCount(row.n)
    const p50 = Number(row.p50)
    if (!samples || !Number.isFinite(p50)) {
        return partial(`нет пар landing_view → plant_created за ${days} дн.`)
    }

    const share = percent(row.within_60, samples)
    return measured({
        value: Math.round(p50),
        targetMet: targetAtLeast(share, 60),
        detail: `медиана; n=${samples}; ${formatMetricPercent(share)} ≤ 60 с`
    })
}

async function computeActivation({ days, flags }) {
    const createdExpr = resolveCreatedAt(flags)
    if (!createdExpr) {
        return unavailable('нет данных о регистрации: users.created_at отсутствует')
    }

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        reg AS (
            SELECT u.id
            FROM users u
            WHERE u.role <> 'ADMIN'
              AND ${inRange(createdExpr)}
        )
        SELECT count(*)::int AS denominator,
               count(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM plants p WHERE p.user_id = r.id)
                     AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = r.id)
               )::int AS numerator
        FROM reg r
    `, [days]))

    const denominator = toCount(row.denominator)
    const numerator = toCount(row.numerator)
    if (!denominator) {
        return partial(`нет регистраций за ${days} дн.`)
    }

    const value = percent(numerator, denominator)
    return measured({
        value,
        targetMet: targetAtLeast(value, 50),
        detail: `≥1 растение и push: ${numerator} из ${denominator}`
    })
}

async function computePlants2() {
    const row = firstRow(await selectRows(`
        WITH owner AS (
            SELECT u.id,
                   count(p.id) FILTER (WHERE p.is_active)::int AS active_plants
            FROM users u
            LEFT JOIN plants p ON p.user_id = u.id
            WHERE u.role <> 'ADMIN'
            GROUP BY u.id
        )
        SELECT count(*)::int AS denominator,
               count(*) FILTER (WHERE active_plants >= 2)::int AS numerator
        FROM owner
    `))

    const denominator = toCount(row.denominator)
    const numerator = toCount(row.numerator)
    if (!denominator) {
        return partial('нет не-админских аккаунтов')
    }

    const value = percent(numerator, denominator)
    return measured({
        value,
        targetMet: targetAtLeast(value, 40),
        detail: `≥2 активных растения: ${numerator} из ${denominator} аккаунтов`
    })
}

async function computeRetention({ flags }) {
    const createdExpr = resolveCreatedAt(flags)
    if (!createdExpr) {
        return unavailable('нет данных о регистрации: users.created_at отсутствует')
    }

    const source = retentionActivitySourceSql(flags)
    if (!source) {
        return unavailable('нет product_events и site_visit_days: возвраты не отслеживаются')
    }

    const windowsSql = RETENTION_METRICS
        .map(window => `count(*) FILTER (WHERE reg_day + ${window.days} < (SELECT today FROM b))::int AS ${window.id}_denominator,
            count(*) FILTER (WHERE reg_day + ${window.days} < (SELECT today FROM b) AND ${window.id})::int AS ${window.id}_numerator`)
        .join(',\n            ')

    const row = firstRow(await selectRows(`
        ${TODAY_CTE},
        u0 AS (
            SELECT u.id, ${dayOf(createdExpr)} AS reg_day
            FROM users u
            WHERE u.role <> 'ADMIN'
        ),
        ev AS (
            ${source}
        ),
        per_user AS (
            SELECT u0.id,
                   u0.reg_day,
                   bool_or(ev.ev_day BETWEEN u0.reg_day + 1 AND u0.reg_day + 1) AS d1,
                   bool_or(ev.ev_day BETWEEN u0.reg_day + 1 AND u0.reg_day + 7) AS d7,
                   bool_or(ev.ev_day BETWEEN u0.reg_day + 1 AND u0.reg_day + 30) AS d30
            FROM u0
            LEFT JOIN ev ON ev.user_id = u0.id
            GROUP BY u0.id, u0.reg_day
        )
        SELECT
            ${windowsSql}
        FROM per_user
    `))

    const results = {}
    for (const window of RETENTION_METRICS) {
        const denominator = toCount(row[`${window.id}_denominator`])
        const numerator = toCount(row[`${window.id}_numerator`])
        if (!denominator) {
            results[window.id] = partial(`нет пользователей с завершённым окном ${window.label}`)
            continue
        }
        const value = percent(numerator, denominator)
        results[window.id] = measured({
            value,
            targetMet: targetAtLeast(value, window.target),
            detail: `вернулись ${numerator} из ${denominator}; окно ${window.label} завершено`
        })
    }
    return results
}

async function computePushCtr({ days, flags }) {
    if (!flags.notifications) {
        return unavailable('нет таблицы notifications: push не отслеживаются')
    }

    const clicksExpression = flags.notificationClicks ? 'COALESCE(sum(click_count), 0)::int' : '0::int'
    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE}
        SELECT
            (SELECT count(*)::int FROM notifications WHERE ${inRange('created_at')}) AS notifications,
            (SELECT ${clicksExpression} FROM notifications WHERE ${inRange('created_at')}) AS clicks
    `, [days]))

    const notifications = toCount(row.notifications)
    const clicks = toCount(row.clicks)
    if (!notifications) {
        return partial(`push за ${days} дн. не отправлялись`)
    }
    if (!flags.notificationClicks) {
        return partial('клики не отслеживаются: нет notifications.click_count')
    }

    const value = percent(clicks, notifications)
    return measured({
        value,
        targetMet: targetAtLeast(value, 10),
        detail: `кликов ${clicks} из ${notifications}`
    })
}

async function computeReturnsNoPush({ days, flags }) {
    const active = activeDaysSourceSql(flags)
    if (!active) {
        return unavailable('нет product_events и site_visit_days: активность не отслеживается')
    }
    if (!flags.notifications) {
        return unavailable('нет таблицы notifications: push не отслеживаются')
    }

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        active AS (
            ${active}
        ),
        notified AS (
            SELECT DISTINCT n.user_id, ${dayOf('n.created_at')} AS push_day
            FROM notifications n
            WHERE ${dayOf('n.created_at')} >= (SELECT start_day FROM b) - 1
        )
        SELECT count(*)::int AS total,
               count(*) FILTER (
                   WHERE NOT EXISTS (
                       SELECT 1 FROM notified nd
                       WHERE nd.user_id = a.user_id
                         AND nd.push_day IN (a.active_day, a.active_day - 1)
                   )
               )::int AS without_push
        FROM active a
    `, [days]))

    const total = toCount(row.total)
    const withoutPush = toCount(row.without_push)
    if (!total) {
        return partial(`нет активных дней за ${days} дн.`)
    }

    const value = percent(withoutPush, total)
    return measured({
        value,
        targetMet: targetAtLeast(value, 30),
        detail: `дней без push: ${withoutPush} из ${total}`
    })
}

async function computeAiUsage({ days, flags }) {
    if (!flags.productEvents) {
        return unavailable('нет product_events: активные пользователи не отслеживаются')
    }

    const sources = []
    if (flags.chatLogs) {
        sources.push(`SELECT ${dayOf('cl.created_at')} AS day, cl.user_id
            FROM chat_logs cl
            WHERE cl.role = 'user'
              AND cl.user_id IS NOT NULL
              AND ${inRange('cl.created_at')}`)
    }
    if (flags.aiAdviceLogs) {
        sources.push(`SELECT ${dayOf('al.created_at')} AS day, al.user_id
            FROM ai_advice_logs al
            WHERE al.user_id IS NOT NULL
              AND ${inRange('al.created_at')}`)
    }
    if (sources.length === 0) {
        return unavailable('нет chat_logs и ai_advice_logs: использование ИИ не отслеживается')
    }

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        active_days AS (
            SELECT DISTINCT ${dayOf('pe.created_at')} AS day, pe.user_id
            FROM product_events pe
            WHERE pe.user_id IS NOT NULL
              AND ${inRange('pe.created_at')}
        ),
        ai_events AS (
            SELECT DISTINCT day, user_id
            FROM (
                ${sources.join('\n                UNION\n                ')}
            ) ai_source
            WHERE user_id IS NOT NULL
        ),
        per_day AS (
            SELECT a.day,
                   count(DISTINCT a.user_id)::int AS dau,
                   count(DISTINCT ae.user_id)::int AS ai_dau
            FROM active_days a
            LEFT JOIN ai_events ae
              ON ae.day = a.day
             AND ae.user_id = a.user_id
            GROUP BY a.day
        )
        SELECT count(*)::int AS active_days,
               count(*) FILTER (WHERE ai_dau > 0)::int AS ai_days,
               COALESCE(avg(ai_dau::float / dau), 0)::float AS avg_ratio
        FROM per_day
        WHERE dau > 0
    `, [days]))

    const activeDays = toCount(row.active_days)
    if (!activeDays) {
        return partial(`нет активных дней за ${days} дн.`)
    }

    const avgRatio = Number(row.avg_ratio)
    const aiDays = toCount(row.ai_days)
    const value = Number(((Number.isFinite(avgRatio) ? avgRatio : 0) * 100).toFixed(1))
    return measured({
        value,
        targetMet: targetAtLeast(value, 15),
        detail: `в среднем ${formatMetricPercent(value)} DAU в день; дней с ИИ ${aiDays} из ${activeDays}`
    })
}

async function computeAiCost({ days, flags, aiCost, aiRequests }) {
    const cost = aiCost === null || aiCost === undefined ? null : Number(aiCost)
    if (cost === null || !Number.isFinite(cost)) {
        return partial('тариф AI_PRICE_* не задан, стоимость ИИ недоступна')
    }

    const requests = aiRequests === null || aiRequests === undefined ? null : Number(aiRequests)
    if (requests !== null && (!Number.isFinite(requests) || requests <= 0)) {
        return partial('нет телеметрии ИИ за период — стоимость не рассчитана')
    }

    if (!flags.productEvents) {
        return unavailable('нет product_events: DAU не отслеживается')
    }

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        daily AS (
            SELECT ${dayOf('pe.created_at')} AS day,
                   count(DISTINCT pe.user_id)::int AS users
            FROM product_events pe
            WHERE pe.user_id IS NOT NULL
              AND ${inRange('pe.created_at')}
            GROUP BY 1
        )
        SELECT COALESCE(sum(users), 0)::int AS user_days,
               ($1::int) AS days
        FROM daily
    `, [days]))

    const userDays = toCount(row.user_days)
    const averageDau = days > 0 ? userDays / days : 0
    if (!averageDau) {
        return partial(`нет активных пользователей за ${days} дн.: DAU = 0`)
    }

    const value = Number((cost / userDays).toFixed(2))
    return measured({
        value,
        targetMet: targetAtMost(value, 5),
        detail: `расход ${formatMetricRub(cost)} за ${days} дн.; средний DAU ${numberLabel(averageDau)}; ` +
            `${formatMetricRub(value)}/DAU`
    })
}

async function computePremium({ flags }) {
    if (!flags.usersPrivilegeLevel) {
        return partial(BILLING_DETAIL)
    }

    let mau = 0
    if (flags.productEvents) {
        const row = firstRow(await selectRows(`
            ${TODAY_CTE}
            SELECT count(DISTINCT pe.user_id)::int AS mau
            FROM product_events pe
            WHERE pe.user_id IS NOT NULL
              AND ${dayOf('pe.created_at')} >= (SELECT today FROM b) - 29
        `))
        mau = toCount(row.mau)
    }

    const paidRow = firstRow(await selectRows(`
        SELECT count(*)::int AS paid
        FROM users u
        WHERE u.role <> 'ADMIN'
          AND u.privilege_level <> 'free'
    `))
    const paid = toCount(paidRow.paid)
    if (!mau) {
        return partial(`${BILLING_DETAIL}; MAU = 0`)
    }

    const value = percent(paid, mau)
    return partial(BILLING_DETAIL, {
        value,
        targetMet: targetAtLeast(value, 2)
    })
}

async function computeShareOrganic({ days, flags }) {
    if (!flags.gardenShares || !flags.gardenShareSignups) {
        return partial(SHARING_DETAIL)
    }

    const createdExpr = resolveCreatedAt(flags)
    if (!createdExpr) {
        return partial('нет данных о регистрации: users.created_at отсутствует')
    }

    const clicksExpression = flags.productEvents
        ? `(SELECT count(*)::int
              FROM product_events pe
             WHERE pe.event = 'share_clicked'
               AND ${inRange('pe.created_at')})`
        : '0::int'

    const row = firstRow(await selectRows(`
        ${BOUNDS_CTE},
        reg AS (
            SELECT u.id
            FROM users u
            WHERE u.role <> 'ADMIN'
              AND ${inRange(createdExpr)}
        )
        SELECT count(*)::int AS denominator,
               count(*) FILTER (
                   WHERE EXISTS (
                       SELECT 1
                       FROM garden_share_signups gss
                       WHERE gss.user_id = r.id
                   )
               )::int AS numerator,
               (SELECT COALESCE(sum(view_count), 0)::int FROM garden_shares) AS views,
               ${clicksExpression} AS clicks
        FROM reg r
    `, [days]))

    const denominator = toCount(row.denominator)
    if (!denominator) {
        return partial(`нет регистраций за ${days} дн.`)
    }

    const numerator = toCount(row.numerator)
    const views = toCount(row.views)
    const clicks = toCount(row.clicks)
    const value = percent(numerator, denominator)
    const clicksDetail = flags.productEvents ? `; кликов «Поделиться» ${clicks}` : ''
    return measured({
        value,
        targetMet: targetAtLeast(value, 10),
        detail: `регистрации из шаринга ${numerator} из ${denominator}; просмотров сада ${views}${clicksDetail}`
    })
}

export async function buildProductMetricsBoard({
    days = DEFAULT_RANGE_DAYS,
    aiCost = null,
    aiRequests = null
} = {}) {
    const safeDays = normalizeDays(days)
    const flags = await loadSchemaFlags()
    const context = { days: safeDays, flags, aiCost, aiRequests }

    const tasks = [
        ['ttfv', () => computeTtfvMetric(context)],
        ['activation', () => computeActivation(context)],
        ['plants2', () => computePlants2(context)],
        ['push_ctr', () => computePushCtr(context)],
        ['returns_no_push', () => computeReturnsNoPush(context)],
        ['ai_usage', () => computeAiUsage(context)],
        ['ai_cost', () => computeAiCost(context)],
        ['premium', () => computePremium(context)],
        ['share_organic', () => computeShareOrganic(context)]
    ]

    const [settled, retention] = await Promise.all([
        Promise.all(tasks.map(async ([id, compute]) => [id, await safeMetric(id, compute)])),
        safeMetric('retention', () => computeRetention(context))
    ])

    const results = Object.fromEntries(settled)
    for (const window of RETENTION_METRICS) {
        results[window.id] = retention?.[window.id] ||
            unavailable(`метрика ${window.label} не рассчитана: ${NO_METRIC_DATA}`)
    }

    const items = METRIC_IDS.map(id => buildMetricItem({ id, ...METRIC_DEFINITIONS[id] }, results[id]))
    return {
        items,
        summary: buildMetricsSummary(items)
    }
}

export default buildProductMetricsBoard
