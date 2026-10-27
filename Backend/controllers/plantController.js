import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import Plant from '../models/Plant.js'
import PlantPhoto from '../models/PlantPhoto.js'
import WateringLog from '../models/WateringLog.js'
import PlantCareLog from '../models/PlantCareLog.js'
import Notification from '../models/Notification.js'
import sequelize from '../db.js'
import { Op } from 'sequelize'
import {
    getUploadedPlantPhotoPath,
    isValidReminderWeekdays,
    isValidWateringInterval
} from '../utils/validation.js'
import {
    analyzePlantPhoto,
    getMaxAdviceQuestions,
    suggestPlantSpeciesWithMeta,
    suggestSpeciesFromPhoto,
    suggestWateringAdvice,
    suggestWateringTimeAdvice
} from '../services/aiService.js'
import { logAiAdvice } from '../utils/aiAdviceLog.js'
import {
    removePlantPhotoFiles,
    removePlantPhotoFilesIfUnreferenced
} from '../utils/plantPhotoCleanup.js'
import {
    buildHealthCheckRecord,
    buildHealthCheckResponse,
    mapVisionErrorResponse,
    mergePhotoDiagnosisMetadata,
    mergePlantHealthCheck,
    normalizeHealthCheckQuestion
} from '../utils/plantHealthCheck.js'
import {
    POPULAR_SPECIES_MAX_SPECIES_LENGTH,
    POPULAR_SPECIES_MIN_SPECIES_LENGTH,
    POPULAR_SPECIES_SQL,
    buildPopularSpeciesPayload,
    parsePopularSpeciesLimit
} from '../utils/popularSpecies.js'
import {
    generateWateringOccurrences,
    findFirstWateringAfter,
    advanceZonedWatering,
    isWateringMissed,
    localDayRange,
    nextWateringInstant,
    normalizeReminderWeekdays,
    parseWateringSlot,
    pickWateringLogForSlot,
    resolveMissedLateness,
    resolvePastWatering,
    WATERING_TIME_OF_DAY_HOURS,
    zonedDayHourAfter,
    zonedDayKey,
    MISSED_GRACE_HOUR,
    MISSED_GRACE_MS
} from '../utils/wateringSchedule.js'
import {
    clearWateringProgress,
    hasWateringProgress,
    resumeReminders as resumeRemindersMetadata,
    sanitizePlantMetadata,
    withNotificationsReset
} from '../utils/plantMetadata.js'
import User from '../models/userModels.js'
import { resolveHemisphere, resolveTimeZone } from '../utils/timeZone.js'
import { recalculatePrediction, resetPrediction } from '../services/wateringLearning.js'
import { buildPredictionMetadata } from '../utils/wateringPrediction.js'
import { careTitleFor, normalizeCareActionPayload, serializeCareLog } from '../utils/careLogs.js'
import { buildCareSchedule } from '../utils/careSchedule.js'
import { detectPlantGroup, getSeasonInfo } from '../utils/wateringKnowledge.js'
import carePlanService from '../services/carePlanService.js'
import {
    MISSED_BACKFILL_WINDOW_DAYS,
    buildWateringState,
    resolveMissedPolicy
} from '../utils/missedWatering.js'
import { plantThumbUrl } from '../utils/plantPhotoThumb.js'
import {
    PLANT_PHOTO_GALLERY_MAX,
    buildPlantPhotoRow,
    isPlantPhotoGalleryFull,
    isValidPhotoInput,
    pickNextMainPhoto,
    serializePlantPhoto,
    sortPlantPhotosForGallery
} from '../utils/plantPhotos.js'
const TIME_OF_DAY_HOURS = WATERING_TIME_OF_DAY_HOURS
const PLANT_PHOTO_DIRECTORY = path.resolve('uploads', 'plants')
const SCHEDULE_DAYS_AHEAD = 90
const WATERING_DUPLICATE_WINDOW_MS = 60 * 1000
const MAX_METADATA_BYTES = 8 * 1024
const RESERVED_METADATA_KEYS = ['notifications', 'missed_since', 'reminders_paused', 'consecutive_skips', 'prediction', 'health_check']
const DEFAULT_SCHEDULE_DAYS = 7
const POPULAR_SPECIES_CACHE_TTL_MS = 5 * 60 * 1000
const CARE_HISTORY_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

const DEFAULT_MODELS = {
    Plant,
    PlantPhoto,
    WateringLog,
    PlantCareLog,
    Notification,
    User
}

const DEFAULT_SERVICES = {
    analyzePlantPhoto,
    logAiAdvice,
    readPlantPhotoBuffer,
    removePlantPhotoFiles,
    removePlantPhotoFilesIfUnreferenced,
    suggestSpeciesFromPhoto
}

let popularSpeciesCache = null

function readPopularSpeciesCache(limit) {
    if (!popularSpeciesCache) return null
    if (popularSpeciesCache.expiresAt <= Date.now()) {
        popularSpeciesCache = null
        return null
    }
    if (popularSpeciesCache.limit !== limit) return null
    return popularSpeciesCache.payload
}

function writePopularSpeciesCache(limit, payload) {
    popularSpeciesCache = {
        limit,
        payload,
        expiresAt: Date.now() + POPULAR_SPECIES_CACHE_TTL_MS
    }
}

function invalidatePopularSpeciesCache() {
    popularSpeciesCache = null
}

async function readPlantPhotoBuffer(photoPath) {
    const filePath = path.join(PLANT_PHOTO_DIRECTORY, path.basename(photoPath))
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
        const error = new Error('Фотография должна быть предварительно загружена на сервер')
        error.code = 'ENOENT'
        throw error
    }
    return readFile(filePath)
}

function computeHoursLate(scheduledFor, actionAt) {
    if (!scheduledFor) return null
    const diff = (new Date(actionAt) - new Date(scheduledFor)) / (60 * 60 * 1000)
    if (!Number.isFinite(diff)) return null
    return Math.max(0, Math.round(diff))
}

function computeNextWatering(from, days, timeOfDay = 'morning', timeZone) {
    return nextWateringInstant(from, days, timeOfDay, timeZone ? { timeZone } : {})
}

function wateringHour(plant) {
    return TIME_OF_DAY_HOURS[plant?.watering_time_of_day] ?? TIME_OF_DAY_HOURS.morning
}

function futureWatering(from, intervalDays, timeOfDay, timeZone, now = new Date()) {
    const hour = wateringHour({ watering_time_of_day: timeOfDay })
    const interval = Number.isInteger(intervalDays) && intervalDays > 0
        ? intervalDays
        : DEFAULT_SCHEDULE_DAYS
    return advanceZonedWatering(from, interval, hour, timeZone, now)
}

function sameInstant(value, other) {
    if (value === undefined || value === null) return other === undefined || other === null
    const left = new Date(value)
    const right = other === undefined || other === null ? null : new Date(other)
    if (!Number.isFinite(left.getTime())) return false
    if (!right || !Number.isFinite(right.getTime())) return false
    return left.getTime() === right.getTime()
}

function parsePagination(query, { defaultLimit = 100, maxLimit = 500 } = {}) {
    const limit = query.limit === undefined ? defaultLimit : Number(query.limit)
    const offset = query.offset === undefined ? 0 : Number(query.offset)
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) return null
    if (!Number.isInteger(offset) || offset < 0) return null
    return { limit, offset }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutReservedMetadata(metadata) {
    const next = sanitizePlantMetadata(metadata)
    for (const key of RESERVED_METADATA_KEYS) delete next[key]
    return next
}

async function getUserTimeZone(userId) {
    const user = await User.findByPk(userId, { attributes: ['timezone'] })
    return resolveTimeZone(user?.timezone)
}

function getUserId(req) {
    return req.user?.id ?? null
}

function getUserAiLocale(req) {
    return {
        timeZone: resolveTimeZone(req.user?.timezone),
        hemisphere: resolveHemisphere(req.user)
    }
}

function serializePhoto(photo) {
    if (!photo || typeof photo !== 'object') return photo
    const source = typeof photo.toJSON === 'function' ? photo.toJSON() : photo
    return {
        ...source,
        thumb_url: plantThumbUrl(source.url)
    }
}

export function serializePlantWithWateringState(plant, { now, timeZone, policy }) {
    const source = plant && typeof plant.toJSON === 'function' ? plant.toJSON() : { ...plant }
    if (Array.isArray(source.photos)) {
        source.photos = source.photos.map(serializePhoto)
    }
    source.watering_state = buildWateringState({
        plant: source,
        now,
        timeZone,
        policy
    })
    return source
}

