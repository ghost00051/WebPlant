import { Op } from 'sequelize'
import NotificationPreference from '../models/NotificationPreference.js'
import WateringLog from '../models/WateringLog.js'
import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import PlantCareLog from '../models/PlantCareLog.js'
import User from '../models/userModels.js'
import { sendNotificationPush, storeNotification } from './notificationService.js'
import { isMailConfigured, sendMail } from './mailService.js'
import { isQuietTimeForPreference } from '../utils/quietHours.js'
import { withDistributedLock } from '../utils/distributedLock.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import {
    forEachInChunks,
    iterateBatchesById,
    readReminderBatchConfig,
    readReminderPushConcurrency
} from '../utils/plantBatching.js'
import {
    buildWeeklyRecap,
    computeCareStreak,
    summarizeWeek,
    weekWindow,
    zonedDateParts,
    DAY_MS,
    STREAK_WINDOW_DAYS,
    WEEKLY_RECAP_TITLE,
    WEEKLY_RECAP_TYPE,
    WEEKLY_RECAP_URL
} from '../utils/careStreak.js'

export const WEEKLY_RECAP_INTERVAL_MINUTES = 10
export const WEEKLY_RECAP_TICK_CRON = `*/${WEEKLY_RECAP_INTERVAL_MINUTES} * * * *`
export const WEEKLY_RECAP_TICK_LOCK = 'job:weekly-recap-tick'

const TICK_LOCK_TTL_MS = WEEKLY_RECAP_INTERVAL_MINUTES * 60 * 1000
const STREAK_EVENT_LIMIT = 1000
const DEFAULT_WEEKLY_RECAP_HOUR = 19
const DEFAULT_WEEKLY_RECAP_WEEKDAY = 7
const PRODUCT_URL = 'https://checktheplants.ru'

