import { QueryTypes } from 'sequelize'
import sequelize from '../db.js'
import { isMailConfigured, sendMail } from './mailService.js'
import { withDistributedLock } from '../utils/distributedLock.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import { getFirstName } from '../utils/personName.js'
import { TIMEZONE } from '../utils/adminAnalytics.js'
import { buildListUnsubscribeHeaders, buildUnsubscribeUrl } from '../utils/marketingConsent.js'

export const INACTIVITY_EMAIL_INTERVAL_MINUTES = 10
export const INACTIVITY_EMAIL_TICK_CRON = `*/${INACTIVITY_EMAIL_INTERVAL_MINUTES} * * * *`
export const INACTIVITY_EMAIL_TICK_LOCK = 'job:inactivity-email-tick'
export const INACTIVITY_EMAIL_SUBJECT = '«Лейка»: всё в порядке?'

const TICK_LOCK_TTL_MS = INACTIVITY_EMAIL_INTERVAL_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PRODUCT_URL = 'https://checktheplants.ru'
const APP_HOME_URL = `${PRODUCT_URL}/home`
const DEFAULT_UNSUBSCRIBE_URL = `${PRODUCT_URL}/unsubscribe`
const DEFAULT_LOGO_URL = 'https://checktheplants.ru/icons/icon-192.png'
const DEVELOPER_NAME = 'Иван Никитин'
const PREHEADER = 'Заметил, что вы давно не заходили в «Лейку» — вдруг что-то пошло не так.'

const CONFIG_DEFAULTS = {
    enabled: false,
    days: 7,
    requireMarketingConsent: true,
    repeatDays: 0,
    windowStart: 10,
    windowEnd: 20,
    maxPerTick: 200,
    batchSize: 100,
    delayMs: 200,
    dryRun: false
}

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    const normalized = String(value).trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function parseIntInRange(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
    return parsed
}

export function readInactivityEmailConfig(env = process.env) {
    return {
        enabled: readBoolean(env.INACTIVITY_EMAIL_ENABLED, CONFIG_DEFAULTS.enabled),
        days: parseIntInRange(env.INACTIVITY_EMAIL_DAYS, CONFIG_DEFAULTS.days, 1, 365),
        requireMarketingConsent: readBoolean(
            env.INACTIVITY_EMAIL_REQUIRE_MARKETING_CONSENT,
            CONFIG_DEFAULTS.requireMarketingConsent
        ),
        repeatDays: parseIntInRange(env.INACTIVITY_EMAIL_REPEAT_DAYS, CONFIG_DEFAULTS.repeatDays, 0, 365),
        windowStart: parseIntInRange(
            env.INACTIVITY_EMAIL_WINDOW_START,
            CONFIG_DEFAULTS.windowStart,
            0,
            23
        ),
        windowEnd: parseIntInRange(env.INACTIVITY_EMAIL_WINDOW_END, CONFIG_DEFAULTS.windowEnd, 1, 24),
        maxPerTick: parseIntInRange(
            env.INACTIVITY_EMAIL_MAX_PER_TICK,
            CONFIG_DEFAULTS.maxPerTick,
            1,
            5000
        ),
        batchSize: parseIntInRange(
            env.INACTIVITY_EMAIL_BATCH_SIZE,
            CONFIG_DEFAULTS.batchSize,
            1,
            1000
        ),
        delayMs: parseIntInRange(env.INACTIVITY_EMAIL_DELAY_MS, CONFIG_DEFAULTS.delayMs, 0, 60_000),
        dryRun: readBoolean(env.INACTIVITY_EMAIL_DRY_RUN, CONFIG_DEFAULTS.dryRun)
    }
}

function zonedDateKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date)
    const values = {}
    for (const part of parts) values[part.type] = part.value
    if (!values.year || !values.month || !values.day) return null
    return `${values.year}-${values.month}-${values.day}`
}

function shiftDateKey(dateKey, deltaDays) {
    const [year, month, day] = String(dateKey).split('-').map(Number)
    if (![year, month, day].every(Number.isInteger)) return null
    const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * DAY_MS)
    return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null
}

