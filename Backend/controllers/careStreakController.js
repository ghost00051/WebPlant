import { Op } from 'sequelize'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import PlantCareLog from '../models/PlantCareLog.js'
import WateringLog from '../models/WateringLog.js'
import Notification from '../models/Notification.js'
import {
    computeCareStreak,
    resolveFreezesPerWeek,
    summarizeWeek,
    weekWindow,
    DAY_MS,
    STREAK_WINDOW_DAYS,
    WEEKLY_RECAP_TYPE
} from '../utils/careStreak.js'
import { resolveTimeZone } from '../utils/timeZone.js'

export const STREAK_EVENT_LIMIT = 1000

const DEFAULT_MODELS = {
    User,
    Plant,
    PlantPhoto,
    PlantCareLog,
    WateringLog,
    Notification
}

function toIsoString(value) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function serializeLatestRecap(row) {
    if (!row) return null
    return {
        id: row.id ?? null,
        title: row.title ?? null,
        body: row.body ?? null,
        createdAt: toIsoString(row.created_at ?? row.createdAt),
        payload: row.payload && typeof row.payload === 'object' ? row.payload : {}
    }
}

export function buildFreezePayload(freeze) {
    const source = freeze && typeof freeze === 'object' ? freeze : {}
    const availableThisWeek = Number(source.availableThisWeek) || 0
    const usedThisWeek = Number(source.usedThisWeek) || 0
    const usedFreezes = Array.isArray(source.used) ? source.used : []
    const frozenDates = usedFreezes
        .map(item => item?.localDate)
        .filter(value => typeof value === 'string' && value)

    return {
        ...source,
        available: availableThisWeek > 0,
        canFreeze: availableThisWeek > 0,
        used: usedThisWeek > 0,
        usedFreezes,
        frozenDates,
        daysLeft: availableThisWeek
    }
}

export class CareStreakController {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.now = deps.now || (() => new Date())
        this.get = this.get.bind(this)
        this.loadCareStreak = this.loadCareStreak.bind(this)
    }

    async get(req, res) {
        const userId = Number(req.user?.id)
        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(401).json({ message: 'Требуется авторизация' })
        }

        try {
            const payload = await this.loadCareStreak(userId)
            return res.json(payload)
        } catch (error) {
            console.error('❌ Ошибка получения серии ухода:', error?.message || error)
            return res.status(500).json({ message: 'Не удалось загрузить серию ухода' })
        }
    }

    async loadCareStreak(userId) {
        const now = this.now()
        const user = await this.models.User.findByPk(userId, {
            attributes: ['id', 'timezone'],
            raw: true
        })
        const timeZone = resolveTimeZone(user?.timezone)
        const window = weekWindow(now, timeZone)

        const { events, photos, careActions } = await this.loadActivity(userId, now, window)
        const streak = computeCareStreak(events, {
            now,
            timeZone,
            freezesPerWeek: resolveFreezesPerWeek()
        })
        const week = summarizeWeek(events, { now, timeZone, photos, careActions })
        const latestRecap = await this.loadLatestRecap(userId)

        return {
            current: streak.current,
            best: streak.best,
            lastWateredAt: streak.lastWateredAt,
            week,
            latestRecap,
            freeze: buildFreezePayload(streak.freeze),
            streakBreak: streak.streakBreak,
            breakReason: typeof streak.streakBreak?.reason === 'string'
                ? streak.streakBreak.reason
                : '',
            updatedAt: now.toISOString()
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

    async loadLatestRecap(userId) {
        try {
            const row = await this.models.Notification.findOne({
                where: { user_id: userId, type: WEEKLY_RECAP_TYPE },
                attributes: ['id', 'title', 'body', 'created_at', 'payload'],
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                raw: true
            })
            return serializeLatestRecap(row)
        } catch (error) {
            console.warn('⚠️ care-streak: последний recap недоступен:', error?.message || error)
            return null
        }
    }
}

export default new CareStreakController()