const DEFAULT_MODELS = {
    NotificationPreference,
    WateringLog,
    Plant,
    PlantPhoto,
    PlantCareLog,
    User
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

export function readWeeklyRecapConfig(env = process.env) {
    return {
        enabled: readBoolean(env.WEEKLY_RECAP_ENABLED, true),
        emailEnabled: readBoolean(env.WEEKLY_RECAP_EMAIL_ENABLED, false),
        hour: parseIntInRange(env.WEEKLY_RECAP_HOUR, DEFAULT_WEEKLY_RECAP_HOUR, 0, 23),
        weekday: parseIntInRange(
            env.WEEKLY_RECAP_WEEKDAY,
            DEFAULT_WEEKLY_RECAP_WEEKDAY,
            1,
            7
        )
    }
}

export function weeklyRecapDedupeKey(weekStartDate) {
    return `weekly-recap:${weekStartDate}`
}

export function isWeeklyRecapDue({ now = new Date(), timeZone, config }) {
    if (!config || !config.enabled) return false
    const local = zonedDateParts(now, timeZone)
    return local.isoWeekday === config.weekday && local.hour >= config.hour
}

export function shouldSendRecapEmail(user, config, {
    env = process.env,
    isMailReady = isMailConfigured
} = {}) {
    if (!config?.emailEnabled) return false
    if (!user || user.marketing_email_opt_in !== true) return false
    if (typeof user.email !== 'string' || !user.email.trim()) return false
    return Boolean(isMailReady(env))
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function normalizeDateKey(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
    }
    const text = String(value).trim()
    return text ? text.slice(0, 10) : null
}

export function buildWeeklyRecapEmail({ recap, weekStartDate, frontendUrl }) {
    const profileUrl = `${String(frontendUrl || PRODUCT_URL).trim().replace(/\/+$/, '') || PRODUCT_URL}/profile`
    const body = typeof recap?.body === 'string' ? recap.body : ''
    const subject = '🌿 Итоги недели в «Лейке»'

    const text = [
        'Привет!',
        '',
        'Вот как прошла неделя ухода за растениями:',
        '',
        body,
        '',
        weekStartDate ? `Неделя с ${weekStartDate}` : '',
        '',
        `Настроить уведомления и профиль: ${profileUrl}`,
        '',
        '— «Лейка», checktheplants.ru',
        '',
        'Вы получили это письмо, потому что согласились на письма о растениях в настройках.'
    ].filter(line => line !== null).join('\n')

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#1f2a24;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:18px;padding:32px;">
<tr><td style="font-size:20px;line-height:28px;font-weight:700;color:#1f2a24;padding-bottom:12px;">🌿 Итоги недели</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:16px;">Привет! Вот как прошла неделя ухода за растениями:</td></tr>
<tr><td style="font-size:17px;line-height:26px;font-weight:600;color:#1f2a24;padding:8px 0 18px;">${escapeHtml(body)}</td></tr>
${weekStartDate ? `<tr><td style="font-size:14px;line-height:21px;color:#6b7a71;padding-bottom:18px;">Неделя с ${escapeHtml(weekStartDate)}</td></tr>` : ''}
<tr><td align="center" style="padding:4px 0 20px;">
<a href="${escapeHtml(profileUrl)}" style="display:inline-block;background-color:#2f8f4e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:12px;">Открыть профиль</a>
</td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#8a988f;border-top:1px solid #e6ece7;padding-top:16px;">
Вы получили это письмо, потому что согласились на письма о растениях в настройках.<br>
Отключить их можно в профиле: <a href="${escapeHtml(profileUrl)}" style="color:#8a988f;">${escapeHtml(profileUrl)}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

    return { subject, text, html }
}

class WeeklyRecapService {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.notifications = { storeNotification, sendNotificationPush, ...(deps.notifications || {}) }
        this.mail = { isMailConfigured, sendMail, ...(deps.mail || {}) }
        this.env = deps.env || process.env
        this.runWithLock = deps.withDistributedLock || withDistributedLock
    }

    async runWeeklyRecapTick(now = new Date()) {
        const config = readWeeklyRecapConfig(this.env)
        if (!config.enabled) return { skipped: true, reason: 'disabled' }

        try {
            const outcome = await this.runWithLock(
                WEEKLY_RECAP_TICK_LOCK,
                { ttlMs: TICK_LOCK_TTL_MS },
                () => this.tick(now, config)
            )
            if (!outcome?.ran) return { skipped: true, reason: outcome?.reason || 'locked' }
            return { skipped: false, ...outcome.result }
        } catch (error) {
            console.error('❌ WeeklyRecapService: тик упал целиком:', error?.message || error)
            return { skipped: true, reason: 'error' }
        }
    }

    async tick(now = new Date(), config = readWeeklyRecapConfig(this.env)) {
        const startedAt = Date.now()
        const counters = {
            batches: 0,
            usersProcessed: 0,
            recapsCreated: 0,
            pushesAttempted: 0,
            emailsSent: 0,
            usersSkipped: 0,
            errors: 0
        }
        const { batchSize, maxBatches } = readReminderBatchConfig(this.env)
        const concurrency = readReminderPushConcurrency(this.env)

        const outcome = await iterateBatchesById({
            model: this.models.NotificationPreference,
            idColumn: 'user_id',
            where: { weekly_recap_enabled: true },
            batchSize,
            maxBatches,
            attributes: [
                'user_id',
                'last_weekly_recap_date',
                'quiet_hours_enabled',
                'quiet_hours_start',
                'quiet_hours_end'
            ],
            onBatch: async preferences => {
                counters.batches += 1
                counters.usersProcessed += preferences.length
                const users = await this.loadUsers(preferences.map(preference => preference.user_id))

                await forEachInChunks(preferences, concurrency, preference =>
                    this.processPreference(preference, users.get(preference.user_id), {
                        now,
                        config,
                        counters
                    })
                )
            }
        })

        if (outcome.truncated) {
            console.warn(
                '⚠️ weekly-recap: тик упёрся в REMINDER_TICK_MAX_BATCHES — ' +
                'остальные пользователи будут обработаны следующим тиком'
            )
        }

        const metric = {
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            ...counters
        }
        console.info('[weekly-recap-tick]', JSON.stringify(metric))
        return metric
    }

    async loadUsers(userIds) {
        const ids = [...new Set((userIds || []).filter(id => Number.isInteger(Number(id))).map(Number))]
        if (!ids.length) return new Map()

        const users = await this.models.User.findAll({
            where: { id: { [Op.in]: ids } },
            attributes: ['id', 'timezone', 'email', 'marketing_email_opt_in'],
            raw: true
        })

        return new Map((Array.isArray(users) ? users : []).map(user => [Number(user.id), user]))
    }

    async processPreference(preference, user, { now, config, counters }) {
        const userId = Number(preference?.user_id)
        if (!Number.isInteger(userId) || userId < 1) return

        try {
            const timeZone = resolveTimeZone(user?.timezone)
            if (!isWeeklyRecapDue({ now, timeZone, config })) {
                counters.usersSkipped += 1
                return
            }

            const window = weekWindow(now, timeZone)
            if (normalizeDateKey(preference.last_weekly_recap_date) === window.startDate) {
                counters.usersSkipped += 1
                return
            }

            const activity = await this.loadActivity(userId, now, window)
            const week = summarizeWeek(activity.events, {
                now,
                timeZone,
                photos: activity.photos,
                careActions: activity.careActions
            })

            if (week.scheduled === 0 && week.photos === 0 && week.careActions === 0) {
                counters.usersSkipped += 1
                return
            }

            const streak = computeCareStreak(activity.events, { now })
            const recap = buildWeeklyRecap({ week, streak })
            const quietNow = isQuietTimeForPreference(preference, { now, timeZone })

            const { notification, created } = await this.notifications.storeNotification({
                userId,
                type: WEEKLY_RECAP_TYPE,
                title: recap.title || WEEKLY_RECAP_TITLE,
                body: recap.body,
                payload: recap.payload,
                url: WEEKLY_RECAP_URL,
                dedupeKey: weeklyRecapDedupeKey(window.startDate)
            })

            if (typeof preference.update === 'function') {
                await preference.update({ last_weekly_recap_date: window.startDate })
            }

            if (!created) {
                counters.usersSkipped += 1
                return
            }

            counters.recapsCreated += 1

            if (quietNow) {
                console.log(
                    `🌙 weekly-recap: у пользователя ${userId} тихие часы — ` +
                    'recap сохранён в приложении без push и письма'
                )
            } else {
                await this.notifications.sendNotificationPush({
                    userId,
                    title: recap.title || WEEKLY_RECAP_TITLE,
                    body: recap.body,
                    data: {
                        url: WEEKLY_RECAP_URL,
                        tag: WEEKLY_RECAP_TYPE,
                        notificationId: notification?.id ?? null
                    }
                })
                counters.pushesAttempted += 1
            }

            await this.maybeSendEmail(user, {
                userId,
                recap,
                weekStartDate: window.startDate,
                config,
                counters,
                skip: quietNow
            })
        } catch (error) {
            counters.errors += 1
            console.error(`❌ weekly-recap: ошибка пользователя ${userId}:`, error?.message || error)
        }
    }

    async maybeSendEmail(user, { userId, recap, weekStartDate, config, counters, skip = false }) {
        if (skip) {
            console.log(`🌙 weekly-recap: у пользователя ${userId} тихие часы — письмо не отправляем`)
            return
        }
        if (!shouldSendRecapEmail(user, config, {
            env: this.env,
            isMailReady: env => this.mail.isMailConfigured(env)
        })) {
            return
        }

        try {
            const message = buildWeeklyRecapEmail({
                recap,
                weekStartDate,
                frontendUrl: this.env.FRONTEND_URL
            })
            await this.mail.sendMail({ to: user.email, ...message }, this.env)
            counters.emailsSent += 1
        } catch (error) {
            console.error(
                `⚠️ weekly-recap: не удалось отправить письмо пользователю ${userId}:`,
                error?.message || error
            )
        }
    }

    async loadActivity(userId, now, window) {
        const streakFrom = new Date(now.getTime() - STREAK_WINDOW_DAYS * DAY_MS)
        const events = await this.models.WateringLog.findAll({
            where: {
                user_id: userId,
                action_at: { [Op.gte]: streakFrom, [Op.lte]: now }
            },
            attributes: ['action', 'action_at', 'hours_late'],
            order: [['action_at', 'DESC']],
            limit: STREAK_EVENT_LIMIT,
            raw: true
        })

        const photos = await this.countWeekPhotos(userId, window, now)
        const careActions = await this.models.PlantCareLog.count({
            where: {
                user_id: userId,
                performed_at: { [Op.gte]: window.start, [Op.lte]: now }
            }
        })

        return {
            events: Array.isArray(events) ? events : [],
            photos: Number(photos) || 0,
            careActions: Number(careActions) || 0
        }
    }

    async countWeekPhotos(userId, window, now) {
        const plants = await this.models.Plant.findAll({
            where: { user_id: userId },
            attributes: ['id'],
            raw: true
        })
        const plantIds = (Array.isArray(plants) ? plants : [])
            .map(plant => Number(plant?.id))
            .filter(id => Number.isInteger(id) && id > 0)
        if (!plantIds.length) return 0

        const count = await this.models.PlantPhoto.count({
            where: {
                plant_id: { [Op.in]: plantIds },
                created_at: { [Op.gte]: window.start, [Op.lte]: now }
            }
        })
        return Number(count) || 0
    }
}

export default new WeeklyRecapService()
export { WeeklyRecapService }
