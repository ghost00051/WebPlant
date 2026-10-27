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
import { isRemindersPaused, markWateringMissed, registerAutoSkip } from '../utils/plantMetadata.js'
import {
    MISSED_ACTION,
    MISSED_POLICY,
    buildMissedWateringNotification,
    planMissedWateringHandling,
    resolveMissedPolicy
} from '../utils/missedWatering.js'
import { readPrediction } from '../utils/wateringPrediction.js'
import {
    forEachInChunks,
    iterateActiveDuePlants,
    iterateBatchesById,
    readReminderBatchConfig,
    readReminderPushConcurrency
} from '../utils/plantBatching.js'
import { recordReminderTick } from '../utils/reminderTickMetrics.js'
import {
    DELIVERY_MODE,
    isQuietTime,
    quietHoursFromPreference,
    resolveDeliveryMode,
    resolveDigestHour
} from '../utils/quietHours.js'

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
        const tickStartedAt = new Date()
        console.log(`\n🔔 ReminderService.reminderTick() @ ${now.toISOString()}`)

        const totals = this.createTickCounters()

        for (const [name, run] of [
            ['autoSkipOverdue', () => this.autoSkipOverdue(now)],
            ['sendDayBefore', () => this.sendDayBefore(now)],
            ['sendOnDay', () => this.sendOnDay(now)]
        ]) {
            const startedAt = Date.now()
            try {
                const result = await run()
                totals.batches += Number(result?.batches) || 0
                totals.plantsProcessed += Number(result?.plantsProcessed) || 0
                totals.notificationsCreated += Number(result?.notificationsCreated) || 0
                totals.errors += Number(result?.errors) || 0
            } catch (error) {
                totals.errors += 1
                console.error(`❌ ReminderService.${name} error:`, error)
            }
            console.log(`⏱ reminderTick.${name}: ${Date.now() - startedAt} мс`)
        }

        const metric = recordReminderTick({
            startedAt: tickStartedAt.toISOString(),
            durationMs: Date.now() - tickStartedAt.getTime(),
            batches: totals.batches,
            plantsProcessed: totals.plantsProcessed,
            notificationsCreated: totals.notificationsCreated,
            errors: totals.errors
        })
        console.info('[reminder-tick]', JSON.stringify(metric))
    }

    createTickCounters() {
        return {
            batches: 0,
            plantsProcessed: 0,
            notificationsCreated: 0,
            errors: 0
        }
    }

    applyBatchOutcome(counters, outcome, label) {
        if (!outcome) return counters
        counters.batches = Number(outcome.batches) || 0
        counters.plantsProcessed = Number(outcome.plantsProcessed) || 0
        if (outcome.truncated) {
            console.warn(
                `⚠️ ${label}: тик упёрся в REMINDER_TICK_MAX_BATCHES — ` +
                'остальные растения будут обработаны следующим тиком'
            )
        }
        return counters
    }

    async processPlantsConcurrently(plants, { failureLabel, failureText, counters, worker }) {
        const concurrency = readReminderPushConcurrency()
        const settled = await forEachInChunks(plants, concurrency, async plant => {
            try {
                const notificationCreated = await worker(plant)
                if (notificationCreated) counters.notificationsCreated += 1
            } catch (error) {
                counters.errors += 1
                console.error(`❌ ${failureLabel}: plant#${plant?.id} — ${failureText}:`, error)
            }
        })

        for (const result of settled) {
            if (result.status === 'rejected') {
                counters.errors += 1
                console.error(
                    `❌ ${failureLabel}: непредвиденная ошибка обработки растения:`,
                    result.reason
                )
            }
        }
    }

    async autoSkipOverdue(now = new Date()) {
        const cutoff = new Date(now.getTime() - MISSED_GRACE_MS)
        const counters = this.createTickCounters()
        const { batchSize, maxBatches } = readReminderBatchConfig()
        const missedPolicy = resolveMissedPolicy()

        const outcome = await iterateActiveDuePlants({
            model: Plant,
            where: {
                is_active: true,
                next_watering_at: { [Op.lte]: cutoff }
            },
            batchSize,
            maxBatches,
            onBatch: async candidates => {
                const settingsByUser = await this.loadRecipientSettings(
                    candidates.map(plant => plant.user_id)
                )
                await this.processPlantsConcurrently(candidates, {
                    failureLabel: 'autoSkipOverdue',
                    failureText: 'пропуск не выполнен',
                    counters,
                    worker: candidate => this.handleOverduePlant(candidate, {
                        now,
                        cutoff,
                        settingsByUser,
                        missedPolicy
                    })
                })
            }
        })

        if (missedPolicy === MISSED_POLICY.PRESERVE) {
            console.log(
                '💧 REMINDER_MISSED_POLICY=preserve: пропуски не сдвигают план, ' +
                'растение ждёт решения пользователя (полил позже / пропустить)'
            )
        }

        return this.applyBatchOutcome(counters, outcome, 'autoSkipOverdue')
    }

    async handleOverduePlant(candidate, { now, cutoff, settingsByUser, missedPolicy }) {
        if (missedPolicy === MISSED_POLICY.AUTO_SKIP) {
            return this.autoSkipPlant(candidate, { now, cutoff, settingsByUser })
        }
        return this.preserveMissedPlant(candidate, { now, cutoff, settingsByUser })
    }

    async preserveMissedPlant(candidate, { now, cutoff, settingsByUser }) {
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
                return false
            }

            const settings = this.deliverySettingsFor(settingsByUser, plant.user_id)
            const timeZone = settings.timeZone
            const plan = planMissedWateringHandling({
                policy: MISSED_POLICY.PRESERVE,
                plant,
                now,
                timeZone
            })

            if (plan.action !== MISSED_ACTION.MARK_MISSED) {
                await transaction.rollback()
                transaction = null
                return false
            }

            const metadata = markWateringMissed(plant.metadata, plan.missedSince)
            await plant.update({ metadata }, { transaction })
            await transaction.commit()
            transaction = null

            console.log(
                `💧 plant#${plant.id} «${plant.name}»: пропуск сохранён ` +
                `(слот ${plan.missedSince.toISOString()}), план не сдвинут — ждём решения пользователя`
            )

            return await this.notifyPreservedMiss(plant, {
                missed: plan.missed,
                timeZone,
                now,
                settings
            })
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            throw error
        }
    }

    async notifyPreservedMiss(plant, { missed, timeZone, now = new Date(), settings }) {
        if (isRemindersPaused(plant.metadata)) {
            console.log(
                `ℹ️ preserveMissed plant#${plant.id}: напоминания на паузе — уведомление не отправляется`
            )
            return false
        }
        if (plant.notify_morning === false) {
            console.log(
                `ℹ️ preserveMissed plant#${plant.id}: notify_morning=false — уведомление не отправляется`
            )
            return false
        }
        const first = missed[0]
        if (!matchesWeekdayForSlot(plant, first, timeZone)) {
            console.log(
                `ℹ️ preserveMissed plant#${plant.id}: день недели не выбран — уведомление не отправляется`
            )
            return false
        }

        const { title, body } = buildMissedWateringNotification(plant, {
            missedSince: first,
            timeZone,
            now
        })

        try {
            const { notification, created } = await storeNotification({
                userId: plant.user_id,
                plantId: plant.id,
                type: 'watering_due',
                title,
                body,
                dedupeKey: `plant:${plant.id}:missed:${first.toISOString()}`,
                scheduledFor: first
            })
            if (!created) return false

            if (this.shouldSkipPush(settings, now)) {
                console.log(
                    `🌙 preserveMissed plant#${plant.id}: тихие часы — уведомление сохранено в приложении без push`
                )
                return true
            }

            await sendNotificationPush({
                userId: plant.user_id,
                title,
                body,
                data: {
                    plantId: plant.id,
                    url: '/home',
                    tag: 'missed_watering',
                    notificationId: notification.id
                }
            })
            return true
        } catch (error) {
            console.error(
                `❌ Не удалось отправить уведомление о сохранённом пропуске plant#${plant.id}:`,
                error
            )
            return false
        }
    }

    async autoSkipPlant(candidate, { now, cutoff, settingsByUser }) {
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
                return false
            }

            const settings = this.deliverySettingsFor(settingsByUser, plant.user_id)
            const timeZone = settings.timeZone
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
                return false
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

            return await this.notifyAutoSkipOutcome(plant, {
                missed,
                timeZone,
                now,
                settings,
                wasPaused,
                becamePaused,
                consecutiveSkips: metadata.consecutive_skips
            })
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            throw error
        }
    }

    async notifyAutoSkipOutcome(plant, {
        missed,
        timeZone,
        wasPaused,
        becamePaused,
        consecutiveSkips,
        now = new Date(),
        settings
    }) {
        if (becamePaused) {
            return this.notifyRemindersPaused(plant, {
                slot: missed[0],
                consecutiveSkips,
                now,
                settings
            })
        }
        if (wasPaused) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: напоминания на паузе — уведомление не отправляется`)
            return false
        }
        if (plant.notify_morning === false) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: notify_morning=false — уведомление не отправляется`)
            return false
        }
        if (!matchesWeekdayForSlot(plant, missed[0], timeZone)) {
            console.log(`ℹ️ autoSkip plant#${plant.id}: день недели не выбран — уведомление не отправляется`)
            return false
        }
        return this.notifyAutoSkip(plant, missed, { now, settings })
    }

    async notifyAutoSkip(plant, missed, { now = new Date(), settings } = {}) {
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
            if (!created) return false
            if (this.shouldSkipPush(settings, now)) {
                console.log(
                    `🌙 autoSkip plant#${plant.id}: тихие часы — уведомление сохранено в приложении без push`
                )
                return true
            }
            await sendNotificationPush({
                userId: plant.user_id,
                title,
                body,
                data: { plantId: plant.id, url: '/home', tag: 'auto_skip', notificationId: notification.id }
            })
            return true
        } catch (error) {
            console.error(`❌ Не удалось отправить уведомление о пропуске plant#${plant.id}:`, error)
            return false
        }
    }

    async notifyRemindersPaused(plant, { slot, consecutiveSkips, now = new Date(), settings }) {
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
            if (!created) return false

            if (plant.notify_morning === false) return true
            if (this.shouldSkipPush(settings, now)) {
                console.log(
                    `🌙 remindersPaused plant#${plant.id}: тихие часы — уведомление сохранено в приложении без push`
                )
                return true
            }
            await sendNotificationPush({
                userId: plant.user_id,
                title,
                body,
                data: { plantId: plant.id, url: '/home', tag: 'reminders_paused', notificationId: notification.id }
            })
            return true
        } catch (error) {
            console.error(`❌ Не удалось отправить уведомление о паузе plant#${plant.id}:`, error)
            return false
        }
    }

    async loadRecipientSettings(userIds) {
        const ids = [...new Set((userIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
        if (!ids.length) return new Map()

        const zones = await loadTimeZones(ids)
        const result = new Map()
        for (const id of ids) {
            result.set(id, {
                timeZone: zones.get(id) ?? DEFAULT_TIME_ZONE,
                deliveryMode: DELIVERY_MODE.PER_PLANT,
                quietHours: quietHoursFromPreference({})
            })
        }

        try {
            const preferences = await NotificationPreference.findAll({
                where: { user_id: { [Op.in]: ids } },
                attributes: [
                    'user_id',
                    'delivery_mode',
                    'quiet_hours_enabled',
                    'quiet_hours_start',
                    'quiet_hours_end'
                ],
                raw: true
            })
            for (const preference of Array.isArray(preferences) ? preferences : []) {
                const entry = result.get(Number(preference.user_id))
                if (!entry) continue
                entry.deliveryMode = resolveDeliveryMode(preference.delivery_mode)
                entry.quietHours = quietHoursFromPreference(preference)
            }
        } catch (error) {
            console.warn(
                '⚠️ reminderService: настройки доставки недоступны, работаем без тихих часов:',
                error?.message || error
            )
        }

        return result
    }

    deliverySettingsFor(settingsByUser, userId) {
        return settingsByUser?.get?.(userId) ?? {
            timeZone: DEFAULT_TIME_ZONE,
            deliveryMode: DELIVERY_MODE.PER_PLANT,
            quietHours: quietHoursFromPreference({})
        }
    }

    shouldSkipPush(settings, now = new Date()) {
        return isQuietTime({
            now,
            timeZone: settings?.timeZone ?? DEFAULT_TIME_ZONE,
            quietHours: settings?.quietHours
        })
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
        const { batchSize, maxBatches } = readReminderBatchConfig()

        const outcome = await iterateBatchesById({
            model: NotificationPreference,
            idColumn: 'user_id',
            where: {
                [Op.or]: [
                    { morning_summary_enabled: true },
                    { delivery_mode: DELIVERY_MODE.DIGEST }
                ]
            },
            batchSize,
            maxBatches,
            onBatch: async preferences => {
                const zonesByUser = await loadTimeZones(
                    preferences.map(preference => preference.user_id)
                )

                for (const preference of preferences) {
                    try {
                        const timeZone = zonesByUser.get(preference.user_id) ?? DEFAULT_TIME_ZONE
                        const localTime = getDateParts(now, timeZone)
                        const quietHours = quietHoursFromPreference(preference)
                        const digestHour = resolveDigestHour({
                            digestHour: SUMMARY_HOUR,
                            quietHours
                        })

                        if (localTime.hour !== digestHour) continue
                        if (isQuietTime({ now, timeZone, quietHours })) continue

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
        })

        if (outcome.truncated) {
            console.warn(
                '⚠️ sendMorningSummary: тик упёрся в REMINDER_TICK_MAX_BATCHES — ' +
                'часть пользователей будет обработана следующим тиком'
            )
        }

        return outcome
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
        const counters = this.createTickCounters()
        const { batchSize, maxBatches } = readReminderBatchConfig()

        const outcome = await iterateActiveDuePlants({
            model: Plant,
            where: {
                is_active: true,
                notify_day_before: true,
                next_watering_at: { [Op.between]: [from, to] }
            },
            batchSize,
            maxBatches,
            onBatch: async plants => {
                const settingsByUser = await this.loadRecipientSettings(
                    plants.map(plant => plant.user_id)
                )
                await this.processPlantsConcurrently(plants, {
                    failureLabel: 'sendDayBefore',
                    failureText: 'напоминание не отправлено',
                    counters,
                    worker: plant => this.sendDayBeforeTo(plant, { now, settingsByUser })
                })
            }
        })

        return this.applyBatchOutcome(counters, outcome, 'sendDayBefore')
    }

    async sendDayBeforeTo(plant, { now, settingsByUser }) {
        const settings = this.deliverySettingsFor(settingsByUser, plant.user_id)
        const timeZone = settings.timeZone
        if (isRemindersPaused(plant.metadata)) return false
        if (!this.matchesWeekday(plant, timeZone)) return false
        if (settings.deliveryMode === DELIVERY_MODE.DIGEST) {
            console.log(`📬 sendDayBefore plant#${plant.id}: режим digest — напоминание войдёт в сводку`)
            return false
        }

        const localHour = getDateParts(now, timeZone).hour
        if (localHour < DAY_BEFORE_START_HOUR || localHour > DAY_BEFORE_END_HOUR) return false
        if (zonedDayKey(plant.next_watering_at, timeZone) !== localTomorrowKey(now, timeZone)) return false

        const slot = new Date(plant.next_watering_at)
        if (this.alreadyNotified(plant, 'day_before', slot)) return false

        const result = await this.notify(plant, {
            title: '🌿 Напоминание',
            body: `Завтра полить «${truncateText(plant.name || 'Растение', NOTIFY_NAME_MAX_LENGTH)}»` +
                `${plant.location ? ` (${truncateText(plant.location, SUMMARY_LOCATION_MAX_LENGTH)})` : ''}`,
            tag: 'day_before',
            type: 'watering_day_before',
            slot,
            skipPush: this.shouldSkipPush(settings, now)
        })

        if (result.notification) {
            await this.markNotified(plant, 'day_before', slot)
        }
        return Boolean(result.created)
    }

    async sendOnDay(now) {
        const catchupFrom = new Date(
            now.getTime() - (MISSED_GRACE_MS + ON_DAY_CATCHUP_MARGIN_MS)
        )
        const to = new Date(now.getTime() + ON_DAY_EARLY_MS)
        const counters = this.createTickCounters()
        const { batchSize, maxBatches } = readReminderBatchConfig()

        const outcome = await iterateActiveDuePlants({
            model: Plant,
            where: {
                is_active: true,
                notify_morning: true,
                next_watering_at: { [Op.between]: [catchupFrom, to] }
            },
            batchSize,
            maxBatches,
            onBatch: async plants => {
                const settingsByUser = await this.loadRecipientSettings(
                    plants.map(plant => plant.user_id)
                )
                await this.processPlantsConcurrently(plants, {
                    failureLabel: 'sendOnDay',
                    failureText: 'напоминание не отправлено',
                    counters,
                    worker: plant => this.sendOnDayTo(plant, { now, to, settingsByUser })
                })
            }
        })

        return this.applyBatchOutcome(counters, outcome, 'sendOnDay')
    }

    async sendOnDayTo(plant, { now, to, settingsByUser }) {
        const settings = this.deliverySettingsFor(settingsByUser, plant.user_id)
        const timeZone = settings.timeZone
        if (isRemindersPaused(plant.metadata)) return false
        if (!this.matchesWeekday(plant, timeZone)) return false
        if (settings.deliveryMode === DELIVERY_MODE.DIGEST) {
            console.log(`📬 sendOnDay plant#${plant.id}: режим digest — напоминание войдёт в сводку`)
            return false
        }

        const slot = new Date(plant.next_watering_at)
        if (!Number.isFinite(slot.getTime())) return false
        if (slot.getTime() > to.getTime()) return false
        const lateness = now.getTime() - slot.getTime()
        if (lateness > MISSED_GRACE_MS + ON_DAY_CATCHUP_MARGIN_MS) return false

        if (lateness > ON_DAY_LATE_MS) {
            const localHour = getDateParts(now, timeZone).hour
            if (localHour < DAY_BEFORE_START_HOUR || localHour > DAY_BEFORE_END_HOUR) {
                return false
            }
        }
        if (this.alreadyNotified(plant, 'on_day', slot)) return false

        const { title, body } = buildOnDayNotification(plant, { slot, timeZone, now })
        const result = await this.notify(plant, {
            title,
            body,
            tag: 'on_day',
            type: 'watering_due',
            slot,
            skipPush: this.shouldSkipPush(settings, now)
        })

        if (result.notification) {
            await this.markNotified(plant, 'on_day', slot)
        }
        return Boolean(result.created)
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

    async notify(plant, { title, body, tag, type, slot, skipPush = false }) {
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

        if (skipPush) {
            console.log(
                `🌙 notify plant#${plant.id} (${tag}): тихие часы — push пропущен, уведомление в приложении`
            )
            return { notification, created: true, pushResult: null }
        }

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
