import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import WateringLog from '../models/WateringLog.js'
import sequelize from '../db.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
const TIME_OF_DAY_HOURS = { morning: 8, day: 14, evening: 19 }

function computeHoursLate(scheduledFor, actionAt) {
    if (!scheduledFor) return null
    const diff = (new Date(actionAt) - new Date(scheduledFor)) / (60 * 60 * 1000)
    return Math.round(diff)
}

function computeNextWatering(from, days, timeOfDay = 'morning') {
    const d = new Date(from)
    d.setDate(d.getDate() + days)
    d.setHours(TIME_OF_DAY_HOURS[timeOfDay] ?? 8, 0, 0, 0)
    return d
}

function getUserId(req) {
    const token = req.cookies.token
    if (!token) return null
    try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY)
        return decoded.id
    } catch (e) {
        return null
    }
}

class PlantController {
    async getAll(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) {
                return res.status(401).json({ message: 'Не авторизован' })
            }

            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                include: [{ model: PlantPhoto, as: 'photos' }],
                order: [
                    ['created_at', 'DESC'],
                    [{ model: PlantPhoto, as: 'photos' }, 'sort_order', 'ASC']
                ]
            })

            return res.json(plants)
        } catch (error) {
            console.error('❌ Ошибка получения растений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getSchedule(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const now = new Date()
            const plants = await Plant.findAll({
                where: {
                    user_id: userId,
                    is_active: true
                },
                order: [['next_watering_at', 'ASC']]
            })

            const groups = {}
            const today = new Date(now)
            today.setHours(0, 0, 0, 0)

            for (const p of plants) {
                if (!p.next_watering_at) continue

                const dt = new Date(p.next_watering_at)
                const dateKey = dt.toISOString().slice(0, 10)

                let bucket
                if (dt < today) bucket = 'overdue'
                else if (dt.toDateString() === now.toDateString()) bucket = 'today'
                else bucket = 'later'

                if (!groups[dateKey]) {
                    groups[dateKey] = { date: dateKey, bucket, plants: [] }
                }

                groups[dateKey].plants.push({
                    id: p.id,
                    name: p.name,
                    location: p.location,
                    photo_url: p.photo_url,
                    next_watering_at: p.next_watering_at,
                    watering_interval_days: p.watering_interval_days,
                    watering_time_of_day: p.watering_time_of_day
                })
            }

            const items = Object.values(groups).sort(
                (a, b) => new Date(a.date) - new Date(b.date)
            )

            return res.json({
                generatedAt: now.toISOString(),
                summary: {
                    overdue: items.filter(i => i.bucket === 'overdue').reduce((s, i) => s + i.plants.length, 0),
                    today: items.filter(i => i.bucket === 'today').reduce((s, i) => s + i.plants.length, 0),
                    total: plants.length
                },
                items
            })
        } catch (error) {
            console.error('❌ Ошибка schedule:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getOne(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                include: [{ model: PlantPhoto, as: 'photos' }],
                order: [
                    ['created_at', 'DESC'],
                    [{ model: PlantPhoto, as: 'photos' }, 'sort_order', 'ASC']
                ]
            })

            if (!plant) {
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getNeedWatering(req, res) {
        const userId = getUserId(req)
        if (!userId) return res.status(401).json({ message: 'Не авторизован' })

        const now = new Date()
        const plants = await Plant.findAll({
            where: {
                user_id: userId,
                is_active: true,
                next_watering_at: { [Op.lte]: now }
            },
            order: [['next_watering_at', 'ASC']]
        })

        return res.json(plants)
    }

    async create(req, res) {
        const t = await sequelize.transaction()
        try {
            const userId = getUserId(req)
            if (!userId) {
                await t.rollback()
                return res.status(401).json({ message: 'Не авторизован' })
            }

            const {
                name, species, location, description,
                watering_interval_days, metadata,
                photos = []
            } = req.body

            if (!name) {
                await t.rollback()
                return res.status(400).json({ message: 'Название обязательно' })
            }

            const plant = await Plant.create({
                user_id: userId,
                name, species, location, description,
                watering_interval_days: watering_interval_days || 7,
                watering_time_of_day: req.body.watering_time_of_day || 'morning',
                next_watering_at: computeNextWatering(
                    new Date(),
                    watering_interval_days || 7,
                    req.body.watering_time_of_day || 'morning'
                ),
                metadata: metadata || {}
            }, { transaction: t })

            if (Array.isArray(photos) && photos.length) {
                const rows = photos.map((p, i) => {
                    const url = typeof p === 'string' ? p : p.url
                    return {
                        plant_id: plant.id,
                        url,
                        sort_order: typeof p === 'object' && p.sort_order != null ? p.sort_order : i,
                        is_main: typeof p === 'object' ? !!p.is_main : i === 0,
                        metadata: typeof p === 'object' && p.metadata ? p.metadata : {}
                    }
                }).filter(r => r.url)

                await PlantPhoto.bulkCreate(rows, { transaction: t })
            }

            await t.commit()

            const result = await Plant.findByPk(plant.id, {
                include: [{ model: PlantPhoto, as: 'photos' }]
            })

            return res.status(201).json(result)
        } catch (error) {
            await t.rollback()
            console.error('❌ Ошибка создания растения:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async addPhotos(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const { photos = [] } = req.body
            if (!Array.isArray(photos) || !photos.length) {
                return res.status(400).json({ message: 'photos должен быть непустым массивом' })
            }

            if (photos.some(p => typeof p === 'object' && p.is_main)) {
                await PlantPhoto.update(
                    { is_main: false },
                    { where: { plant_id: plant.id } }
                )
            }

            const rows = photos.map((p, i) => ({
                plant_id: plant.id,
                url: typeof p === 'string' ? p : p.url,
                sort_order: typeof p === 'object' && p.sort_order != null ? p.sort_order : i,
                is_main: typeof p === 'object' ? !!p.is_main : false,
                metadata: typeof p === 'object' && p.metadata ? p.metadata : {}
            })).filter(r => r.url)

            const created = await PlantPhoto.bulkCreate(rows)
            return res.status(201).json(created)
        } catch (error) {
            console.error('❌ Ошибка добавления фото:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async update(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!plant) {
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            const allowed = [
                'name', 'species', 'location', 'description',
                'photo_url', 'watering_interval_days',
                'last_watered_at', 'next_watering_at', 'is_active'
            ]

            const updates = {}
            for (const key of allowed) {
                if (req.body[key] !== undefined) {
                    updates[key] = req.body[key]
                }
            }

            if (req.body.metadata && typeof req.body.metadata === 'object') {
                updates.metadata = { ...plant.metadata, ...req.body.metadata }
            }

            await plant.update(updates)

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка обновления:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async delete(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!plant) {
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            await plant.update({ is_active: false })

            return res.json({ message: 'Растение удалено' })
        } catch (error) {
            console.error('❌ Ошибка удаления:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async water(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const now = new Date()
            const scheduledFor = plant.next_watering_at
            const nextWatering = computeNextWatering(
                now,
                plant.watering_interval_days || 7,
                plant.watering_time_of_day || 'morning'
            )

            const metadata = {
                ...(plant.metadata || {}),
                notifications: {}
            }

            await plant.update({
                last_watered_at: now,
                next_watering_at: nextWatering,
                metadata
            })

            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'watered',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: req.body?.note || null
            })

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка полива:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async skip(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const now = new Date()
            const scheduledFor = plant.next_watering_at


            const days = parseInt(req.body?.days) || 1
            const next = new Date(scheduledFor || now)
            next.setDate(next.getDate() + days)


            const metadata = {
                ...(plant.metadata || {}),
                notifications: {}
            }

            await plant.update({
                next_watering_at: next,
                metadata
            })


            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'skipped',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: req.body?.note || null
            })

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка пропуска:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getHistory(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const limit = Math.min(parseInt(req.query.limit) || 50, 200)
            const offset = parseInt(req.query.offset) || 0

            const logs = await WateringLog.findAndCountAll({
                where: { plant_id: plant.id },
                order: [['action_at', 'DESC']],
                limit,
                offset
            })

            return res.json({
                total: logs.count,
                limit,
                offset,
                items: logs.rows
            })
        } catch (error) {
            console.error('❌ Ошибка истории:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getNeedWatering(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const now = new Date()
            const plants = await Plant.findAll({
                where: {
                    user_id: userId,
                    is_active: true,
                    next_watering_at: { [Op.lte]: now }
                },
                order: [['next_watering_at', 'ASC']]
            })

            return res.json(plants)
        } catch (error) {
            console.error('❌ Ошибка получения нуждающихся в поливе:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getStats(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const [stats] = await sequelize.query(`
            SELECT
                COUNT(*) FILTER (WHERE action = 'watered') AS watered_count,
                COUNT(*) FILTER (WHERE action = 'skipped') AS skipped_count,
                COUNT(*) FILTER (WHERE action = 'watered' AND hours_late <= 24) AS on_time_count,
                AVG(hours_late) FILTER (WHERE action = 'watered') AS avg_hours_late
            FROM watering_logs
            WHERE plant_id = :plantId
        `, {
                replacements: { plantId: plant.id },
                type: sequelize.QueryTypes.SELECT
            })

            const total = parseInt(stats.watered_count) + parseInt(stats.skipped_count)
            const onTime = parseInt(stats.on_time_count) || 0
            const watered = parseInt(stats.watered_count) || 0

            return res.json({
                plant_id: plant.id,
                total_actions: total,
                watered_count: watered,
                skipped_count: parseInt(stats.skipped_count) || 0,
                on_time_count: onTime,
                on_time_rate: watered > 0 ? (onTime / watered) : 0,
                avg_hours_late: stats.avg_hours_late ? parseFloat(stats.avg_hours_late) : 0
            })
        } catch (error) {
            console.error('❌ Ошибка статистики:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async updateMetadata(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const newMetadata = {
                ...plant.metadata,
                ...req.body
            }

            await plant.update({ metadata: newMetadata })

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка обновления metadata:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new PlantController()