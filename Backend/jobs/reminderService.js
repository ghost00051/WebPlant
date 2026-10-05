import cron from 'node-cron'
import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import pushService from '../services/pushService.js'
import WateringLog from '../models/WateringLog.js'
import { isReminderWeekday } from '../utils/wateringSchedule.js'

const HOUR = 60 * 60 * 1000

class ReminderService {
    start() {
        cron.schedule('*/10 * * * *', () => this.tick(), {
            timezone: 'UTC'
        })
        console.log('⏰ ReminderService запущен (каждые 10 минут)')
    }

    async autoSkipOverdue(now) {
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                next_watering_at: { [Op.lt]: cutoff }
            }
        })

        for (const candidate of plants) {
            const transaction = await Plant.sequelize.transaction()
            let plant
            let hoursLate
            let nextWatering
            try {
                plant = await Plant.findOne({
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
                    continue
                }

                const scheduledFor = new Date(plant.next_watering_at)
                hoursLate = Math.round(
                    (now - scheduledFor) / (60 * 60 * 1000)
                )

                const intervalDays = Number.isInteger(plant.watering_interval_days) &&
                    plant.watering_interval_days > 0
                    ? plant.watering_interval_days
                    : 7
                const intervalMs = intervalDays * 24 * HOUR
                const periodsToAdvance = Math.floor((now - scheduledFor) / intervalMs) + 1
                nextWatering = new Date(
                    scheduledFor.getTime() + periodsToAdvance * intervalMs
                )

                await plant.update({
                    next_watering_at: nextWatering,
                    metadata: {
                        ...(plant.metadata || {}),
                        notifications: {}
                    }
                }, { transaction })

                await WateringLog.create({
                    plant_id: plant.id,
                    user_id: plant.user_id,
                    action: 'skipped',
                    action_at: now,
                    scheduled_for: scheduledFor,
                    hours_late: hoursLate,
                    note: 'Автоматический пропуск (просрочено > 24ч)'
                }, { transaction })
                await transaction.commit()
            } catch (error) {
                if (!transaction.finished) await transaction.rollback()
                throw error
            }

            console.log(
                `⏭ plant#${plant.id} «${plant.name}»: пропущен ` +
                `(просрочен на ${hoursLate}ч), сдвинут на ${nextWatering.toISOString()}`
            )
        }
    }

    async tick() {
        const now = new Date()
        console.log(`\n🔔 ReminderService.tick() @ ${now.toISOString()}`)

        try {
            await this.autoSkipOverdue(now)  
            await this.sendDayBefore(now)
            await this.sendOnDay(now)
        } catch (e) {
            console.error('❌ ReminderService.tick error:', e)
        }
    }

    async sendDayBefore(now) {
        const from = new Date(now.getTime() + 20 * HOUR)
        const to = new Date(now.getTime() + 28 * HOUR)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                notify_day_before: true,
                next_watering_at: { [Op.between]: [from, to] }
            }
        })

        for (const plant of plants) {
            if (!this.matchesWeekday(plant)) continue
            if (this.alreadyNotified(plant, 'day_before', now)) continue

            const result = await this.notify(plant, {
                title: '🌿 Напоминание',
                body: `Завтра полить «${plant.name}»${plant.location ? ` (${plant.location})` : ''}`,
                tag: 'day_before'
            })

            if (result.sent > 0) {
                await this.markNotified(plant, 'day_before', now)
            }
        }
    }

    async sendOnDay(now) {
        const from = new Date(now.getTime() - 5 * 60 * 1000)
        const to = new Date(now.getTime() + 15 * 60 * 1000)

        const plants = await Plant.findAll({
            where: {
                is_active: true,
                notify_morning: true,
                next_watering_at: { [Op.between]: [from, to] }
            }
        })

        for (const plant of plants) {
            if (!this.matchesWeekday(plant)) continue
            if (this.alreadyNotified(plant, 'on_day', now)) continue

            const result = await this.notify(plant, {
                title: '💧 Пора полить!',
                body: `${plant.name}${plant.location ? ` (${plant.location})` : ''} ждёт воды`,
                tag: 'on_day'
            })

            if (result.sent > 0) {
                await this.markNotified(plant, 'on_day', now)
            }
        }
    }

    matchesWeekday(plant) {
        return isReminderWeekday(plant.reminder_weekdays, plant.next_watering_at)
    }

    alreadyNotified(plant, key, now) {
        const flag = plant.metadata?.notifications?.[key]
        if (!flag) return false
        return Date.now() - new Date(flag).getTime() < 24 * HOUR
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

    async notify(plant, { title, body, tag }) {
        return pushService.sendToUser(
            plant.user_id,
            title,
            body,
            '/icon-192.v2.png',
            { plantId: plant.id, url: '/home', tag }
        )
        console.log(`  → plant#${plant.id} «${plant.name}»: sent=${result.sent} failed=${result.failed}`)
    }
}

export default new ReminderService()