function missedScheduleFields({ state, slot, now, policy, missed }) {
    if (!missed) {
        return {
            missed_since: null,
            missed_slots: 0,
            can_backfill: false,
            backfill_until: null,
            days_late: 0,
            reason: null,
            missed_policy: policy
        }
    }

    const slotDate = new Date(slot)
    const backfillUntil = Number.isFinite(slotDate.getTime())
        ? new Date(slotDate.getTime() + MISSED_BACKFILL_WINDOW_DAYS * DAY_MS)
        : null
    const canBackfill = Boolean(backfillUntil && now.getTime() <= backfillUntil.getTime())

    return {
        missed_since: state?.missed_since ?? (Number.isFinite(slotDate.getTime())
            ? slotDate.toISOString()
            : null),
        missed_slots: state?.missed_slots ?? 1,
        can_backfill: canBackfill,
        backfill_until: canBackfill ? backfillUntil.toISOString() : null,
        days_late: Number.isFinite(slotDate.getTime())
            ? Math.max(0, Math.floor((now.getTime() - slotDate.getTime()) / DAY_MS))
            : 0,
        reason: state?.reason ?? 'missed_slot',
        missed_policy: policy
    }
}

class PlantController {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.services = { ...DEFAULT_SERVICES, ...(deps.services || {}) }

