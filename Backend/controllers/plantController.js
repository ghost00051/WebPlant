import Plant from '../models/Plant.js'
import jwt from 'jsonwebtoken'

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
                order: [['created_at', 'DESC']]
            })

            return res.json(plants)
        } catch (error) {
            console.error('❌ Ошибка получения растений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getOne(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
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

    async create(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const {
                name,
                species,
                location,
                description,
                photo_url,
                watering_interval_days,
                metadata
            } = req.body

            if (!name) {
                return res.status(400).json({ message: 'Название обязательно' })
            }

            const plant = await Plant.create({
                user_id: userId,
                name,
                species,
                location,
                description,
                photo_url,
                watering_interval_days: watering_interval_days || 7,
                metadata: metadata || {}
            })

            return res.status(201).json(plant)
        } catch (error) {
            console.error('❌ Ошибка создания растения:', error)
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
            const nextWatering = new Date(now)
            nextWatering.setDate(nextWatering.getDate() + (plant.watering_interval_days || 7))

            await plant.update({
                last_watered_at: now,
                next_watering_at: nextWatering
            })

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка полива:', error)
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