export function inactivityCutoffDay({ now = new Date(), days = CONFIG_DEFAULTS.days, timeZone = TIMEZONE } = {}) {
    const today = zonedDateKey(now, timeZone)
    if (!today) return null
    return shiftDateKey(today, -(days + 1))
}

export function localHour(date, timeZone = TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date)
    const hourPart = parts.find(part => part.type === 'hour')
    const hour = Number.parseInt(hourPart?.value, 10)
    if (!Number.isInteger(hour)) return null
    return hour % 24
}

export function isWithinSendWindow({ now = new Date(), timeZone, windowStart, windowEnd } = {}) {
    const hour = localHour(now, resolveTimeZone(timeZone))
    if (hour === null) return false
    return hour >= windowStart && hour < windowEnd
}

function normalizeDateOnly(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) return null
        const year = value.getFullYear()
        const month = String(value.getMonth() + 1).padStart(2, '0')
        const day = String(value.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
    return match ? match[0] : null
}

export function formatRussianDate(value) {
    const dateKey = normalizeDateOnly(value)
    if (!dateKey) return ''
    const [year, month, day] = dateKey.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (!Number.isFinite(date.getTime())) return ''
    try {
        return new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC'
        }).format(date)
    } catch {
        return dateKey
    }
}

export function pluralizeDaysGenitive(count) {
    const value = Math.abs(Number(count)) || 0
    const mod100 = value % 100
    const mod10 = value % 10
    if (mod100 >= 11 && mod100 <= 14) return 'дней'
    if (mod10 === 1) return 'дня'
    return 'дней'
}

export function formatSilenceDays(days) {
    const value = Number(days)
    if (!Number.isInteger(value) || value <= 7) return 'больше недели'
    return `больше ${value} ${pluralizeDaysGenitive(value)}`
}

