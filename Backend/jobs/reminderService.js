import cron from 'node-cron'
import { Op } from 'sequelize'
import sequelize from '../db.js'
import Plant from '../models/Plant.js'
import pushService from '../services/pushService.js'
import WateringLog from '../models/WateringLog.js'
import NotificationPreference from '../models/NotificationPreference.js'
import { storeNotification } from '../services/notificationService.js'
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

const HOUR = 60 * 60 * 1000
const SUMMARY_HOUR = 9
const DAY_BEFORE_START_HOUR = 9
const DAY_BEFORE_END_HOUR = 21
const DAY_BEFORE_QUERY_FROM_MS = 8 * HOUR
const DAY_BEFORE_QUERY_TO_MS = 44 * HOUR
const ON_DAY_EARLY_MS = 5 * 60 * 1000
const ON_DAY_LATE_MS = 15 * 60 * 1000
const AUTO_SKIP_NOTE = 'Автоматический пропуск (просрочено > 24ч)'
const MAX_SKIP_LOGS_PER_TICK = 100
const TICK_LOCK = 'job:reminder-tick'
const TICK_INTERVAL_MINUTES = 10
const TICK_CRON = `*/${TICK_INTERVAL_MINUTES} * * * *`
const TICK_LOCK_TTL_MS = TICK_INTERVAL_MINUTES * 60 * 1000
const SUMMARY_LOCK_TTL_MS = 30 * 60 * 1000

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

function localTomorrowKey(now, timeZone) {
    return zonedDayKey(zonedDayHourAfter(now, 1, 12, timeZone), timeZone)
}

