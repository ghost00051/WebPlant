import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import WateringLog from '../models/WateringLog.js'
import sequelize from '../db.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import { isValidWateringInterval } from '../utils/validation.js'
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

function isValidPhotoInput(photo) {
    if (typeof photo === 'string') return Boolean(photo.trim()) && photo.length <= 2048
    if (!photo || typeof photo !== 'object' || Array.isArray(photo) ||
        typeof photo.url !== 'string' || !photo.url.trim() || photo.url.length > 2048) {
        return false
    }
    if (photo.sort_order !== undefined &&
        (!Number.isInteger(photo.sort_order) || photo.sort_order < 0)) {
        return false
    }
    if (photo.is_main !== undefined && typeof photo.is_main !== 'boolean') return false
    if (photo.metadata !== undefined &&
        (!photo.metadata || typeof photo.metadata !== 'object' || Array.isArray(photo.metadata))) {
        return false
    }
    return true
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

    async getHistoryAll(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const limit = Math.min(parseInt(req.query.limit) || 200, 500)
            const offset = parseInt(req.query.offset) || 0

            const logs = await WateringLog.findAndCountAll({
                where: {
                    user_id: userId,
                    action: 'watered'
                },
                include: [{
                    model: Plant,
                    as: 'plant',
                    attributes: ['id', 'name', 'species', 'location'],
                    required: true,
                    where: { user_id: userId, is_active: true }
                }],
                order: [['action_at', 'DESC']],
                limit,
                offset,
                distinct: true
            })

            const groups = {}

            for (const log of logs.rows) {
                const iso = new Date(log.action_at).toISOString().slice(0, 10)

                if (!groups[iso]) {
                    groups[iso] = { date: iso, plants: [] }
                }

                const already = groups[iso].plants.find(p => p.id === log.plant_id)
                if (already) {
                    if (new Date(log.action_at) > new Date(already.watered_at)) {
                        already.watered_at = log.action_at
                        already.scheduled_for = log.scheduled_for
                        already.hours_late = log.hours_late
                        already.note = log.note
                    }
                    continue
                }

                groups[iso].plants.push({
                    id: log.plant_id,
                    name: log.plant?.name ?? null,
                    species: log.plant?.species ?? null,
                    location: log.plant?.location ?? null,
                    watered_at: log.action_at,
                    scheduled_for: log.scheduled_for,
                    hours_late: log.hours_late,
                    note: log.note
                })
            }

            const items = Object.values(groups).sort(
                (a, b) => b.date.localeCompare(a.date)
            )

            return res.json({
                generatedAt: new Date().toISOString(),
                total: logs.count,
                limit,
                offset,
                items
            })
        } catch (error) {
            console.error('❌ Ошибка истории:', error)
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
                include: [{
                    model: PlantPhoto,
                    as: 'photos',
                    separate: true,
                    order: [['sort_order', 'ASC']]
                }],
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

                const photos = p.photos || []
                const mainPhoto =
                    photos.find(ph => ph.is_main)?.url ??
                    photos[0]?.url ??
                    null

                groups[dateKey].plants.push({
                    id: p.id,
                    name: p.name,
                    species: p.species,
                    location: p.location,
                    description: p.description,
                    photo_url: mainPhoto,
                    photos: photos.map(ph => ({
                        id: ph.id,
                        url: ph.url,
                        is_main: ph.is_main,
                        sort_order: ph.sort_order
                    })),
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

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId, is_active: true },
                include: [{ model: PlantPhoto, as: 'photos' }],
                order: [
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
        let t
        try {
            t = await sequelize.transaction()
            const userId = getUserId(req)
            if (!userId) {
                await t.rollback()
                t = null
                return res.status(401).json({ message: 'Не авторизован' })
            }

            const {
                name, species, location, description,
                watering_interval_days, metadata,
                photos = []
            } = req.body || {}
            const intervalDays = watering_interval_days ?? 7
            const wateringTime = req.body?.watering_time_of_day || 'morning'

            if (typeof name !== 'string' || !name.trim() || name.length > 255) {
                await t.rollback()
                return res.status(400).json({ message: 'Название обязательно и должно содержать не более 255 символов' })
            }
            if (!isValidWateringInterval(intervalDays)) {
                await t.rollback()
                return res.status(400).json({ message: 'Интервал полива должен быть целым числом от 1 до 365 дней' })
            }
            if (!Object.hasOwn(TIME_OF_DAY_HOURS, wateringTime)) {
                await t.rollback()
                return res.status(400).json({ message: 'Некорректное время полива' })
            }
            if (!Array.isArray(photos) || photos.length > 10 ||
                photos.some(photo => !isValidPhotoInput(photo))) {
                await t.rollback()
                return res.status(400).json({ message: 'Некорректный список фотографий' })
            }
            if (metadata !== undefined &&
                (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) {
                await t.rollback()
                return res.status(400).json({ message: 'metadata должна быть объектом' })
            }

            const plant = await Plant.create({
                user_id: userId,
                name, species, location, description,
                watering_interval_days: intervalDays,
                watering_time_of_day: wateringTime,
                next_watering_at: computeNextWatering(
                    new Date(),
                    intervalDays,
                    wateringTime
                ),
                metadata: metadata || {}
            }, { transaction: t })

            if (photos.length) {
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
            t = null

            const result = await Plant.findByPk(plant.id, {
                include: [{ model: PlantPhoto, as: 'photos' }]
            })

            return res.status(201).json(result)
        } catch (error) {
            if (t && !t.finished) await t.rollback()
            console.error('❌ Ошибка создания растения:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async addPhotos(req, res) {
        let transaction
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const body = req.body || {}
            const photos = body.photos
            if (!Array.isArray(photos) || !photos.length || photos.length > 10 ||
                photos.some(photo => !isValidPhotoInput(photo))) {
                return res.status(400).json({ message: 'Некорректный список фотографий' })
            }

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            transaction = await sequelize.transaction()
            if (photos.some(p => typeof p === 'object' && p.is_main)) {
                await PlantPhoto.update(
                    { is_main: false },
                    { where: { plant_id: plant.id }, transaction }
                )
            }

            const rows = photos.map((p, i) => ({
                plant_id: plant.id,
                url: typeof p === 'string' ? p : p.url,
                sort_order: typeof p === 'object' && p.sort_order != null ? p.sort_order : i,
                is_main: typeof p === 'object' ? !!p.is_main : false,
                metadata: typeof p === 'object' && p.metadata ? p.metadata : {}
            })).filter(r => r.url)

            const created = await PlantPhoto.bulkCreate(rows, { transaction })
            await transaction.commit()
            return res.status(201).json(created)
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка добавления фото:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async update(req, res) {
        try {
            const body = req.body || {}
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
                'watering_time_of_day', 'last_watered_at', 'next_watering_at', 'is_active'
            ]

            const updates = {}
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    updates[key] = body[key]
                }
            }

            if (updates.name !== undefined &&
                (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 255)) {
                return res.status(400).json({ message: 'Некорректное название растения' })
            }
            if (updates.watering_interval_days !== undefined &&
                !isValidWateringInterval(updates.watering_interval_days)) {
                return res.status(400).json({ message: 'Интервал полива должен быть целым числом от 1 до 365 дней' })
            }
            if (updates.watering_time_of_day !== undefined &&
                !Object.hasOwn(TIME_OF_DAY_HOURS, updates.watering_time_of_day)) {
                return res.status(400).json({ message: 'Некорректное время полива' })
            }
            for (const key of ['last_watered_at', 'next_watering_at']) {
                const value = updates[key]
                if (value !== undefined && value !== null &&
                    (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
                    return res.status(400).json({ message: 'Некорректная дата полива' })
                }
            }
            if (updates.is_active !== undefined && typeof updates.is_active !== 'boolean') {
                return res.status(400).json({ message: 'Некорректный статус растения' })
            }

            if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
                updates.metadata = { ...plant.metadata, ...body.metadata }
            } else if (body.metadata !== undefined) {
                return res.status(400).json({ message: 'metadata должна быть объектом' })
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
        let transaction
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const note = req.body?.note
            if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 2000)) {
                return res.status(400).json({ message: 'Примечание должно быть строкой до 2000 символов' })
            }

            transaction = await sequelize.transaction()
            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!plant) {
                await transaction.rollback()
                transaction = null
                return res.status(404).json({ message: 'Растение не найдено' })
            }

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
            }, { transaction })

            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'watered',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: note || null
            }, { transaction })
            await transaction.commit()

            return res.json(plant)
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка полива:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async skip(req, res) {
        let transaction
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const note = req.body?.note
            if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 2000)) {
                return res.status(400).json({ message: 'Примечание должно быть строкой до 2000 символов' })
            }
            const days = req.body?.days === undefined ? 1 : Number(req.body.days)
            if (!Number.isInteger(days) || days < 1 || days > 365) {
                return res.status(400).json({ message: 'Количество дней должно быть целым числом от 1 до 365' })
            }

            transaction = await sequelize.transaction()
            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!plant) {
                await transaction.rollback()
                transaction = null
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            const now = new Date()
            const scheduledFor = plant.next_watering_at

            const next = new Date(scheduledFor || now)
            next.setDate(next.getDate() + days)
            if (!Number.isFinite(next.getTime())) {
                await transaction.rollback()
                transaction = null
                return res.status(400).json({ message: 'Некорректная дата следующего полива' })
            }


            const metadata = {
                ...(plant.metadata || {}),
                notifications: {}
            }

            await plant.update({
                next_watering_at: next,
                metadata
            }, { transaction })


            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'skipped',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: note || null
            }, { transaction })
            await transaction.commit()

            return res.json(plant)
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
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

    async getCompletionStats(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                attributes: ['id', 'watering_interval_days', 'created_at'],
                raw: true
            })

            const now = new Date()
            let expected = 0

            for (const p of plants) {
                const interval = p.watering_interval_days || 7
                const created = new Date(p.created_at)
                const daysAlive = Math.max(
                    0,
                    Math.floor((now - created) / (24 * 60 * 60 * 1000))
                )
                expected += Math.floor(daysAlive / interval)
            }

            const plantIds = plants.map(p => p.id)

            let actual = 0

            if (plantIds.length) {
                const [row] = await sequelize.query(`
                SELECT COUNT(DISTINCT (plant_id, DATE(action_at))) AS count
                FROM watering_logs
                WHERE user_id = :userId
                  AND action = 'watered'
                  AND plant_id IN (:plantIds)
            `, {
                    replacements: { userId, plantIds },
                    type: sequelize.QueryTypes.SELECT
                })

                actual = parseInt(row?.count) || 0
            }

            const percent = expected > 0
                ? Math.min(100, Math.round((actual / expected) * 100))
                : null

            const firstPlant = plants.length
                ? plants.reduce((min, p) =>
                    new Date(p.created_at) < new Date(min.created_at) ? p : min
                )
                : null

            return res.json({
                plantsCount: plants.length,
                sinceDate: firstPlant ? firstPlant.created_at : null,
                expected,
                actual,
                percent
            })
        } catch (error) {
            console.error('❌ Ошибка completion stats:', error)
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