import cron from 'node-cron'
import { Op } from 'sequelize'
import sequelize from '../db.js'
import Plant from '../models/Plant.js'
import WateringLog from '../models/WateringLog.js'
import NotificationPreference from '../models/NotificationPreference.js'
import {
    storeNotification,
    sendNotificationPush,
    NOTIFICATION_BODY_MAX_LENGTH
} from '../services/notificationService.js'
import careAdviceService from '../services/careAdviceService.js'
import {
    isReminderWeekday,
    splitMissedWaterings,
    weekdayRestrictionApplies,
    zonedDayHourAfter,
    zonedDayKey,
    MISSED_GRACE_MS,
    WATERING_TIME_OF_DAY_HOURS
} from '../utils/wateringSchedule.js'
import { withDistributedLock } from '../utils/distributedLock.js'
import User from '../models/userModels.js'
import { DEFAULT_TIME_ZONE, resolveTimeZone } from '../utils/timeZone.js'
import { isRemindersPaused, registerAutoSkip } from '../utils/plantMetadata.js'
import { readPrediction } from '../utils/wateringPrediction.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const SUMMARY_HOUR = 9
const CARE_ADVICE_START_HOUR = 10
const CARE_ADVICE_END_HOUR = 12
const DAY_BEFORE_START_HOUR = 9
const DAY_BEFORE_END_HOUR = 21
const DAY_BEFORE_QUERY_FROM_MS = 8 * HOUR
const DAY_BEFORE_QUERY_TO_MS = 44 * HOUR

const ON_DAY_EARLY_MS = 5 * MINUTE

const ON_DAY_LATE_MS = 15 * MINUTE

const ON_DAY_CATCHUP_MARGIN_MS = 5 * MINUTE
const AUTO_SKIP_NOTE = 'Автоматический пропуск (истёк grace-период 24ч)'
const MAX_SKIP_LOGS_PER_TICK = 100
const MAX_SUMMARY_PLANTS = 5
const SUMMARY_NAME_MAX_LENGTH = 40
const SUMMARY_LOCATION_MAX_LENGTH = 40
const NOTIFY_NAME_MAX_LENGTH = 80
const TICK_LOCK = 'job:reminder-tick'
const SUMMARY_TICK_LOCK = 'job:morning-summary-tick'
const CARE_ADVICE_TICK_LOCK = 'job:care-advice-tick'
const TICK_INTERVAL_MINUTES = 10
const TICK_CRON = `*/${TICK_INTERVAL_MINUTES} * * * *`
const TICK_LOCK_TTL_MS = TICK_INTERVAL_MINUTES * 60 * 1000
const SEPARATE_TICK_LOCK_TTL_MS = 30 * MINUTE

function getDateParts(date, timeZone) {
    return Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    )
}

function zonedMidnightToUtc({ year, month, day }, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day)
    const zoned = getDateParts(new Date(utcGuess), timeZone)
    const zonedAsUtc = Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hour,
        zoned.minute,
        zoned.second
    )
    return new Date(utcGuess - (zonedAsUtc - utcGuess))
}

function getDayBounds(now, timeZone) {
    const today = getDateParts(now, timeZone)
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day)
    const tomorrow = new Date(todayUtc + 24 * HOUR)
    const tomorrowParts = {
        year: tomorrow.getUTCFullYear(),
        month: tomorrow.getUTCMonth() + 1,
        day: tomorrow.getUTCDate()
    }

    return {
        date: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
        end: zonedMidnightToUtc(tomorrowParts, timeZone)
    }
}

function zonedDayKeyFromParts(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function localTomorrowKey(now, timeZone) {
    return zonedDayKey(zonedDayHourAfter(now, 1, 12, timeZone), timeZone)
}

function wateringHour(plant) {
    return WATERING_TIME_OF_DAY_HOURS[plant.watering_time_of_day] ??
        WATERING_TIME_OF_DAY_HOURS.morning
}

function intervalDaysOf(plant) {
    return Number.isInteger(plant.watering_interval_days) && plant.watering_interval_days > 0
        ? plant.watering_interval_days
        : 7
}

function slotIso(value) {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function matchesWeekdayForSlot(plant, slot, timeZone) {
    if (!weekdayRestrictionApplies(plant.watering_interval_days)) return true
    return isReminderWeekday(plant.reminder_weekdays, slot, timeZone)
}

async function loadTimeZones(userIds) {
    const ids = [...new Set(userIds)]
    if (!ids.length) return new Map()

    const users = await User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'timezone'],
        raw: true
    })

    return new Map(users.map(user => [user.id, resolveTimeZone(user.timezone)]))
}