function wateringHour(plant) {
    return WATERING_TIME_OF_DAY_HOURS[plant.watering_time_of_day] ??
        WATERING_TIME_OF_DAY_HOURS.morning
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

class ReminderService {
    start() {
        cron.schedule(TICK_CRON, () => this.runTick(), {
            timezone: 'UTC'
        })
        console.log('⏰ ReminderService запущен (каждые 10 минут, распределённый лок Redis)')
        console.log('🌅 Утренняя сводка отправляется в 09:00 по часовому поясу пользователя')
    }

    async runTick() {
        await withDistributedLock(
            TICK_LOCK,
            { ttlMs: TICK_LOCK_TTL_MS },
            () => this.tick()
        )
    }

    async autoSkipOverdue(now) {
        const cutoff = new Date(now.getTime() - MISSED_GRACE_MS)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                next_watering_at: { [Op.lt]: cutoff }
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
                        next_watering_at: { [Op.lt]: cutoff }
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
                const intervalDays = Number.isInteger(plant.watering_interval_days) &&
                    plant.watering_interval_days > 0
                    ? plant.watering_interval_days
                    : 7
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

                await plant.update({
                    next_watering_at: next,
                    metadata
                }, { transaction })

                const logged = missed.length > MAX_SKIP_LOGS_PER_TICK
                    ? missed.slice(-MAX_SKIP_LOGS_PER_TICK)
                    : missed

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

                if (!wasPaused) {
                    await this.notifyAutoSkip(plant, missed)
                }
            } catch (error) {
                if (transaction && !transaction.finished) await transaction.rollback()
                console.error(
                    `❌ autoSkipOverdue: plant#${candidate.id} — пропуск не выполнен:`,
                    error
                )
            }
        }
    }

    async notifyAutoSkip(plant, missed) {
        const first = missed[0]
        const body = missed.length === 1
            ? `«${plant.name}»: полив пропущен. Растение всё ещё ждёт воды.`
            : `«${plant.name}»: пропущено ${missed.length} поливов. Растение всё ещё ждёт воды.`

        try {
            const { notification } = await storeNotification({
                userId: plant.user_id,
                plantId: plant.id,
                type: 'watering_due',
                title: '💧 Полив пропущен',
                body,
                dedupeKey: `plant:${plant.id}:auto_skip:${first.toISOString()}`,
                scheduledFor: first
            })
            await pushService.sendToUser(
                plant.user_id,
                '💧 Полив пропущен',
                body,
                '/icons/icon-192.png',
                { plantId: plant.id, url: '/home', tag: 'auto_skip', notificationId: notification.id }
            )
        } catch (error) {
            console.error(`❌ Не удалось отправить уведомление о пропуске plant#${plant.id}:`, error)
        }
    }

    async tick() {
        const now = new Date()
        console.log(`\n🔔 ReminderService.tick() @ ${now.toISOString()}`)

        for (const [name, run] of [
            ['autoSkipOverdue', () => this.autoSkipOverdue(now)],
            ['sendMorningSummary', () => this.sendMorningSummary(now)],
            ['sendDayBefore', () => this.sendDayBefore(now)],
            ['sendOnDay', () => this.sendOnDay(now)]
        ]) {
            try {
                await run()
            } catch (error) {
                console.error(`❌ ReminderService.${name} error:`, error)
            }
        }
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
            const timeZone = zonesByUser.get(preference.user_id) ?? DEFAULT_TIME_ZONE
            const localTime = getDateParts(now, timeZone)

            if (localTime.hour !== SUMMARY_HOUR) continue

            const { date, end } = getDayBounds(now, timeZone)
            if (preference.last_morning_summary_date === date) continue

            await withDistributedLock(
                `job:morning-summary:${preference.user_id}:${date}`,
                { ttlMs: SUMMARY_LOCK_TTL_MS },
                () => this.sendMorningSummaryTo(preference, { date, end })
            )
        }
    }

    async sendMorningSummaryTo(preference, { date, end }) {
        try {
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
            const names = plants.slice(0, 5).map(plant =>
                `${plant.name}${plant.location ? ` (${plant.location})` : ''}`
            )
            const extraCount = plants.length - names.length
            const body = plants.length
                ? `Сегодня полить: ${names.join(', ')}${extraCount > 0 ? ` и ещё ${extraCount}` : ''}`
                : 'На сегодня полив не запланирован 🌱'
            const { notification } = await storeNotification({
                userId: preference.user_id,
                type: 'morning_summary',
                title: '🌿 Утренняя сводка',
                body,
                dedupeKey: `morning-summary:${date}`
            })
            const result = await pushService.sendToUser(
                preference.user_id,
                '🌿 Утренняя сводка',
                body,
                '/icons/icon-192.png',
                { url: '/home', tag: 'morning-summary', notificationId: notification.id }
            )

            if (result.sent > 0) {
                await preference.update({ last_morning_summary_date: date })
            }
        } catch (error) {
            console.error(
                `❌ Не удалось отправить утреннюю сводку пользователю ${preference.user_id}:`,
                error
            )
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
                if (this.alreadyNotified(plant, 'day_before', now)) continue

                const result = await this.notify(plant, {
                    title: '🌿 Напоминание',
                    body: `Завтра полить «${plant.name}»${plant.location ? ` (${plant.location})` : ''}`,
                    tag: 'day_before',
                    type: 'watering_day_before'
                })

                if (result.sent > 0) {
                    await this.markNotified(plant, 'day_before', now)
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
        const from = new Date(now.getTime() - ON_DAY_LATE_MS)
        const to = new Date(now.getTime() + ON_DAY_EARLY_MS)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                notify_morning: true,
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
                if (this.alreadyNotified(plant, 'on_day', now)) continue

                const result = await this.notify(plant, {
                    title: '💧 Пора полить!',
                    body: `${plant.name}${plant.location ? ` (${plant.location})` : ''} ждёт воды`,
                    tag: 'on_day',
                    type: 'watering_due'
                })

                if (result.sent > 0) {
                    await this.markNotified(plant, 'on_day', now)
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
        if (!weekdayRestrictionApplies(plant.watering_interval_days)) return true

        return isReminderWeekday(plant.reminder_weekdays, plant.next_watering_at, timeZone)
    }

    alreadyNotified(plant, key, now) {
        const flag = plant.metadata?.notifications?.[key]
        if (!flag) return false
        return now.getTime() - new Date(flag).getTime() < 24 * HOUR
    }

    async markNotified(plant, key, now) {
        const metadata = {
            ...(plant.metadata || {}),
            notifications: {
                ...(plant.metadata?.notifications || {}),
                [key]: now.toISOString()
            }
        }
        await plant.update({ metadata })
    }

    async notify(plant, { title, body, tag, type }) {
        const scheduledFor = new Date(plant.next_watering_at)
        const { notification } = await storeNotification({
            userId: plant.user_id,
            plantId: plant.id,
            type,
            title,
            body,
            url: '/home',
            dedupeKey: `plant:${plant.id}:${tag}:${scheduledFor.toISOString()}`,
            scheduledFor
        })

        return pushService.sendToUser(
            plant.user_id,
            title,
            body,
            '/icons/icon-192.png',
            {
                plantId: plant.id,
                url: '/home',
                tag,
                notificationId: notification.id
            }
        )
    }
}

export default new ReminderService()