function resolveHomeUrl(frontendUrl) {
    const first = String(frontendUrl || '').split(',')[0].trim().replace(/\/+$/, '')
    return /^https?:\/\//i.test(first) ? `${first}/home` : APP_HOME_URL
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function normalizeRows(result) {
    if (Array.isArray(result)) return result
    if (Array.isArray(result?.rows)) return result.rows
    if (Array.isArray(result?.[0])) return result[0]
    return []
}

export function buildInactivityCandidatesSql({ requireMarketingConsent = true, repeatDays = 0 } = {}) {
    const consentClause = requireMarketingConsent
        ? '\n  AND u.marketing_email_opt_in = TRUE'
        : ''
    const repeatClause = repeatDays > 0
        ? '\n      OR u.inactivity_email_sent_at < now() - (CAST(:repeatDays AS int) * INTERVAL \'1 day\')'
        : ''

    return `
SELECT
    u.id,
    u.email,
    u.name,
    u.timezone,
    u.inactivity_email_sent_at,
    v.last_visit_day
FROM (
    SELECT
        svd.user_id,
        MAX(svd.day) AS last_visit_day
    FROM site_visit_days svd
    WHERE svd.user_id IS NOT NULL
    GROUP BY svd.user_id
) v
JOIN users u ON u.id = v.user_id
WHERE u.id > :afterId
  AND u.role = 'USER'
  AND u.email IS NOT NULL
  AND TRIM(u.email) <> ''
  AND u.marketing_email_opt_out_at IS NULL
  AND v.last_visit_day <= CAST(:cutoffDay AS date)${consentClause}
  AND (
      u.inactivity_email_sent_at IS NULL
      OR u.inactivity_email_sent_at::date <= v.last_visit_day${repeatClause}
  )
ORDER BY u.id ASC
LIMIT :batchSize`
}

export function buildInactivityClaimSql({ requireMarketingConsent = true, repeatDays = 0 } = {}) {
    const consentClause = requireMarketingConsent
        ? '\n  AND u.marketing_email_opt_in = TRUE'
        : ''
    const repeatClause = repeatDays > 0
        ? '\n      OR u.inactivity_email_sent_at < now() - (CAST(:repeatDays AS int) * INTERVAL \'1 day\')'
        : ''

    return `
UPDATE users AS u
SET inactivity_email_sent_at = now()
WHERE u.id = :userId
  AND u.role = 'USER'
  AND u.email IS NOT NULL
  AND TRIM(u.email) <> ''
  AND u.marketing_email_opt_out_at IS NULL${consentClause}
  AND (
      u.inactivity_email_sent_at IS NULL
      OR u.inactivity_email_sent_at::date <= CAST(:lastVisitDay AS date)${repeatClause}
  )
  AND NOT EXISTS (
      SELECT 1
      FROM site_visit_days fresh
      WHERE fresh.user_id = u.id
        AND fresh.day > CAST(:lastVisitDay AS date)
  )
RETURNING u.id`
}

export function renderInactivityEmail({
    userName = '',
    lastVisitDate = null,
    silenceDays = CONFIG_DEFAULTS.days,
    unsubscribeUrl = '',
    homeUrl = APP_HOME_URL,
    logoUrl = DEFAULT_LOGO_URL
} = {}) {
    const firstName = getFirstName(userName)
    const greeting = firstName ? `Здравствуйте, ${firstName}!` : 'Здравствуйте!'
    const lastVisitLabel = formatRussianDate(lastVisitDate)
    const silenceLabel = formatSilenceDays(silenceDays)
    const ctaUrl = typeof homeUrl === 'string' && homeUrl ? homeUrl : APP_HOME_URL
    const unsubscribeLink = typeof unsubscribeUrl === 'string' && unsubscribeUrl
        ? unsubscribeUrl
        : DEFAULT_UNSUBSCRIBE_URL

    const firstParagraph = lastVisitLabel
        ? `Заметил, что вы не заходили в «Лейку» уже ${silenceLabel} — последний раз это было ${lastVisitLabel}. Решил написать: вдруг что-то пошло не так.`
        : `Заметил, что вы не заходили в «Лейку» уже ${silenceLabel}. Решил написать: вдруг что-то пошло не так.`
    const problemParagraph =
        'Если проблема в приложении — просто ответьте на это письмо и расскажите, что случилось. ' +
        'Я читаю все ответы сам и стараюсь быстро всё починить.'
    const busyParagraph =
        'Если просто выдалась занятая неделя — растения вас ждут: расписание полива и напоминания на месте.'

    const text = [
        greeting,
        '',
        firstParagraph,
        '',
        problemParagraph,
        '',
        busyParagraph,
        '',
        `Открыть свой сад: ${ctaUrl}`,
        '',
        `— ${DEVELOPER_NAME}, разработчик «Лейки», checktheplants.ru`,
        '',
        'Вы получили это письмо, потому что зарегистрированы в «Лейке».',
        '',
        'Не хотите получать такие письма — отпишитесь в один клик:',
        unsubscribeLink
    ].join('\n')

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(INACTIVITY_EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#1f2a24;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(PREHEADER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:18px;padding:32px;">
<tr><td align="center" style="padding-bottom:14px;">
<img src="${escapeHtml(logoUrl)}" width="76" height="76" alt="Лейка" style="display:block;width:76px;height:76px;border:0;border-radius:50%;">
</td></tr>
<tr><td align="center" style="font-size:22px;line-height:30px;font-weight:700;color:#1f2a24;padding-bottom:20px;">${escapeHtml(INACTIVITY_EMAIL_SUBJECT)}</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:12px;">${escapeHtml(greeting)}</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:14px;">${escapeHtml(firstParagraph)}</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:14px;">${escapeHtml(problemParagraph)}</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:20px;">${escapeHtml(busyParagraph)}</td></tr>
<tr><td align="center" style="padding:6px 0 18px;">
<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background-color:#2f8f4e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:15px 30px;border-radius:12px;">Открыть свой сад</a>
</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-top:6px;">
— ${escapeHtml(DEVELOPER_NAME)}, разработчик «Лейки», <a href="${PRODUCT_URL}" style="color:#2f8f4e;text-decoration:none;">checktheplants.ru</a>
</td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#8a988f;border-top:1px solid #e6ece7;padding-top:16px;">
Отвечать на это письмо можно как обычно — ответ придёт разработчику.<br>
Вы получили это письмо, потому что зарегистрированы в «Лейке».<br>
Не хотите получать такие письма — <a href="${escapeHtml(unsubscribeLink)}" style="color:#8a988f;text-decoration:underline;">отпишитесь в один клик</a>.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

    return { subject: INACTIVITY_EMAIL_SUBJECT, text, html }
}

function buildUnsubscribePayload(userId, env = process.env) {
    const options = {
        frontendUrl: env.FRONTEND_URL,
        secret: env.SECRET_KEY,
        baseUrl: env.UNSUBSCRIBE_URL_BASE || ''
    }
    try {
        return {
            unsubscribeUrl: buildUnsubscribeUrl(userId, options),
            headers: buildListUnsubscribeHeaders(userId, options)
        }
    } catch (error) {
        console.warn(
            '⚠️ inactivity-email: не удалось построить ссылку отписки (нет SECRET_KEY/FRONTEND_URL):',
            error?.message || error
        )
        return { unsubscribeUrl: '', headers: undefined }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

class InactivityEmailService {
    constructor(deps = {}) {
        this.sequelize = deps.sequelize || sequelize
        this.mail = { isMailConfigured, sendMail, ...(deps.mail || {}) }
        this.env = deps.env || process.env
        this.runWithLock = deps.withDistributedLock || withDistributedLock
    }

    async runInactivityEmailTick(now = new Date()) {
        const config = readInactivityEmailConfig(this.env)
        if (!config.enabled) return { skipped: true, reason: 'disabled' }
        if (config.windowStart >= config.windowEnd) {
            console.warn(
                '⚠️ inactivity-email: окно отправки пустое ' +
                `(INACTIVITY_EMAIL_WINDOW_START=${config.windowStart} >= ` +
                `INACTIVITY_EMAIL_WINDOW_END=${config.windowEnd}) — письма не будут уходить`
            )
        }

        try {
            const outcome = await this.runWithLock(
                INACTIVITY_EMAIL_TICK_LOCK,
                { ttlMs: TICK_LOCK_TTL_MS },
                () => this.tick(now, config)
            )
            if (!outcome?.ran) return { skipped: true, reason: outcome?.reason || 'locked' }
            return { skipped: false, ...outcome.result }
        } catch (error) {
            console.error('❌ InactivityEmailService: тик упал целиком:', error?.message || error)
            return { skipped: true, reason: 'error' }
        }
    }

    async tick(now = new Date(), config = readInactivityEmailConfig(this.env)) {
        const startedAt = Date.now()
        const counters = {
            batches: 0,
            scanned: 0,
            candidates: 0,
            sent: 0,
            planned: 0,
            skippedWindow: 0,
            skippedDuplicate: 0,
            skippedNoMail: 0,
            errors: 0
        }
        const cutoffDay = inactivityCutoffDay({ now, days: config.days })
        const mailReady = this.mail.isMailConfigured(this.env)

        if (!mailReady && !config.dryRun) {
            console.warn(
                '⚠️ inactivity-email: SMTP не настроен (SMTP_USER/SMTP_PASSWORD) — ' +
                'тик пропущен, БД не сканирую'
            )
            const metric = {
                startedAt: new Date(startedAt).toISOString(),
                durationMs: Date.now() - startedAt,
                dryRun: false,
                mailReady: false,
                skippedReason: 'mail-not-configured',
                cutoffDay,
                truncated: false,
                ...counters
            }
            console.info('[inactivity-email-tick]', JSON.stringify(metric))
            return metric
        }

        const sql = buildInactivityCandidatesSql(config)

        let afterId = 0
        let truncated = false

        while (true) {
            if (this.tickLimitReached(counters, config)) {
                truncated = true
                break
            }

            const rows = await this.fetchBatch({ sql, afterId, cutoffDay, config })
            if (!rows.length) break

            counters.batches += 1
            counters.candidates += rows.length

            for (const row of rows) {
                if (this.tickLimitReached(counters, config)) {
                    truncated = true
                    break
                }
                await this.processCandidate(row, { now, config, counters })
            }

            if (truncated) break

            const lastId = Number(rows[rows.length - 1]?.id)
            if (!Number.isInteger(lastId) || lastId <= afterId) {
                console.warn(
                    `⚠️ inactivity-email: некорректный id последней строки (${lastId}) — ` +
                    'останавливаю обход, чтобы не зациклиться'
                )
                break
            }
            afterId = lastId

            if (rows.length < config.batchSize) break
        }

        if (truncated) {
            console.warn(
                '⚠️ inactivity-email: тик упёрся в INACTIVITY_EMAIL_MAX_PER_TICK — ' +
                'остальные пользователи будут обработаны следующим тиком'
            )
        }

        const metric = {
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            dryRun: config.dryRun,
            mailReady,
            skippedReason: mailReady || config.dryRun ? null : 'mail-not-configured',
            cutoffDay,
            truncated,
            ...counters
        }
        console.info('[inactivity-email-tick]', JSON.stringify(metric))
        return metric
    }

    tickLimitReached(counters, config) {
        return counters.scanned >= config.maxPerTick || counters.sent + counters.planned >= config.maxPerTick
    }

    async fetchBatch({ sql, afterId, cutoffDay, config }) {
        const result = await this.sequelize.query(sql, {
            replacements: {
                afterId,
                cutoffDay,
                batchSize: config.batchSize,
                repeatDays: config.repeatDays
            },
            type: QueryTypes.SELECT
        })
        return normalizeRows(result)
    }

    async processCandidate(row, { now, config, counters }) {
        counters.scanned += 1

        const userId = Number(row?.id)
        if (!Number.isInteger(userId) || userId < 1) return

        const timeZone = resolveTimeZone(row?.timezone)
        if (!isWithinSendWindow({
            now,
            timeZone,
            windowStart: config.windowStart,
            windowEnd: config.windowEnd
        })) {
            counters.skippedWindow += 1
            return
        }

        if (config.dryRun) {
            counters.planned += 1
            console.info(
                `[inactivity-email-tick] dry-run: отправили бы пользователю ${userId} ` +
                `(последний заход ${normalizeDateOnly(row?.last_visit_day) || '—'})`
            )
            return
        }

        const previousSentAt = row?.inactivity_email_sent_at ?? null

        let claimed = false
        try {
            claimed = await this.claimCandidate(row, config)
        } catch (error) {
            counters.errors += 1
            console.error(
                `❌ inactivity-email: не удалось занять пользователя ${userId}:`,
                error?.message || error
            )
            return
        }

        if (!claimed) {
            counters.skippedDuplicate += 1
            return
        }

        try {
            const { unsubscribeUrl, headers } = buildUnsubscribePayload(userId, this.env)
            const message = renderInactivityEmail({
                userName: row?.name,
                lastVisitDate: row?.last_visit_day,
                silenceDays: config.days,
                unsubscribeUrl,
                homeUrl: resolveHomeUrl(this.env.FRONTEND_URL)
            })
            await this.mail.sendMail({ to: row.email, headers, ...message }, this.env)
            counters.sent += 1
            if (config.delayMs > 0) await sleep(config.delayMs)
        } catch (error) {
            counters.errors += 1
            console.error(
                `❌ inactivity-email: письмо пользователю ${userId} не ушло:`,
                error?.message || error
            )
            await this.revertClaim(userId, previousSentAt)
        }
    }

    async claimCandidate(row, config) {
        const result = await this.sequelize.query(buildInactivityClaimSql(config), {
            replacements: {
                userId: Number(row?.id),
                lastVisitDay: normalizeDateOnly(row?.last_visit_day),
                repeatDays: config.repeatDays
            },
            type: QueryTypes.SELECT
        })
        return normalizeRows(result).length > 0
    }

    async revertClaim(userId, previousSentAt) {
        const previous = previousSentAt instanceof Date
            ? previousSentAt.toISOString()
            : previousSentAt ?? null
        try {
            await this.sequelize.query(
                'UPDATE users SET inactivity_email_sent_at = CAST(:previousSentAt AS timestamptz) ' +
                'WHERE id = :userId',
                {
                    replacements: { userId, previousSentAt: previous },
                    type: QueryTypes.UPDATE
                }
            )
        } catch (error) {
            console.error(
                `❌ inactivity-email: не удалось откатить inactivity_email_sent_at пользователя ${userId}:`,
                error?.message || error
            )
        }
    }
}

export default new InactivityEmailService()
export { InactivityEmailService }
