import cron from 'node-cron'
import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import pushService from '../services/pushService.js'
import WateringLog from '../models/WateringLog.js'

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

        for (const plant of plants) {
            const scheduledFor = new Date(plant.next_watering_at)
            const hoursLate = Math.round(
                (now - scheduledFor) / (60 * 60 * 1000)
            )

            const nextWatering = new Date(scheduledFor)
            nextWatering.setDate(nextWatering.getDate() + 1)

            while (nextWatering <= now) {
                nextWatering.setDate(nextWatering.getDate() + 1)
            }

            await plant.update({
                next_watering_at: nextWatering,
                metadata: {
                    ...(plant.metadata || {}),
                    notifications: {}
                }
            })

            await WateringLog.create({
                plant_id: plant.id,
                user_id: plant.user_id,
                action: 'skipped',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: hoursLate,
                note: 'Автоматический пропуск (просрочено > 24ч)'
            })

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
            if (!this.matchesWeekday(plant, now)) continue
            if (this.alreadyNotified(plant, 'day_before', now)) continue

            await this.notify(plant, {
                title: '🌿 Напоминание',
                body: `Завтра полить «${plant.name}»${plant.location ? ` (${plant.location})` : ''}`,
                tag: 'day_before'
            })

            await this.markNotified(plant, 'day_before', now)
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
            if (!this.matchesWeekday(plant, now)) continue
            if (this.alreadyNotified(plant, 'on_day', now)) continue

            await this.notify(plant, {
                title: '💧 Пора полить!',
                body: `${plant.name}${plant.location ? ` (${plant.location})` : ''} ждёт воды`,
                tag: 'on_day'
            })

            await this.markNotified(plant, 'on_day', now)
        }
    }

    matchesWeekday(plant, now) {
        const days = plant.reminder_weekdays
        if (!Array.isArray(days) || days.length === 0) return true
        return days.includes(now.getDay()) // 0=вс
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
        const result = await pushService.sendToUser(
            plant.user_id,
            title,
            body,
            '/icons/plant-192.png',
            { plantId: plant.id, url: `/plants/${plant.id}`, tag }
        )
        console.log(`  → plant#${plant.id} «${plant.name}»: sent=${result.sent} failed=${result.failed}`)
    }
}

export default new ReminderService()