        for (const name of Object.getOwnPropertyNames(PlantController.prototype)) {
            if (name !== 'constructor' && typeof this[name] === 'function') {
                this[name] = this[name].bind(this)
            }
        }
    }

    async healthCheck(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await this.models.Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const questionResult = normalizeHealthCheckQuestion(req.body?.question)
            if (!questionResult.ok) {
                return res.status(400).json({ message: 'Вопрос должен быть строкой' })
            }

            const file = Array.isArray(req.files) ? req.files[0] : req.file
            let imageBuffer = null
            let photoUrl = ''

            if (file?.buffer?.length) {
                imageBuffer = file.buffer
            } else {
                const rawPhotoUrl = req.body?.photoUrl
                if (typeof rawPhotoUrl !== 'string' || !rawPhotoUrl.trim()) {
                    return res.status(400).json({ message: 'Загрузите фото растения или укажите photoUrl' })
                }
                const photoPath = getUploadedPlantPhotoPath(rawPhotoUrl)
                if (!photoPath) {
                    return res.status(400).json({ message: 'Некорректная ссылка на фото растения' })
                }
                photoUrl = rawPhotoUrl.trim().startsWith('/')
                    ? `${req.protocol}://${req.get('host')}${photoPath}`
                    : rawPhotoUrl.trim()

                try {
                    imageBuffer = await this.services.readPlantPhotoBuffer(photoPath)
                } catch (error) {
                    if (error?.code === 'ENOENT') {
                        return res.status(400).json({
                            message: 'Фотография должна быть предварительно загружена на сервер'
                        })
                    }
                    throw error
                }
                if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
                    return res.status(400).json({
                        message: 'Фотография должна быть предварительно загружена на сервер'
                    })
                }
            }

            let result
            try {
                result = await this.services.analyzePlantPhoto({
                    imageBuffers: [imageBuffer],
                    question: questionResult.question,
                    plantName: plant.name,
                    location: plant.location,
                    timeZone: getUserAiLocale(req).timeZone
                })
            } catch (error) {
                console.error('❌ Ошибка анализа здоровья растения:', error?.message || error)
                const mapped = mapVisionErrorResponse(error, {
                    unavailableMessage: 'Сервис проверки здоровья временно недоступен'
                })
                return res.status(mapped.status).json({ message: mapped.message })
            }

            const record = buildHealthCheckRecord({
                text: result?.text,
                diagnosis: result?.diagnosis ?? null,
                photoUrl,
                createdAt: new Date()
            })

            await plant.update({
                metadata: mergePlantHealthCheck(plant.metadata, record)
            })

            if (photoUrl) {
                try {
                    const photo = await this.models.PlantPhoto.findOne({
                        where: { plant_id: plant.id, url: photoUrl }
                    })
                    if (photo) {
                        await photo.update({
                            metadata: mergePhotoDiagnosisMetadata(photo.metadata, record)
                        })
                    }
                } catch (error) {
                    console.warn('⚠️ Не удалось сохранить диагноз в metadata фото:', error?.message || error)
                }
            }

            return res.json(buildHealthCheckResponse(record))
        } catch (error) {
            console.error('❌ Ошибка проверки здоровья растения:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async suggestSpecies(req, res) {
        const plantName = req.body?.name
        if (typeof plantName !== 'string' || !plantName.trim() || plantName.trim().length > 255) {
            return res.status(400).json({
                message: 'Введите название растения длиной не более 255 символов'
            })
        }

        try {
            const { species, source, latencyMs } = await suggestPlantSpeciesWithMeta(plantName.trim())
            logAiAdvice({
                userId: getUserId(req),
                kind: 'species',
                plantName,
                species,
                source,
                latencyMs
            })
            return res.json({ species })
        } catch (error) {
            console.error('❌ Ошибка подсказки вида растения:', error)
            return res.status(503).json({
                message: error.message || 'Сервис подсказок временно недоступен'
            })
        }
    }

    async suggestSpeciesFromPhoto(req, res) {
        const file = Array.isArray(req.files) ? req.files[0] : req.file
        if (!file?.buffer?.length) {
            return res.status(400).json({ message: 'Загрузите фото растения' })
        }

        try {
            const result = await this.services.suggestSpeciesFromPhoto({ imageBuffer: file.buffer })
            const top = Array.isArray(result.suggestions) ? result.suggestions[0] : null
            this.services.logAiAdvice({
                userId: getUserId(req),
                kind: 'species',
                plantName: top?.name,
                species: top?.species,
                source: result.source,
                latencyMs: result.latencyMs
            })
            return res.json({
                suggestions: result.suggestions,
                isPlant: result.isPlant !== false,
                source: result.source,
                generatedAt: new Date().toISOString()
            })
        } catch (error) {
            console.error('❌ Ошибка подсказки вида по фото:', error?.code || error?.message || error)
            const mapped = mapVisionErrorResponse(error, {
                unavailableMessage: 'Сервис подсказки вида по фото временно недоступен'
            })
            return res.status(mapped.status).json({ message: mapped.message })
        }
    }

    async getPopularSpecies(req, res) {
        const limit = parsePopularSpeciesLimit(req.query?.limit)
        try {
            const cached = readPopularSpeciesCache(limit)
            if (cached) return res.json(cached)

            const rows = await sequelize.query(POPULAR_SPECIES_SQL, {
                replacements: {
                    limit,
                    minLength: POPULAR_SPECIES_MIN_SPECIES_LENGTH,
                    maxLength: POPULAR_SPECIES_MAX_SPECIES_LENGTH
                },
                type: sequelize.QueryTypes.SELECT
            })

            const payload = buildPopularSpeciesPayload(rows, { limit })
            writePopularSpeciesCache(limit, payload)
            return res.json(payload)
        } catch (error) {
            console.error('❌ Ошибка популярных видов растений:', error)

            const cached = readPopularSpeciesCache(limit)
            if (cached) return res.json(cached)

            return res.status(200).json({
                items: [],
                totalSpecies: 0,
                generatedAt: new Date().toISOString()
            })
        }
    }

    async suggestWateringAdvice(req, res) {
        const { name, species, answers = [], location, mode } = req.body || {}
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
            return res.status(400).json({ message: 'Введите корректное название растения' })
        }
        if (species !== undefined &&
            (typeof species !== 'string' || species.length > 255)) {
            return res.status(400).json({ message: 'Некорректный вид растения' })
        }
        if (location !== undefined &&
            (typeof location !== 'string' || location.length > 255)) {
            return res.status(400).json({ message: 'Некорректное место растения' })
        }
        if (mode !== undefined && !['auto', 'question', 'recommendation'].includes(mode)) {
            return res.status(400).json({ message: 'Некорректный режим подсказки' })
        }
        if (!Array.isArray(answers) || answers.length > getMaxAdviceQuestions() ||
            answers.some(item =>
                !item ||
                typeof item !== 'object' ||
                typeof item.question !== 'string' ||
                !item.question.trim() ||
                item.question.length > 400 ||
                typeof item.answer !== 'string' ||
                !item.answer.trim() ||
                item.answer.length > 500
            )) {
            return res.status(400).json({ message: 'Некорректные ответы на вопросы' })
        }

        try {
            const locale = getUserAiLocale(req)
            const advice = await suggestWateringAdvice({
                plantName: name.trim(),
                species: species?.trim(),
                location: location?.trim(),
                mode: mode || 'auto',
                timeZone: locale.timeZone,
                hemisphere: locale.hemisphere,
                answers: answers.map(({ question, answer }) => ({
                    question: question.trim(),
                    answer: answer.trim()
                }))
            })
            logAiAdvice({
                userId: getUserId(req),
                kind: 'watering',
                plantName: name,
                species,
                season: advice.season,
                resultType: advice.type,
                intervalDays: advice.intervalDays,
                confidence: advice.confidence,
                questionsAsked: answers.length,
                source: advice.source,
                latencyMs: advice.latencyMs
            })
            return res.json(advice)
        } catch (error) {
            console.error('❌ Ошибка подсказки полива:', error)
            return res.status(503).json({
                message: error.message || 'Сервис рекомендаций временно недоступен'
            })
        }
    }

    async suggestWateringTime(req, res) {
        const { name, species, intervalDays, location } = req.body || {}
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
            return res.status(400).json({ message: 'Введите корректное название растения' })
        }
        if (species !== undefined &&
            (typeof species !== 'string' || species.length > 255)) {
            return res.status(400).json({ message: 'Некорректный вид растения' })
        }
        if (location !== undefined &&
            (typeof location !== 'string' || location.length > 255)) {
            return res.status(400).json({ message: 'Некорректное место растения' })
        }
        if (!isValidWateringInterval(intervalDays)) {
            return res.status(400).json({ message: 'Некорректная частота полива' })
        }

        try {
            const locale = getUserAiLocale(req)
            const advice = await suggestWateringTimeAdvice({
                plantName: name.trim(),
                species: species?.trim(),
                location: location?.trim(),
                intervalDays,
                timeZone: locale.timeZone,
                hemisphere: locale.hemisphere
            })
            logAiAdvice({
                userId: getUserId(req),
                kind: 'time',
                plantName: name,
                species,
                season: advice.season,
                resultType: 'time',
                timeOfDay: advice.timeOfDay,
                source: advice.source,
                latencyMs: advice.latencyMs
            })
            return res.json(advice)
        } catch (error) {
            console.error('❌ Ошибка подсказки времени полива:', error)
            return res.status(503).json({
                message: error.message || 'Сервис рекомендаций временно недоступен'
            })
        }
    }

    async exportCsv(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const timeZone = await getUserTimeZone(userId)
            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                order: [['created_at', 'DESC']],
                limit: 5000
            })

            const escapeCell = value => {
                if (value === null || value === undefined) return ''
                const text = String(value)
                return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
            }
            const formatDate = value => {
                if (!value) return ''
                const date = value instanceof Date ? value : new Date(value)
                return Number.isNaN(date.getTime())
                    ? ''
                    : date.toLocaleString('ru-RU', { timeZone })
            }

            const header = ['id', 'name', 'species', 'location', 'watering_interval_days',
                'watering_time_of_day', 'last_watered_at', 'next_watering_at', 'created_at']
            const lines = [header.join(';')]
            for (const plant of plants) {
                lines.push([
                    plant.id,
                    plant.name,
                    plant.species,
                    plant.location,
                    plant.watering_interval_days,
                    plant.watering_time_of_day,
                    formatDate(plant.last_watered_at),
                    formatDate(plant.next_watering_at),
                    formatDate(plant.created_at)
                ].map(escapeCell).join(';'))
            }

            const csv = `\uFEFF${lines.join('\r\n')}`
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.setHeader('Content-Disposition', 'attachment; filename="webplant-plants.csv"')
            res.setHeader('Cache-Control', 'no-store')
            return res.send(csv)
        } catch (error) {
            console.error('❌ Ошибка экспорта растений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

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
            const timeZone = await getUserTimeZone(userId)
            const now = new Date()
            const policy = resolveMissedPolicy()

            return res.json(plants.map(plant =>
                serializePlantWithWateringState(plant, { now, timeZone, policy })
            ))
        } catch (error) {
            console.error('❌ Ошибка получения растений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getHistoryAll(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const timeZone = await getUserTimeZone(userId)
            const pagination = parsePagination(req.query, { defaultLimit: 200, maxLimit: 500 })
            if (!pagination) {
                return res.status(400).json({ message: 'Параметры limit и offset должны быть целыми числами в допустимом диапазоне' })
            }
            const { limit, offset } = pagination

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
                const iso = zonedDayKey(log.action_at, timeZone)

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

            const timeZone = await getUserTimeZone(userId)
            const policy = resolveMissedPolicy()
            const groups = {}
            const nowKey = zonedDayKey(now, timeZone)

            for (const p of plants) {
                if (!p.next_watering_at) continue

                const photos = p.photos || []
                const mainPhoto =
                    photos.find(ph => ph.is_main)?.url ??
                    photos[0]?.url ??
                    null

                const intervalDays = Number.isInteger(p.watering_interval_days) &&
                    p.watering_interval_days > 0
                    ? p.watering_interval_days
                    : 7
                const occurrences = generateWateringOccurrences(
                    p.next_watering_at,
                    intervalDays,
                    { now, daysAhead: SCHEDULE_DAYS_AHEAD, timeZone }
                )
                const wateringState = buildWateringState({
                    plant: p,
                    now,
                    timeZone,
                    policy
                })

                for (const dt of occurrences) {
                    const dateKey = zonedDayKey(dt, timeZone)
                    const missed = isWateringMissed(dt, { now, timeZone })

                    let bucket
                    if (missed) bucket = 'overdue'
                    else if (dateKey === nowKey) bucket = 'today'
                    else bucket = 'later'

                    if (!groups[dateKey]) {
                        groups[dateKey] = { date: dateKey, bucket, plants: [] }
                    }

                    groups[dateKey].plants.push({
                        id: p.id,
                        name: p.name,
                        species: p.species,
                        location: p.location,
                        description: p.description,
                        photo_url: mainPhoto,
                        next_watering_at: dt,
                        scheduled_for: dt,
                        watering_interval_days: intervalDays,
                        watering_time_of_day: p.watering_time_of_day,
                        is_missed: missed,
                        ...missedScheduleFields({
                            state: wateringState,
                            slot: dt,
                            now,
                            policy,
                            missed
                        })
                    })
                }
            }

            const items = Object.values(groups).sort(
                (a, b) => new Date(a.date) - new Date(b.date)
            )

            return res.json({
                generatedAt: now.toISOString(),
                summary: {
                    overdue: items.filter(i => i.bucket === 'overdue').reduce((s, i) => s + i.plants.length, 0),
                    today: items.filter(i => i.bucket === 'today').reduce((s, i) => s + i.plants.length, 0),
                    total: items.reduce((s, i) => s + i.plants.length, 0),
                    plants: plants.length
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

            const timeZone = await getUserTimeZone(userId)
            return res.json(serializePlantWithWateringState(plant, {
                now: new Date(),
                timeZone,
                policy: resolveMissedPolicy()
            }))
        } catch (error) {
            console.error('❌ Ошибка:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
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
                notify_morning = true,
                notify_day_before = false,
                reminder_weekdays = [],
                photos = []
            } = req.body || {}
            const intervalDays = watering_interval_days ?? 7
            const wateringTime = req.body?.watering_time_of_day || 'morning'
            const timeZone = await getUserTimeZone(userId)

            if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
                await t.rollback()
                return res.status(400).json({ message: 'Название обязательно и должно содержать не более 255 символов' })
            }
            if (species !== undefined && species !== null &&
                (typeof species !== 'string' || species.length > 255)) {
                await t.rollback()
                return res.status(400).json({ message: 'Вид растения должен содержать не более 255 символов' })
            }
            if (location !== undefined && location !== null &&
                (typeof location !== 'string' || location.length > 255)) {
                await t.rollback()
                return res.status(400).json({ message: 'Местоположение должно содержать не более 255 символов' })
            }
            if (description !== undefined && description !== null &&
                (typeof description !== 'string' || description.length > 10000)) {
                await t.rollback()
                return res.status(400).json({ message: 'Описание должно содержать не более 10000 символов' })
            }
            if (typeof notify_morning !== 'boolean' ||
                typeof notify_day_before !== 'boolean') {
                await t.rollback()
                return res.status(400).json({ message: 'Настройки напоминаний должны быть логическими значениями' })
            }
            if (!isValidReminderWeekdays(reminder_weekdays)) {
                await t.rollback()
                return res.status(400).json({ message: 'Некорректные дни напоминаний' })
            }
            if (!isValidWateringInterval(intervalDays)) {
                await t.rollback()
                return res.status(400).json({ message: 'Интервал полива должен быть целым числом от 1 до 365 дней' })
            }
            if (!Object.hasOwn(TIME_OF_DAY_HOURS, wateringTime)) {
                await t.rollback()
                return res.status(400).json({ message: 'Некорректное время полива' })
            }
            if (!Array.isArray(photos) || photos.length > 2 ||
                photos.some(photo => !isValidPhotoInput(photo))) {
                await t.rollback()
                return res.status(400).json({ message: 'Некорректный список фотографий' })
            }
            const normalizedPhotos = []
            for (const photo of photos) {
                const photoUrl = typeof photo === 'string' ? photo : photo.url
                const photoPath = getUploadedPlantPhotoPath(photoUrl)
                if (!photoPath) {
                    await t.rollback()
                    return res.status(400).json({ message: 'Некорректный список фотографий' })
                }

                try {
                    const photoStats = await stat(
                        path.join(PLANT_PHOTO_DIRECTORY, path.basename(photoPath))
                    )
                    if (!photoStats.isFile()) {
                        await t.rollback()
                        return res.status(400).json({
                            message: 'Фотографии должны быть предварительно загружены на сервер'
                        })
                    }
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        await t.rollback()
                        return res.status(400).json({
                            message: 'Фотографии должны быть предварительно загружены на сервер'
                        })
                    }
                    throw error
                }

                normalizedPhotos.push(typeof photo === 'string'
                    ? `${req.protocol}://${req.get('host')}${photoPath}`
                    : { ...photo, url: `${req.protocol}://${req.get('host')}${photoPath}` })
            }
            if (metadata !== undefined &&
                (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) {
                await t.rollback()
                return res.status(400).json({ message: 'metadata должна быть объектом' })
            }

            const nextWateringAt = computeNextWatering(
                new Date(),
                intervalDays,
                wateringTime,
                timeZone
            )
            const normalizedWeekdays = normalizeReminderWeekdays(
                intervalDays,
                reminder_weekdays,
                nextWateringAt,
                timeZone
            )

            const plant = await Plant.create({
                user_id: userId,
                name: name.trim(),
                species: typeof species === 'string' ? species.trim() : species,
                location: typeof location === 'string' ? location.trim() : location,
                description,
                watering_interval_days: intervalDays,
                watering_time_of_day: wateringTime,
                notify_morning,
                notify_day_before,
                reminder_weekdays: normalizedWeekdays,
                next_watering_at: nextWateringAt,
                metadata: buildPredictionMetadata(withoutReservedMetadata(metadata), {
                    baseIntervalDays: intervalDays,
                    intervalDays,
                    samples: 0,
                    lastObservedAt: null
                })
            }, { transaction: t })

            if (photos.length) {
                const rows = normalizedPhotos.map((p, i) => buildPlantPhotoRow(p, {
                    plantId: plant.id,
                    index: i,
                    url: typeof p === 'string' ? p : p.url
                })).filter(row => row.url)

                await PlantPhoto.bulkCreate(rows, { transaction: t })
            }

            await t.commit()
            t = null

            const result = await Plant.findByPk(plant.id, {
                include: [{ model: PlantPhoto, as: 'photos' }]
            })

            invalidatePopularSpeciesCache()
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

            const plant = await this.models.Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const galleryCount = await this.models.PlantPhoto.count({
                where: { plant_id: plant.id }
            })
            if (isPlantPhotoGalleryFull(galleryCount, photos.length)) {
                return res.status(400).json({
                    message: `В галерее растения уже ${Number(galleryCount) || 0} фото — больше ${PLANT_PHOTO_GALLERY_MAX} хранить нельзя`
                })
            }

            const normalizedPhotos = []
            for (const photo of photos) {
                const photoUrl = typeof photo === 'string' ? photo : photo.url
                const photoPath = getUploadedPlantPhotoPath(photoUrl)
                if (!photoPath) {
                    return res.status(400).json({ message: 'Некорректный список фотографий' })
                }

                try {
                    const photoStats = await stat(
                        path.join(PLANT_PHOTO_DIRECTORY, path.basename(photoPath))
                    )
                    if (!photoStats.isFile()) {
                        return res.status(400).json({
                            message: 'Фотографии должны быть предварительно загружены на сервер'
                        })
                    }
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        return res.status(400).json({
                            message: 'Фотографии должны быть предварительно загружены на сервер'
                        })
                    }
                    throw error
                }

                normalizedPhotos.push({
                    ...(typeof photo === 'object' ? photo : {}),
                    url: `${req.protocol}://${req.get('host')}${photoPath}`
                })
            }

            transaction = await sequelize.transaction()
            if (normalizedPhotos.some(p => p.is_main)) {
                await this.models.PlantPhoto.update(
                    { is_main: false },
                    { where: { plant_id: plant.id }, transaction }
                )
            }

            const rows = normalizedPhotos.map((p, i) => buildPlantPhotoRow(p, {
                plantId: plant.id,
                index: i,
                url: p.url
            }))

            const created = await this.models.PlantPhoto.bulkCreate(rows, { transaction })
            await transaction.commit()
            return res.status(201).json(created.map(photo =>
                serializePlantPhoto(photo, { thumbUrl: plantThumbUrl(photo.url) })
            ))
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка добавления фото:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getPhotos(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId },
                attributes: ['id']
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const photos = await PlantPhoto.findAll({
                where: { plant_id: plant.id },
                order: [
                    ['is_main', 'DESC'],
                    ['taken_at', 'DESC'],
                    ['sort_order', 'ASC'],
                    ['id', 'ASC']
                ]
            })

            return res.json({
                plant_id: plant.id,
                items: sortPlantPhotosForGallery(photos).map(photo =>
                    serializePlantPhoto(photo, { thumbUrl: plantThumbUrl(photo.url) })
                )
            })
        } catch (error) {
            console.error('❌ Ошибка галереи фото растения:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async deletePhoto(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await this.models.Plant.findOne({
                where: { id: req.params.id, user_id: userId },
                attributes: ['id']
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const photoId = Number(req.params.photoId)
            const photo = await this.models.PlantPhoto.findOne({
                where: { id: photoId, plant_id: plant.id }
            })
            if (!photo) return res.status(404).json({ message: 'Фотография не найдена' })

            const wasMain = photo.is_main === true
            const photoUrl = photo.url
            await photo.destroy()

            if (wasMain) {
                const rest = await this.models.PlantPhoto.findAll({ where: { plant_id: plant.id } })
                const next = pickNextMainPhoto(rest)
                if (next) await next.update({ is_main: true })
            }

            try {
                await this.services.removePlantPhotoFilesIfUnreferenced(photoUrl, {
                    countReferences: url => this.models.PlantPhoto.count({ where: { url } })
                })
            } catch (error) {
                console.warn('⚠️ Не удалось удалить файлы фото растения:', error?.message || error)
            }

            return res.json({ deleted: true, id: photoId })
        } catch (error) {
            console.error('❌ Ошибка удаления фото растения:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async update(req, res) {
        let transaction
        try {
            const body = req.body || {}
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            transaction = await sequelize.transaction()
            const fail = async (status, message) => {
                if (transaction && !transaction.finished) await transaction.rollback()
                transaction = null
                return res.status(status).json({ message })
            }

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId },
                transaction,
                lock: transaction.LOCK.UPDATE
            })

            if (!plant) return fail(404, 'Растение не найдено')

            const timeZone = await getUserTimeZone(userId)
            const allowed = [
                'name', 'species', 'location', 'description',
                'photo_url', 'watering_interval_days',
                'watering_time_of_day', 'last_watered_at', 'next_watering_at', 'is_active',
                'notify_morning', 'notify_day_before', 'reminder_weekdays'
            ]

            const updates = {}
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    updates[key] = body[key]
                }
            }

            if (updates.name !== undefined &&
                (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 255)) {
                return fail(400, 'Некорректное название растения')
            }
            if (updates.name !== undefined) updates.name = updates.name.trim()
            for (const key of ['species', 'location']) {
                if (updates[key] !== undefined && updates[key] !== null &&
                    (typeof updates[key] !== 'string' || updates[key].length > 255)) {
                    return fail(400, 'Название или местоположение слишком длинное')
                }
                if (typeof updates[key] === 'string') updates[key] = updates[key].trim()
            }
            if (updates.description !== undefined && updates.description !== null &&
                (typeof updates.description !== 'string' || updates.description.length > 10000)) {
                return fail(400, 'Описание должно содержать не более 10000 символов')
            }
            if (updates.watering_interval_days !== undefined &&
                !isValidWateringInterval(updates.watering_interval_days)) {
                return fail(400, 'Интервал полива должен быть целым числом от 1 до 365 дней')
            }
            if (updates.watering_time_of_day !== undefined &&
                !Object.hasOwn(TIME_OF_DAY_HOURS, updates.watering_time_of_day)) {
                return fail(400, 'Некорректное время полива')
            }
            for (const key of ['last_watered_at', 'next_watering_at']) {
                const value = updates[key]
                if (value !== undefined && value !== null &&
                    (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
                    return fail(400, 'Некорректная дата полива')
                }
            }




            if (updates.last_watered_at && plant.created_at) {
                const lastWatered = new Date(updates.last_watered_at)
                const createdAt = new Date(plant.created_at)
                if (Number.isFinite(createdAt.getTime()) &&
                    lastWatered.getTime() < createdAt.getTime() - MISSED_GRACE_MS) {
                    return fail(400, 'Дата полива раньше создания растения')
                }
            }
            if (updates.is_active !== undefined && typeof updates.is_active !== 'boolean') {
                return fail(400, 'Некорректный статус растения')
            }
            const resumeRemindersRequested = body.resume_reminders
            if (resumeRemindersRequested !== undefined &&
                typeof resumeRemindersRequested !== 'boolean') {
                return fail(400, 'resume_reminders должно быть логическим значением')
            }
            for (const key of ['notify_morning', 'notify_day_before']) {
                if (updates[key] !== undefined && typeof updates[key] !== 'boolean') {
                    return fail(400, 'Настройки напоминаний должны быть логическими значениями')
                }
            }
            if (updates.reminder_weekdays !== undefined &&
                !isValidReminderWeekdays(updates.reminder_weekdays)) {
                return fail(400, 'Некорректные дни напоминаний')
            }

            if (body.metadata !== undefined) {
                if (!isPlainObject(body.metadata)) {
                    return fail(400, 'metadata должна быть объектом')
                }
                updates.metadata = {
                    ...sanitizePlantMetadata(plant.metadata),
                    ...withoutReservedMetadata(body.metadata)
                }
            }

            const interval = updates.watering_interval_days !== undefined
                ? updates.watering_interval_days
                : plant.watering_interval_days ?? DEFAULT_SCHEDULE_DAYS
            const timeOfDay = updates.watering_time_of_day !== undefined
                ? updates.watering_time_of_day
                : plant.watering_time_of_day ?? 'morning'
            const intervalChanged = updates.watering_interval_days !== undefined &&
                updates.watering_interval_days !== plant.watering_interval_days
            const timeChanged = updates.watering_time_of_day !== undefined &&
                updates.watering_time_of_day !== plant.watering_time_of_day
            const lastChanged = updates.last_watered_at !== undefined &&
                !sameInstant(updates.last_watered_at, plant.last_watered_at)
            const nextProvided = updates.next_watering_at !== undefined
            const nextWateringAt = updates.next_watering_at === undefined ||
                updates.next_watering_at === null
                ? null
                : new Date(updates.next_watering_at)
            const nextChanged = nextProvided &&
                !sameInstant(nextWateringAt, plant.next_watering_at)



            const reactivated = updates.is_active === true && plant.is_active === false
            const scheduleChanged = intervalChanged || timeChanged || lastChanged || nextChanged ||
                !plant.next_watering_at || reactivated

            if (scheduleChanged) {
                let resolvedNext = nextWateringAt
                if (!nextProvided) {
                    const base = updates.last_watered_at ?? plant.last_watered_at ?? plant.created_at ?? new Date()
                    resolvedNext = futureWatering(
                        computeNextWatering(base, interval, timeOfDay, timeZone),
                        interval,
                        timeOfDay,
                        timeZone
                    )
                } else if (resolvedNext && resolvedNext.getTime() <= Date.now()) {
                    resolvedNext = futureWatering(resolvedNext, interval, timeOfDay, timeZone)
                }
                if (!resolvedNext) {
                    resolvedNext = futureWatering(new Date(), interval, timeOfDay, timeZone)
                }
                updates.next_watering_at = resolvedNext
                updates.metadata = withNotificationsReset(
                    clearWateringProgress(updates.metadata ?? plant.metadata)
                )
            } else if (hasWateringProgress(updates.metadata ?? plant.metadata)) {
                const nextMetadata = clearWateringProgress(updates.metadata ?? plant.metadata)
                if (typeof plant.metadata?.missed_since === 'string' &&
                    nextMetadata.missed_since === undefined) {
                    nextMetadata.missed_since = plant.metadata.missed_since
                }
                updates.metadata = nextMetadata
            }





            if (resumeRemindersRequested === true) {
                updates.metadata = resumeRemindersMetadata(updates.metadata ?? plant.metadata)
                if (updates.next_watering_at === undefined) {
                    const currentNext = plant.next_watering_at
                        ? new Date(plant.next_watering_at)
                        : null
                    if (currentNext && Number.isFinite(currentNext.getTime()) &&
                        currentNext.getTime() <= Date.now() - MISSED_GRACE_MS) {
                        const advanced = futureWatering(currentNext, interval, timeOfDay, timeZone)
                        if (advanced && Number.isFinite(advanced.getTime())) {
                            updates.next_watering_at = advanced
                        }
                    }
                }
            }

            if (scheduleChanged || updates.reminder_weekdays !== undefined) {
                updates.reminder_weekdays = normalizeReminderWeekdays(
                    interval,
                    updates.reminder_weekdays ?? plant.reminder_weekdays,
                    updates.next_watering_at ?? plant.next_watering_at,
                    timeZone
                )
            }

            if (intervalChanged) {
                updates.metadata = resetPrediction({
                    metadata: updates.metadata ?? plant.metadata,
                    intervalDays: interval
                })
            }

            await plant.update(updates, { transaction })
            await transaction.commit()
            transaction = null

            invalidatePopularSpeciesCache()
            return res.json(plant)
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка обновления:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async delete(req, res) {
        let transaction
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

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

            const photosToRemove = await PlantPhoto.findAll({
                where: { plant_id: plant.id },
                attributes: ['url'],
                transaction
            })

            await PlantPhoto.destroy({
                where: { plant_id: plant.id },
                transaction
            })

            await WateringLog.destroy({
                where: { plant_id: plant.id },
                transaction
            })

            await plant.destroy({ transaction })
            await transaction.commit()
            transaction = null

            try {
                await removePlantPhotoFiles(photosToRemove.map(photo => photo.url))
            } catch (error) {
                console.warn('⚠️ Не удалось удалить файлы фото растения:', error?.message || error)
            }

            invalidatePopularSpeciesCache()
            return res.json({ message: 'Растение удалено' })
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback()
            }
            console.error('❌ Ошибка удаления:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }


    async getTimeline(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const timeZone = await getUserTimeZone(userId)
            const now = new Date()

            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                include: [{
                    model: PlantPhoto,
                    as: 'photos',
                    separate: true,
                    order: [['sort_order', 'ASC']]
                }]
            })

            const plantsById = new Map()
            for (const p of plants) {
                const photos = p.photos || []
                const mainPhoto =
                    photos.find(ph => ph.is_main)?.url ??
                    photos[0]?.url ??
                    null

                plantsById.set(p.id, {
                    id: p.id,
                    name: p.name,
                    species: p.species,
                    location: p.location,
                    photo_url: mainPhoto,
                    next_watering_at: p.next_watering_at,
                    watering_interval_days: p.watering_interval_days,
                    watering_time_of_day: p.watering_time_of_day,
                    metadata: p.metadata
                })
            }

            const logs = await WateringLog.findAll({
                where: {
                    user_id: userId,
                    action: { [Op.in]: ['watered', 'skipped'] },
                    plant_id: { [Op.in]: [...plantsById.keys()] }
                },
                order: [['action_at', 'DESC'], ['id', 'DESC']],
                limit: 500,
                raw: true
            })

            const groups = new Map()

            const pushEvent = (iso, event) => {
                if (!groups.has(iso)) groups.set(iso, { date: iso, events: [] })
                groups.get(iso).events.push(event)
            }

            const wateringTimesByPlant = new Map()
            for (const log of logs) {
                if (log.action !== 'watered') continue
                const at = new Date(log.action_at).getTime()
                if (!Number.isFinite(at)) continue
                const times = wateringTimesByPlant.get(log.plant_id)
                if (times) times.push(at)
                else wateringTimesByPlant.set(log.plant_id, [at])
            }

            const missResolution = (plantId, scheduledFor) =>
                findFirstWateringAfter(wateringTimesByPlant.get(plantId), scheduledFor)

            for (const plant of plantsById.values()) {
                if (!plant.next_watering_at) continue
                if (!isWateringMissed(plant.next_watering_at, { now, timeZone })) continue

                const iso = zonedDayKey(plant.next_watering_at, timeZone)
                const lateness = resolveMissedLateness(plant.next_watering_at, {
                    now,
                    wateredAt: missResolution(plant.id, plant.next_watering_at)
                }) ?? { hoursLate: 0, daysLate: 0 }
                const wateringState = buildWateringState({
                    plant,
                    now,
                    timeZone,
                    policy: resolveMissedPolicy()
                })

                pushEvent(iso, {
                    kind: 'overdue',
                    plant: {
                        id: plant.id,
                        name: plant.name,
                        species: plant.species,
                        location: plant.location,
                        photo_url: plant.photo_url
                    },
                    scheduled_for: plant.next_watering_at,
                    hours_late: lateness.hoursLate,
                    days_late: lateness.daysLate,
                    missed_since: wateringState.missed_since,
                    missed_slots: wateringState.missed_slots,
                    can_backfill: wateringState.can_backfill,
                    backfill_until: wateringState.backfill_until,
                    reason: wateringState.reason
                })
            }

            for (const log of logs) {
                const plant = plantsById.get(log.plant_id)
                if (!plant) continue

                const eventPlant = {
                    id: plant.id,
                    name: plant.name,
                    species: plant.species,
                    location: plant.location,
                    photo_url: plant.photo_url
                }

                if (log.action === 'skipped') {
                    const missedAt = new Date(log.scheduled_for ?? log.action_at)
                    if (!Number.isFinite(missedAt.getTime())) continue

                    const lateness = log.scheduled_for
                        ? resolveMissedLateness(log.scheduled_for, {
                            now,
                            wateredAt: missResolution(plant.id, log.scheduled_for)
                        })
                        : null
                    const hoursLate = lateness
                        ? lateness.hoursLate
                        : Number.isInteger(log.hours_late)
                            ? log.hours_late
                            : Math.max(0, computeHoursLate(missedAt, log.action_at) ?? 0)

                    pushEvent(zonedDayKey(missedAt, timeZone), {
                        kind: 'skipped',
                        id: log.id,
                        plant: eventPlant,
                        scheduled_for: log.scheduled_for,
                        skipped_at: log.action_at,
                        hours_late: hoursLate,
                        days_late: lateness ? lateness.daysLate : Math.floor(hoursLate / 24),
                        note: log.note
                    })
                    continue
                }

                pushEvent(zonedDayKey(log.action_at, timeZone), {
                    kind: 'watered',
                    id: log.id,
                    plant: eventPlant,
                    watered_at: log.action_at,
                    scheduled_for: log.scheduled_for,
                    hours_late: log.hours_late,
                    note: log.note
                })
            }

            const careLogs = await PlantCareLog.findAll({
                where: {
                    user_id: userId,
                    plant_id: { [Op.in]: [...plantsById.keys()] }
                },
                order: [['performed_at', 'DESC'], ['id', 'DESC']],
                limit: 300,
                raw: true
            })

            for (const log of careLogs) {
                const plant = plantsById.get(log.plant_id)
                if (!plant) continue

                pushEvent(zonedDayKey(log.performed_at, timeZone), {
                    kind: 'care',
                    action_code: log.action_code,
                    title: careTitleFor(log.action_code),
                    product_name: log.product_name ?? null,
                    dose: log.dose ?? null,
                    method: log.method ?? null,
                    log_id: log.id,
                    performed_at: log.performed_at,
                    plant: {
                        id: plant.id,
                        name: plant.name,
                        species: plant.species,
                        location: plant.location,
                        photo_url: plant.photo_url
                    }
                })
            }

            const kindOrder = { overdue: 0, skipped: 1, watered: 2 }

            const items = [...groups.values()]
                .map(g => {
                    g.events.sort((a, b) =>
                        (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)
                    )
                    return g
                })
                .sort((a, b) => b.date.localeCompare(a.date))

            const total = items.reduce((s, g) => s + g.events.length, 0)

            return res.json({
                generatedAt: now.toISOString(),
                total,
                items
            })
        } catch (error) {
            console.error('❌ Ошибка timeline:', error)
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

            const slotInput = req.body?.scheduled_for
            if (slotInput !== undefined && slotInput !== null && typeof slotInput !== 'string') {
                return res.status(400).json({ message: 'Некорректная дата полива' })
            }

            transaction = await sequelize.transaction()
            const fail = async (status, message) => {
                if (transaction && !transaction.finished) await transaction.rollback()
                transaction = null
                return res.status(status).json({ message })
            }

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId, is_active: true },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!plant) return fail(404, 'Растение не найдено')

            const now = new Date()
            const timeZone = await getUserTimeZone(userId)
            const timeOfDayHour =
                TIME_OF_DAY_HOURS[plant.watering_time_of_day] ?? TIME_OF_DAY_HOURS.morning
            const intervalDays = plant.watering_interval_days || DEFAULT_SCHEDULE_DAYS

            if (slotInput !== undefined && slotInput !== null) {
                const slot = parseWateringSlot(slotInput, timeOfDayHour, timeZone)
                if (!slot) return fail(400, 'Некорректная дата полива')
                if (slot.getTime() > now.getTime()) {
                    return fail(400, 'Нельзя отметить полив будущей датой')
                }

                const createdAt = plant.created_at ? new Date(plant.created_at) : null
                if (createdAt && Number.isFinite(createdAt.getTime()) &&
                    slot.getTime() < createdAt.getTime() - 24 * 60 * 60 * 1000) {
                    return fail(400, 'Дата полива раньше создания растения')
                }

                const plan = resolvePastWatering(slot, {
                    now,
                    lastWateredAt: plant.last_watered_at,
                    nextWateringAt: plant.next_watering_at,
                    intervalDays,
                    timeOfDayHours: timeOfDayHour,
                    timeZone
                })
                if (!plan) return fail(400, 'Некорректная дата полива')

                const slotDay = localDayRange(slot, timeZone)
                const slotLogs = await WateringLog.findAll({
                    where: {
                        plant_id: plant.id,
                        user_id: userId,
                        [Op.or]: [
                            { scheduled_for: { [Op.between]: [slotDay.from, slotDay.to] } },
                            { action_at: { [Op.between]: [slotDay.from, slotDay.to] } }
                        ]
                    },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })

                if (pickWateringLogForSlot(slotLogs, 'watered', slot, timeZone)) {
                    return fail(409, 'Полив за эту дату уже отмечен')
                }

                const skippedLog = pickWateringLogForSlot(slotLogs, 'skipped', slot, timeZone)
                const prevNextWateringAt = plant.next_watering_at

                if (skippedLog) {
                    await skippedLog.update({
                        action: 'watered',
                        action_at: plan.actionAt,
                        scheduled_for: plan.scheduledFor,
                        hours_late: plan.hoursLate,
                        note: note || null,
                        metadata: {
                            ...(skippedLog.metadata || {}),
                            prev_next_watering_at: prevNextWateringAt,
                            converted_from_skip: {
                                action_at: skippedLog.action_at,
                                scheduled_for: skippedLog.scheduled_for,
                                hours_late: skippedLog.hours_late,
                                note: skippedLog.note
                            }
                        }
                    }, { transaction })
                } else {
                    await WateringLog.create({
                        plant_id: plant.id,
                        user_id: userId,
                        action: 'watered',
                        action_at: plan.actionAt,
                        scheduled_for: plan.scheduledFor,
                        hours_late: plan.hoursLate,
                        note: note || null,
                        metadata: {
                            prev_next_watering_at: prevNextWateringAt,
                            recorded_at: now.toISOString()
                        }
                    }, { transaction })
                }

                const prediction = await recalculatePrediction({ plant, transaction, now, timeZone })
                const learnedIntervalDays = prediction?.intervalDays ?? intervalDays
                const previousNext = plant.next_watering_at ? new Date(plant.next_watering_at) : null
                const plannedNext = nextWateringInstant(
                    plan.actionAt,
                    learnedIntervalDays,
                    plant.watering_time_of_day || 'morning',
                    { timeZone }
                ) ?? plan.nextWateringAt
                const nextWateringAt = previousNext && plannedNext && previousNext > plannedNext
                    ? previousNext
                    : plannedNext
                const scheduleChanged = !previousNext || !nextWateringAt ||
                    previousNext.getTime() !== nextWateringAt.getTime()

                const plantUpdates = {
                    last_watered_at: plan.lastWateredAt,
                    next_watering_at: nextWateringAt,
                    watering_interval_days: learnedIntervalDays
                }
                const clearedProgress = clearWateringProgress(
                    prediction?.metadata ?? plant.metadata
                )
                if (scheduleChanged) {
                    plantUpdates.metadata = withNotificationsReset(clearedProgress)
                } else if (prediction || hasWateringProgress(plant.metadata)) {
                    plantUpdates.metadata = clearedProgress
                }
                if (scheduleChanged) {
                    plantUpdates.reminder_weekdays = normalizeReminderWeekdays(
                        learnedIntervalDays,
                        plant.reminder_weekdays,
                        nextWateringAt,
                        timeZone
                    )
                }

                await plant.update(plantUpdates, { transaction })
                await transaction.commit()
                transaction = null

                return res.json({
                    ...plant.toJSON(),
                    backfilled: true,
                    scheduled_for: plan.scheduledFor,
                    converted_skip: Boolean(skippedLog)
                })
            }

            const recentWatering = await WateringLog.findOne({
                where: { plant_id: plant.id, user_id: userId, action: 'watered' },
                order: [['action_at', 'DESC'], ['id', 'DESC']],
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (recentWatering &&
                now.getTime() - new Date(recentWatering.action_at).getTime() < WATERING_DUPLICATE_WINDOW_MS) {
                await transaction.commit()
                transaction = null
                return res.json({ ...plant.toJSON(), duplicate: true })
            }

            const scheduledFor = plant.next_watering_at

            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'watered',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: note || null,
                metadata: { prev_next_watering_at: scheduledFor, recorded_at: now.toISOString() }
            }, { transaction })

            const prediction = await recalculatePrediction({ plant, transaction, now, timeZone })
            const learnedIntervalDays = prediction?.intervalDays ?? intervalDays
            const nextWatering = computeNextWatering(
                now,
                learnedIntervalDays,
                plant.watering_time_of_day || 'morning',
                timeZone
            )
            const metadata = withNotificationsReset(clearWateringProgress(
                prediction?.metadata ?? plant.metadata
            ))
            const reminderWeekdays = normalizeReminderWeekdays(
                learnedIntervalDays,
                plant.reminder_weekdays,
                nextWatering,
                timeZone
            )

            await plant.update({
                last_watered_at: now,
                next_watering_at: nextWatering,
                watering_interval_days: learnedIntervalDays,
                reminder_weekdays: reminderWeekdays,
                metadata
            }, { transaction })

            await transaction.commit()
            transaction = null

            return res.json(plant)
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка полива:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async deleteWatering(req, res) {
        let transaction
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            transaction = await sequelize.transaction()
            const plant = await Plant.findOne({
                where: {
                    id: req.params.id,
                    user_id: userId,
                    is_active: true
                },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!plant) {
                await transaction.rollback()
                transaction = null
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            const timeZone = await getUserTimeZone(userId)

            const log = await WateringLog.findOne({
                where: {
                    id: req.params.logId,
                    plant_id: plant.id,
                    user_id: userId,
                    action: 'watered'
                },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!log) {
                await transaction.rollback()
                transaction = null
                return res.status(404).json({ message: 'Запись о поливе не найдена' })
            }

            const latestAction = await WateringLog.findOne({
                where: { plant_id: plant.id, user_id: userId },
                order: [['action_at', 'DESC'], ['id', 'DESC']],
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            const isLatestAction = latestAction?.id === log.id

            const hasPrevPlan = Boolean(log.metadata) &&
                Object.hasOwn(log.metadata, 'prev_next_watering_at')
            const previousPlan = hasPrevPlan
                ? log.metadata.prev_next_watering_at
                : log.scheduled_for ?? log.action_at

            const restoredSkip = isLatestAction ? log.metadata?.converted_from_skip : null

            if (restoredSkip) {
                await log.update({
                    action: 'skipped',
                    action_at: restoredSkip.action_at,
                    scheduled_for: restoredSkip.scheduled_for,
                    hours_late: restoredSkip.hours_late,
                    note: restoredSkip.note,
                    metadata: { ...(log.metadata || {}), converted_from_skip: null }
                }, { transaction })
            } else {
                await log.destroy({ transaction })
            }

            const latestWatering = await WateringLog.findOne({
                where: {
                    plant_id: plant.id,
                    user_id: userId,
                    action: 'watered'
                },
                order: [['action_at', 'DESC'], ['id', 'DESC']],
                transaction,
                lock: transaction.LOCK.UPDATE
            })

            const prediction = await recalculatePrediction({
                plant,
                transaction,
                now: new Date(),
                timeZone
            })

            const plantUpdates = {
                last_watered_at: latestWatering?.action_at ?? null
            }
            if (prediction) {
                plantUpdates.watering_interval_days = prediction.intervalDays
                plantUpdates.metadata = prediction.metadata
            }
            if (isLatestAction) {
                plantUpdates.next_watering_at = previousPlan
            }
            await plant.update(plantUpdates, { transaction })

            await transaction.commit()
            transaction = null

            return res.json({
                message: 'Запись о поливе удалена',
                scheduleRestored: isLatestAction,
                restored_skip: Boolean(restoredSkip),
                next_watering_at: isLatestAction
                    ? previousPlan
                    : plant.next_watering_at
            })
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error('❌ Ошибка удаления записи о поливе:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async listCareActions(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 })
            if (!pagination) {
                return res.status(400).json({ message: 'Параметры limit и offset должны быть целыми числами в допустимом диапазоне' })
            }
            const { limit, offset } = pagination

            const logs = await PlantCareLog.findAndCountAll({
                where: { plant_id: plant.id, user_id: userId },
                order: [['performed_at', 'DESC'], ['id', 'DESC']],
                limit,
                offset
            })

            return res.json({
                items: logs.rows.map(row => serializeCareLog(row, { plantName: plant.name })),
                total: logs.count,
                limit,
                offset
            })
        } catch (error) {
            console.error('❌ Ошибка журнала ухода:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async createCareAction(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const now = new Date()
            const normalized = normalizeCareActionPayload(req.body, { now })
            if (!normalized.ok) {
                return res.status(400).json({ message: normalized.error })
            }

            const rawNotificationId = req.body?.notification_id
            const notificationId = Number.isInteger(rawNotificationId) && rawNotificationId > 0
                ? rawNotificationId
                : null

            const log = await PlantCareLog.create({
                user_id: userId,
                plant_id: plant.id,
                action_code: normalized.value.action_code,
                product_name: normalized.value.product_name,
                dose: normalized.value.dose,
                method: normalized.value.method,
                note: normalized.value.note,
                performed_at: normalized.value.performed_at,
                notification_id: notificationId,
                metadata: {}
            })

            if (notificationId) {
                try {
                    const notification = await Notification.findOne({
                        where: { id: notificationId, user_id: userId }
                    })
                    if (notification) {
                        const payload = isPlainObject(notification.payload)
                            ? notification.payload
                            : {}
                        await notification.update({
                            read_at: notification.read_at ?? now,
                            payload: { ...payload, done_at: now.toISOString() }
                        })
                    }
                } catch (error) {
                    console.warn('⚠️ Не удалось обновить уведомление об уходе:', error?.message || error)
                }
            }

            return res.status(201).json({
                item: serializeCareLog(log, { plantName: plant.name })
            })
        } catch (error) {
            console.error('❌ Ошибка отметки ухода:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async deleteCareAction(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })
            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const log = await PlantCareLog.findOne({
                where: {
                    id: req.params.logId,
                    plant_id: plant.id,
                    user_id: userId
                }
            })
            if (!log) return res.status(404).json({ message: 'Запись ухода не найдена' })

            await log.destroy()
            return res.json({ removed: true })
        } catch (error) {
            console.error('❌ Ошибка удаления отметки ухода:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async latestCareActions(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const pagination = parsePagination(req.query, { defaultLimit: 200, maxLimit: 200 })
            if (!pagination) {
                return res.status(400).json({ message: 'Параметр limit должен быть целым числом в допустимом диапазоне' })
            }

            const logs = await PlantCareLog.findAll({
                where: { user_id: userId },
                order: [['performed_at', 'DESC'], ['id', 'DESC']],
                limit: pagination.limit,
                raw: true
            })

            const seenPlantIds = new Set()
            const items = []
            for (const log of logs) {
                if (seenPlantIds.has(log.plant_id)) continue
                seenPlantIds.add(log.plant_id)
                items.push({
                    plant_id: log.plant_id,
                    action_code: log.action_code,
                    title: careTitleFor(log.action_code),
                    product_name: log.product_name ?? null,
                    dose: log.dose ?? null,
                    performed_at: log.performed_at ?? null
                })
            }

            return res.json({ items })
        } catch (error) {
            console.error('❌ Ошибка последних действий ухода:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getCareSchedule(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const rawDays = req.query?.days
            const parsedDays = rawDays === undefined ? 90 : Number(rawDays)
            const days = Number.isInteger(parsedDays)
                ? Math.min(180, Math.max(1, parsedDays))
                : 90

            const now = new Date()
            const timeZone = await getUserTimeZone(userId)
            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                attributes: ['id', 'name', 'species'],
                order: [['id', 'ASC']]
            })
            const plantIds = plants.map(plant => plant.id)
            if (!plantIds.length) return res.json({ items: [], days })

            const planRows = await carePlanService.loadPlans(plantIds)
            const since = new Date(now.getTime() - CARE_HISTORY_DAYS * DAY_MS)
            const logs = await PlantCareLog.findAll({
                where: {
                    user_id: userId,
                    plant_id: { [Op.in]: plantIds },
                    performed_at: { [Op.gte]: since }
                },
                attributes: ['plant_id', 'action_code', 'performed_at'],
                order: [['performed_at', 'DESC']],
                raw: true
            })

            const seasonInfo = getSeasonInfo(now, timeZone)
            const schedulePlants = plants.map(plant => {
                const group = detectPlantGroup({ name: plant.name, species: plant.species })
                const plan = carePlanService.resolvePlan({
                    plant,
                    group,
                    row: planRows.get(plant.id),
                    season: seasonInfo.season,
                    now
                })
                return { id: plant.id, name: plant.name, plan }
            })

            const schedule = buildCareSchedule({ plants: schedulePlants, logs, now, days, timeZone })
            return res.json({ items: schedule.items, days })
        } catch (error) {
            console.error('❌ Ошибка расписания ухода:', error)
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
                where: { id: req.params.id, user_id: userId, is_active: true },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            if (!plant) {
                await transaction.rollback()
                transaction = null
                return res.status(404).json({ message: 'Растение не найдено' })
            }

            const timeZone = await getUserTimeZone(userId)
            const now = new Date()
            const scheduledFor = plant.next_watering_at
            const currentScheduled = scheduledFor ? new Date(scheduledFor) : null
            const base = currentScheduled && currentScheduled.getTime() > now.getTime()
                ? currentScheduled
                : now
            const hour = TIME_OF_DAY_HOURS[plant.watering_time_of_day] ?? TIME_OF_DAY_HOURS.morning
            const intervalDays = plant.watering_interval_days || DEFAULT_SCHEDULE_DAYS
            let next = zonedDayHourAfter(base, days, hour, timeZone)
            if (!next || !Number.isFinite(next.getTime())) {
                await transaction.rollback()
                transaction = null
                return res.status(400).json({ message: 'Некорректная дата следующего полива' })
            }
            if (next.getTime() <= now.getTime()) {
                next = futureWatering(next, intervalDays, plant.watering_time_of_day || 'morning', timeZone)
            }
            if (!next || !Number.isFinite(next.getTime())) {
                await transaction.rollback()
                transaction = null
                return res.status(400).json({ message: 'Некорректная дата следующего полива' })
            }

            const metadata = withNotificationsReset(clearWateringProgress(plant.metadata))

            await plant.update({
                next_watering_at: next,
                reminder_weekdays: normalizeReminderWeekdays(
                    intervalDays,
                    plant.reminder_weekdays,
                    next,
                    timeZone
                ),
                metadata
            }, { transaction })


            await WateringLog.create({
                plant_id: plant.id,
                user_id: userId,
                action: 'skipped',
                action_at: now,
                scheduled_for: scheduledFor,
                hours_late: computeHoursLate(scheduledFor, now),
                note: note || null,
                metadata: { prev_next_watering_at: scheduledFor }
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

            const pagination = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 })
            if (!pagination) {
                return res.status(400).json({ message: 'Параметры limit и offset должны быть целыми числами в допустимом диапазоне' })
            }
            const { limit, offset } = pagination

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

            const timeZone = await getUserTimeZone(userId)
            const tomorrow = zonedDayHourAfter(new Date(), 1, 0, timeZone)
            const missedCondition = sequelize.literal("(metadata->>'missed_since') IS NOT NULL")
            const plants = await Plant.findAll({
                where: {
                    user_id: userId,
                    is_active: true,
                    [Op.or]: [
                        { next_watering_at: { [Op.lt]: tomorrow } },
                        missedCondition
                    ]
                },
                order: [['next_watering_at', 'ASC']]
            })
            const now = new Date()
            const policy = resolveMissedPolicy()

            return res.json(plants.map(plant =>
                serializePlantWithWateringState(plant, { now, timeZone, policy })
            ))
        } catch (error) {
            console.error('❌ Ошибка получения нуждающихся в поливе:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async getCompletionStats(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const timeZone = await getUserTimeZone(userId)
            const plants = await Plant.findAll({
                where: { user_id: userId, is_active: true },
                attributes: ['id', 'watering_interval_days', 'created_at'],
                raw: true
            })

            const now = new Date()
            let expected = 0

            for (const p of plants) {
                const interval = p.watering_interval_days || DEFAULT_SCHEDULE_DAYS
                const created = new Date(p.created_at)
                const daysAlive = Math.max(
                    0,
                    Math.floor((now - created) / (24 * 60 * 60 * 1000))
                )
                expected += Math.floor(daysAlive / interval)
            }

            const plantIds = plants.map(p => p.id)
            let actual = 0
            let onTime = 0

            if (plantIds.length) {
                const [row] = await sequelize.query(`
                SELECT
                    COUNT(DISTINCT (plant_id, DATE(action_at AT TIME ZONE :tz))) AS count,
                    COUNT(DISTINCT (plant_id, DATE(action_at AT TIME ZONE :tz)))
                        FILTER (WHERE COALESCE(hours_late, 0) <= :grace) AS on_time
                FROM watering_logs
                WHERE user_id = :userId
                  AND action = 'watered'
                  AND plant_id IN (:plantIds)
            `, {
                    replacements: { userId, plantIds, tz: timeZone, grace: MISSED_GRACE_HOUR },
                    type: sequelize.QueryTypes.SELECT
                })

                actual = parseInt(row?.count) || 0
                onTime = parseInt(row?.on_time) || 0
            }

            const percent = expected > 0
                ? Math.min(100, Math.round((onTime / expected) * 100))
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
                onTime,
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
                COUNT(*) FILTER (WHERE action = 'watered' AND COALESCE(hours_late, 0) <= :grace) AS on_time_count,
                AVG(hours_late) FILTER (WHERE action = 'watered') AS avg_hours_late
            FROM watering_logs
            WHERE plant_id = :plantId AND user_id = :userId
        `, {
                replacements: { plantId: plant.id, userId, grace: MISSED_GRACE_HOUR },
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

            const body = req.body
            if (!isPlainObject(body)) {
                return res.status(400).json({ message: 'metadata должна быть объектом' })
            }
            if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_METADATA_BYTES) {
                return res.status(400).json({ message: 'metadata слишком большая' })
            }

            const plant = await Plant.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!plant) return res.status(404).json({ message: 'Растение не найдено' })

            const newMetadata = {
                ...sanitizePlantMetadata(plant.metadata),
                ...withoutReservedMetadata(body)
            }

            await plant.update({ metadata: newMetadata })

            return res.json(plant)
        } catch (error) {
            console.error('❌ Ошибка обновления metadata:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export { PlantController }
export default new PlantController()