export function truncateText(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function buildMorningSummaryBody(plants = []) {
    const list = Array.isArray(plants) ? plants : []
    const names = list.slice(0, MAX_SUMMARY_PLANTS).map(plant => {
        const name = truncateText(plant.name || 'Растение', SUMMARY_NAME_MAX_LENGTH)
        const location = plant.location
            ? ` (${truncateText(plant.location, SUMMARY_LOCATION_MAX_LENGTH)})`
            : ''
        return `${name}${location}`
    })
    const extraCount = list.length - names.length
    const text = list.length
        ? `Сегодня полить: ${names.join(', ')}${extraCount > 0 ? ` и ещё ${extraCount}` : ''}`
        : 'На сегодня полив не запланирован 🌱'

    return truncateText(text, NOTIFICATION_BODY_MAX_LENGTH)
}

export function formatSlotLabel(slot, timeZone = DEFAULT_TIME_ZONE) {
    const date = slot instanceof Date ? slot : new Date(slot)
    if (!Number.isFinite(date.getTime())) return ''
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(date)
}

export function buildOnDayNotification(plant, { slot, timeZone, now = new Date() }) {
    const name = truncateText(plant?.name || 'Растение', NOTIFY_NAME_MAX_LENGTH)
    const location = plant?.location
        ? ` (${truncateText(plant.location, SUMMARY_LOCATION_MAX_LENGTH)})`
        : ''
    const slotDate = new Date(slot)
    const isLate = Number.isFinite(slotDate.getTime()) &&
        now.getTime() - slotDate.getTime() > ON_DAY_LATE_MS
    const confidence = readPrediction(plant?.metadata)?.confidence
    const uncertainNote = confidence === 'low'
        ? ' Проверьте грунт: срок ориентировочный.'
        : ''

    if (!isLate) {
        return {
            title: '💧 Пора полить!',
            body: truncateText(
                `${name}${location} ждёт воды.${uncertainNote}`,
                NOTIFICATION_BODY_MAX_LENGTH
            )
        }
    }

    return {
        title: '💧 Пора полить!',
        body: truncateText(
            `${name}${location} ждёт воды. Полив был запланирован на ${formatSlotLabel(slotDate, timeZone)}.${uncertainNote}`,
            NOTIFICATION_BODY_MAX_LENGTH
        )
    }
}

export function buildAutoSkipNotification(plant, missedCount) {
    const name = truncateText(plant?.name || 'Растение', NOTIFY_NAME_MAX_LENGTH)
    const body = missedCount === 1
        ? `«${name}»: полив пропущен. Растение всё ещё ждёт воды.`
        : `«${name}»: пропущено ${missedCount} поливов. Растение всё ещё ждёт воды.`

    return {
        title: '💧 Полив пропущен',
        body: truncateText(body, NOTIFICATION_BODY_MAX_LENGTH)
    }
}

export function buildRemindersPausedNotification(plant, { consecutiveSkips = 3 } = {}) {
    const name = truncateText(plant?.name || 'Растение', NOTIFY_NAME_MAX_LENGTH)
    const body = `«${name}»: ${consecutiveSkips} авто-пропуска подряд. ` +
        'Напоминания приостановлены, чтобы не спамить. ' +
        'Полейте растение или возобновите напоминания в карточке растения.'

    return {
        title: '⏸ Напоминания приостановлены',
        body: truncateText(body, NOTIFICATION_BODY_MAX_LENGTH)
    }
}

export function isSlotNotified(metadata, key, slot) {
    const expected = slotIso(slot)
    if (!expected) return false
    const stored = metadata?.notifications?.[key]
    return typeof stored === 'string' && stored === expected
}

export function withSlotNotification(metadata, key, slot) {
    const expected = slotIso(slot)
    const next = { ...(metadata && typeof metadata === 'object' ? metadata : {}) }
    const notifications = {
        ...(next.notifications && typeof next.notifications === 'object' ? next.notifications : {})
    }
    if (expected) notifications[key] = expected
    next.notifications = notifications
    return next
}

class ReminderService {
    start() {
        cron.schedule(TICK_CRON, () => this.runReminderTick(), { timezone: 'UTC' })
        cron.schedule(TICK_CRON, () => this.runMorningSummaryTick(), { timezone: 'UTC' })
        cron.schedule(TICK_CRON, () => this.runCareAdviceTick(), { timezone: 'UTC' })
        console.log(
            '⏰ ReminderService запущен: напоминания/сводка/советы — отдельные ' +
            `${TICK_INTERVAL_MINUTES}-минутные задачи с раздельными локами Redis`
        )
        console.log('🌅 Утренняя сводка отправляется в 09:00 по часовому поясу пользователя')
    }

    async runLocked(lockName, ttlMs, label, task) {
        const startedAt = Date.now()
        try {
            const result = await withDistributedLock(lockName, { ttlMs }, task)
            if (result?.ran) {
                console.log(`⏱ ${label}: ${Date.now() - startedAt} мс`)
            }
            return result
        } catch (error) {
            console.error(`❌ ${label} упала целиком:`, error)
            return { ran: false, reason: 'error' }
        }
    }

    async runReminderTick() {
        return this.runLocked(TICK_LOCK, TICK_LOCK_TTL_MS, 'reminderTick', () =>
            this.reminderTick(new Date()))
    }

    async runMorningSummaryTick() {
        return this.runLocked(
            SUMMARY_TICK_LOCK,
            SEPARATE_TICK_LOCK_TTL_MS,
            'morningSummaryTick',
            () => this.morningSummaryTick(new Date())
        )
    }

    async runCareAdviceTick() {
        return this.runLocked(
            CARE_ADVICE_TICK_LOCK,
            SEPARATE_TICK_LOCK_TTL_MS,
            'careAdviceTick',
            () => this.careAdviceTick(new Date())
        )
    }

    async tick(now = new Date()) {
        await this.reminderTick(now)
        await this.morningSummaryTick(now)
        await this.careAdviceTick(now)
    }

    async reminderTick(now = new Date()) {
        console.log(`\n🔔 ReminderService.reminderTick() @ ${now.toISOString()}`)

        for (const [name, run] of [
            ['autoSkipOverdue', () => this.autoSkipOverdue(now)],
            ['sendDayBefore', () => this.sendDayBefore(now)],
            ['sendOnDay', () => this.sendOnDay(now)]
        ]) {
            const startedAt = Date.now()
            try {
                await run()
            } catch (error) {
                console.error(`❌ ReminderService.${name} error:`, error)
            }
            console.log(`⏱ reminderTick.${name}: ${Date.now() - startedAt} мс`)
        }
    }

    async autoSkipOverdue(now = new Date()) {
        const cutoff = new Date(now.getTime() - MISSED_GRACE_MS)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                next_watering_at: { [Op.lte]: cutoff }
            }
        })
        if (!plants.length) return

        const zonesByUser = await loadTimeZones(plants.map(plant => plant.user_id))

        for (const candidate of plants) {
            let transaction
            try {
                transaction = await Plant.sequelize.transaction()

                const plant = await Plant.findOne({
                    where: {
                        id: candidate.id,
                        is_active: true,
                        next_watering_at: { [Op.lte]: cutoff }
                    },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })
                if (!plant) {
                    await transaction.rollback()
                    transaction = null
                    continue
                }

                const timeZone = zonesByUser.get(plant.user_id) ?? DEFAULT_TIME_ZONE
                const scheduledFor = new Date(plant.next_watering_at)
                const intervalDays = intervalDaysOf(plant)

                const { missed, next } = splitMissedWaterings(
                    scheduledFor,
                    intervalDays,
                    wateringHour(plant),
                    timeZone,
                    now
                )

                if (!missed.length || !next || !Number.isFinite(next.getTime())) {
                    await transaction.rollback()
                    transaction = null
                    continue
                }

                const wasPaused = isRemindersPaused(plant.metadata)
                const metadata = registerAutoSkip(plant.metadata, { missedSince: missed[0] })
                const becamePaused = !wasPaused && metadata.reminders_paused === true

                await plant.update({
                    next_watering_at: next,
                    metadata
                }, { transaction })

                const truncated = missed.length > MAX_SKIP_LOGS_PER_TICK
                const logged = truncated
                    ? missed.slice(-MAX_SKIP_LOGS_PER_TICK)
                    : missed

                if (truncated) {
                    console.warn(
                        `⚠️ autoSkip plant#${plant.id}: ${missed.length} пропущенных слотов, ` +
                        `в watering_logs сохранены последние ${logged.length}`
                    )
                }

                for (const slot of logged) {
                    await WateringLog.create({
                        plant_id: plant.id,
                        user_id: plant.user_id,
                        action: 'skipped',
                        action_at: now,
                        scheduled_for: slot,
                        hours_late: Math.max(0, Math.round((now.getTime() - slot.getTime()) / HOUR)),
                        note: AUTO_SKIP_NOTE
                    }, { transaction })
                }

                await transaction.commit()
                transaction = null

                console.log(
                    `⏭ plant#${plant.id} «${plant.name}»: пропущено ${missed.length}, ` +
                    `слоты: ${logged.map(slot => slot.toISOString()).join(', ')}, ` +
                    `следующий полив ${next.toISOString()}`
                )

                await this.notifyAutoSkipOutcome(plant, {
                    missed,
                    timeZone,
                    wasPaused,
                    becamePaused,
                    consecutiveSkips: metadata.consecutive_skips
                })
            } catch (error) {
                if (transaction && !transaction.finished) await transaction.rollback()
                console.error(
                    `❌ autoSkipOverdue: plant#${candidate.id} — пропуск не выполнен:`,
                    error
                )
            }
        }
    }

    async notifyAutoSkipOutcome(plant, { missed, timeZone, wasPaused, becamePaused, consecutiveSkips }) {
        if (becamePaused) {
            await this.notifyRemindersPaused(plant, {
                slot: missed[0],
                consecutiveSkips
            })
            return
        }
        if (wasPaused) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: напоминания на паузе — уведомление не отправляется`)
            return
        }
        if (plant.notify_morning === false) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: notify_morning=false — уведомление не отправляется`)
            return
        }
        if (!matchesWeekdayForSlot(plant, missed[0], timeZone)) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: день недели не выбран — уведомление не отправляется`)
            return
        }
        await this.notifyAutoSkip(plant, missed)
    }

    async notifyAutoSkip(plant, missed) {
        const first = missed[0]
        const { title, body } = buildAutoSkipNotification(plant, missed.length)

        try {
            const { notification, created } = await storeNotification({
                userId: plant.user_id,
                plantId: plant.id,
                type: 'watering_due',
                title,
                body,
                dedupeKey: `plant:${plant.id}:auto_skip:${first.toISOString()}`,
                scheduledFor: first
            })
            if (!created) return
            await sendNotificationPush({
                userId: plant.user_id,
                title,
                body,
                data: { plantId: plant.id, url: '/home', tag: 'auto_skip', notificationId: notification.id }
            })
        } catch (error) {
            console.error(`❌ Не удалось отправить уведомление о пропуске plant#${plant.id}:`, error)
        }
    }

    async notifyRemindersPaused(plant, { slot, consecutiveSkips }) {
        const { title, body } = buildRemindersPausedNotification(plant, { consecutiveSkips })

        try {
            const { notification, created } = await storeNotification({
                userId: plant.user_id,
                plantId: plant.id,
                type: 'watering_due',
                title,
                body,
                dedupeKey: `plant:${plant.id}:reminders_paused:${slot.toISOString()}`,
                scheduledFor: slot
            })
            if (!created) return

            if (plant.notify_morning === false) return
            await sendNotificationPush({
                userId: plant.user_id,
                title,
                body,
                data: { plantId: plant.id, url: '/home', tag: 'reminders_paused', notificationId: notification.id }
            })
        } catch (error) {
            console.error(`❌ Не удалось отправить уведомление о паузе plant#${plant.id}:`, error)
        }
    }

    async morningSummaryTick(now = new Date()) {
        const startedAt = Date.now()
        try {
            await this.sendMorningSummary(now)
        } catch (error) {
            console.error('❌ ReminderService.sendMorningSummary error:', error)
        }
        console.log(`⏱ morningSummaryTick: ${Date.now() - startedAt} мс`)
    }

    async sendMorningSummary(now = new Date()) {
        const preferences = await NotificationPreference.findAll({
            where: { morning_summary_enabled: true }
        })
        if (!preferences.length) return

        const zonesByUser = await loadTimeZones(
            preferences.map(preference => preference.user_id)
        )

        for (const preference of preferences) {
            try {
                const timeZone = zonesByUser.get(preference.user_id) ?? DEFAULT_TIME_ZONE
                const localTime = getDateParts(now, timeZone)

                if (localTime.hour !== SUMMARY_HOUR) continue

                const { date, end } = getDayBounds(now, timeZone)
                if (preference.last_morning_summary_date === date) continue

                await this.sendMorningSummaryTo(preference, { date, end })
            } catch (error) {
                console.error(
                    `❌ Не удалось отправить утреннюю сводку пользователю ${preference.user_id}:`,
                    error
                )
            }
        }
    }

    async sendMorningSummaryTo(preference, { date, end }) {
        const missedCondition = sequelize.literal("(metadata->>'missed_since') IS NOT NULL")
        const plants = await Plant.findAll({
            where: {
                user_id: preference.user_id,
                is_active: true,
                [Op.or]: [
                    { next_watering_at: { [Op.lt]: end } },
                    missedCondition
                ]
            },
            attributes: ['id', 'name', 'location'],
            order: [['next_watering_at', 'ASC']]
        })

        const body = buildMorningSummaryBody(plants)
        const { notification, created } = await storeNotification({
            userId: preference.user_id,
            type: 'morning_summary',
            title: '🌿 Утренняя сводка',
            body,
            dedupeKey: `morning-summary:${date}`
        })

        await preference.update({ last_morning_summary_date: date })

        if (!created) return

        await sendNotificationPush({
            userId: preference.user_id,
            title: '🌿 Утренняя сводка',
            body,
            data: { url: '/home', tag: 'morning-summary', notificationId: notification.id }
        })
    }

    async careAdviceTick(now = new Date()) {
        const startedAt = Date.now()
        try {
            await this.sendCareAdvice(now)
        } catch (error) {
            console.error('❌ ReminderService.sendCareAdvice error:', error)
        }
        console.log(`⏱ careAdviceTick: ${Date.now() - startedAt} мс`)
    }

    async sendCareAdvice(now = new Date()) {
        const preferences = await NotificationPreference.findAll({
            where: { care_advice_enabled: true }
        })
        if (!preferences.length) return

        const zonesByUser = await loadTimeZones(
            preferences.map(preference => preference.user_id)
        )

        for (const preference of preferences) {
            try {
                const timeZone = zonesByUser.get(preference.user_id) ?? DEFAULT_TIME_ZONE
                const localTime = getDateParts(now, timeZone)
                if (localTime.hour < CARE_ADVICE_START_HOUR ||
                    localTime.hour >= CARE_ADVICE_END_HOUR) continue

                const date = zonedDayKeyFromParts(localTime)
                if (preference.last_care_advice_date === date) continue

                await careAdviceService.sendDailyAdvicesForUser({
                    userId: preference.user_id,
                    now,
                    timeZone
                })
            } catch (error) {
                console.error(
                    `❌ Не удалось отправить советы по уходу пользователю ${preference.user_id}:`,
                    error
                )
            }
        }
    }

    async sendDayBefore(now) {
        const from = new Date(now.getTime() + DAY_BEFORE_QUERY_FROM_MS)
        const to = new Date(now.getTime() + DAY_BEFORE_QUERY_TO_MS)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                notify_day_before: true,
                next_watering_at: { [Op.between]: [from, to] }
            }
        })
        if (!plants.length) return

        const zonesByUser = await loadTimeZones(plants.map(plant => plant.user_id))

        for (const plant of plants) {
            try {
                const timeZone = zonesByUser.get(plant.user_id) ?? DEFAULT_TIME_ZONE
                if (isRemindersPaused(plant.metadata)) continue
                if (!this.matchesWeekday(plant, timeZone)) continue

                const localHour = getDateParts(now, timeZone).hour
                if (localHour < DAY_BEFORE_START_HOUR || localHour > DAY_BEFORE_END_HOUR) continue
                if (zonedDayKey(plant.next_watering_at, timeZone) !== localTomorrowKey(now, timeZone)) continue

                const slot = new Date(plant.next_watering_at)
                if (this.alreadyNotified(plant, 'day_before', slot)) continue

                const result = await this.notify(plant, {
                    title: '🌿 Напоминание',
                    body: `Завтра полить «${truncateText(plant.name || 'Растение', NOTIFY_NAME_MAX_LENGTH)}»` +
                        `${plant.location ? ` (${truncateText(plant.location, SUMMARY_LOCATION_MAX_LENGTH)})` : ''}`,
                    tag: 'day_before',
                    type: 'watering_day_before',
                    slot
                })

                if (result.notification) {
                    await this.markNotified(plant, 'day_before', slot)
                }
            } catch (error) {
                console.error(
                    `❌ sendDayBefore: plant#${plant.id} — напоминание не отправлено:`,
                    error
                )
            }
        }
    }

    async sendOnDay(now) {

        const catchupFrom = new Date(
            now.getTime() - (MISSED_GRACE_MS + ON_DAY_CATCHUP_MARGIN_MS)
        )
        const to = new Date(now.getTime() + ON_DAY_EARLY_MS)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                notify_morning: true,
                next_watering_at: { [Op.between]: [catchupFrom, to] }
            }
        })
        if (!plants.length) return

        const zonesByUser = await loadTimeZones(plants.map(plant => plant.user_id))

        for (const plant of plants) {
            try {
                const timeZone = zonesByUser.get(plant.user_id) ?? DEFAULT_TIME_ZONE
                if (isRemindersPaused(plant.metadata)) continue
                if (!this.matchesWeekday(plant, timeZone)) continue

                const slot = new Date(plant.next_watering_at)
                if (!Number.isFinite(slot.getTime())) continue
                if (slot.getTime() > to.getTime()) continue
                const lateness = now.getTime() - slot.getTime()
                if (lateness > MISSED_GRACE_MS + ON_DAY_CATCHUP_MARGIN_MS) continue

                if (lateness > ON_DAY_LATE_MS) {
                    const localHour = getDateParts(now, timeZone).hour
                    if (localHour < DAY_BEFORE_START_HOUR || localHour > DAY_BEFORE_END_HOUR) {
                        continue
                    }
                }
                if (this.alreadyNotified(plant, 'on_day', slot)) continue

                const { title, body } = buildOnDayNotification(plant, { slot, timeZone, now })
                const result = await this.notify(plant, {
                    title,
                    body,
                    tag: 'on_day',
                    type: 'watering_due',
                    slot
                })

                if (result.notification) {
                    await this.markNotified(plant, 'on_day', slot)
                }
            } catch (error) {
                console.error(
                    `❌ sendOnDay: plant#${plant.id} — напоминание не отправлено:`,
                    error
                )
            }
        }
    }

    matchesWeekday(plant, timeZone = DEFAULT_TIME_ZONE) {
        return matchesWeekdayForSlot(plant, plant.next_watering_at, timeZone)
    }

    alreadyNotified(plant, key, slot) {
        return isSlotNotified(plant.metadata, key, slot)
    }

    async markNotified(plant, key, slot) {
        const expected = slotIso(slot)
        if (!expected) return false

        let transaction
        try {
            transaction = await Plant.sequelize.transaction()
            const fresh = await Plant.findByPk(plant.id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
                attributes: ['id', 'metadata']
            })
            if (!fresh) {
                await transaction.rollback()
                transaction = null
                return false
            }

            const metadata = withSlotNotification(fresh.metadata, key, expected)
            await fresh.update({ metadata }, { transaction })
            await transaction.commit()
            transaction = null
            return true
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error(`❌ markNotified plant#${plant.id} (${key}):`, error)
            return false
        }
    }

    async notify(plant, { title, body, tag, type, slot }) {
        const scheduledFor = slot ? new Date(slot) : new Date(plant.next_watering_at)
        const { notification, created } = await storeNotification({
            userId: plant.user_id,
            plantId: plant.id,
            type,
            title,
            body,
            url: '/home',
            dedupeKey: `plant:${plant.id}:${tag}:${scheduledFor.toISOString()}`,
            scheduledFor
        })

        if (!created) return { notification, created: false, pushResult: null }

        const pushResult = await sendNotificationPush({
            userId: plant.user_id,
            title,
            body,
            data: {
                plantId: plant.id,
                url: '/home',
                tag,
                notificationId: notification.id
            }
        })

        return { notification, created: true, pushResult }
    }
}

export default new ReminderService()
