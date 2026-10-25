import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import PlantCareLog from '../models/PlantCareLog.js'
import Notification from '../models/Notification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import {
    storeNotification,
    sendNotificationPush
} from './notificationService.js'
import { suggestCareAdvice } from './aiService.js'
import carePlanService from './carePlanService.js'
import {
    buildDefaultCarePlan,
    CARE_NOTIFICATION_TYPES,
    getCareCandidates
} from '../utils/careKnowledge.js'
import { diffLocalDays, localDayKey } from '../utils/localDay.js'
import { isRemindersPaused } from '../utils/plantMetadata.js'
import { logAiAdvice } from '../utils/aiAdviceLog.js'
import { detectPlantGroup, getSeasonInfo } from '../utils/wateringKnowledge.js'

const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 35
const MAX_PLANTS_PER_USER = 100
const MAX_HISTORY_ROWS = 200
const MAX_PLAN_GENERATIONS_PER_RUN = 3
const DEFAULT_TIME_ZONE = 'Europe/Moscow'

function parseLimit(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

class CareAdviceService {
    async sendDailyAdvicesForUser({ userId, now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
        const dayKey = localDayKey(now, timeZone)
        if (!Number.isInteger(userId) || userId < 1 || !dayKey) {
            return { generated: 0, skipped: 'invalid-input' }
        }

        const [preference] = await NotificationPreference.findOrCreate({
            where: { user_id: userId },
            defaults: { care_advice_enabled: true }
        })
        if (preference.care_advice_enabled !== true) {
            return { generated: 0, skipped: 'disabled' }
        }
        if (preference.last_care_advice_date === dayKey) {
            return { generated: 0, skipped: 'already-ran' }
        }

        const dailyLimit = parseLimit(process.env.CARE_ADVICE_DAILY_LIMIT, 2)
        const weeklyLimit = parseLimit(process.env.CARE_ADVICE_WEEKLY_LIMIT, 5)
        const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS)

        const [plants, notifications, careLogs] = await Promise.all([
            Plant.findAll({
                where: { user_id: userId, is_active: true },
                order: [['id', 'ASC']],
                limit: MAX_PLANTS_PER_USER
            }),
            Notification.findAll({
                where: {
                    user_id: userId,
                    type: { [Op.in]: CARE_NOTIFICATION_TYPES },
                    created_at: { [Op.gte]: since }
                },
                attributes: ['id', 'plant_id', 'type', 'payload', 'created_at'],
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                limit: MAX_HISTORY_ROWS
            }),
            PlantCareLog.findAll({
                where: {
                    user_id: userId,
                    performed_at: { [Op.gte]: since }
                },
                attributes: ['plant_id', 'action_code', 'performed_at'],
                order: [['performed_at', 'DESC'], ['id', 'DESC']],
                limit: MAX_HISTORY_ROWS,
                raw: true
            })
        ])

        const history = [
            ...notifications.map(item => ({
                plantId: item.plant_id,
                actionCode: typeof item.payload?.action_code === 'string' ? item.payload.action_code : null,
                title: typeof item.payload?.action_title === 'string' ? item.payload.action_title : null,
                createdAt: item.created_at
            })),
            ...careLogs.map(item => ({
                plantId: item.plant_id,
                actionCode: item.action_code,
                createdAt: item.performed_at
            }))
        ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))

        const weekBoundary = now.getTime() - 7 * DAY_MS
        const weekCount = history.filter(
            item => new Date(item.createdAt).getTime() >= weekBoundary
        ).length
        const dailyCount = history.filter(
            item => localDayKey(item.createdAt, timeZone) === dayKey
        ).length

        const planRows = await carePlanService.loadPlans(plants.map(plant => plant.id))
        const eligible = []
        for (const plant of plants) {
            if (isRemindersPaused(plant.metadata)) continue

            const wateringDiff = diffLocalDays(plant.next_watering_at, now, timeZone)
            if (wateringDiff !== null && wateringDiff <= 1) continue

            const seasonInfo = getSeasonInfo(now, timeZone)
            const group = detectPlantGroup({ name: plant.name, species: plant.species })
            const storedPlan = planRows.get(plant.id)
            const hasFreshPlan = storedPlan && carePlanService.isFresh(storedPlan, seasonInfo.season, now)
            const plan = hasFreshPlan ? storedPlan.plan : buildDefaultCarePlan({ plant, group })

            const result = getCareCandidates({ plant, history, now, timeZone, plan })
            if (!result.candidates.length) continue
            eligible.push({ plant, plan, needsAiPlan: !hasFreshPlan, ...result })
        }

        if (!eligible.length) {
            await preference.update({ last_care_advice_date: dayKey })
            return { generated: 0, skipped: 'no-candidates' }
        }

        const dayNumber = Math.floor(new Date(`${dayKey}T00:00:00Z`).getTime() / DAY_MS)
        const startIndex = dayNumber % eligible.length
        const ordered = [...eligible.slice(startIndex), ...eligible.slice(0, startIndex)]

        let generated = 0
        let planGenerations = 0
        for (const item of ordered) {
            if (dailyCount + generated >= dailyLimit) break
            if (weekCount + generated >= weeklyLimit) break

            const { plant, seasonInfo, group, needsAiPlan } = item
            let candidates = item.candidates
            const plantHistory = history.filter(
                entry => Number(entry.plantId) === Number(plant.id)
            )

            if (needsAiPlan && planGenerations < MAX_PLAN_GENERATIONS_PER_RUN) {
                planGenerations += 1
                const plan = await carePlanService.getOrCreatePlan({
                    plant,
                    group,
                    seasonInfo,
                    careHints: plant.metadata?.care_hints || null,
                    timeZone,
                    now
                })
                candidates = getCareCandidates({ plant, history, now, timeZone, plan }).candidates
                if (!candidates.length) continue
            }

            const advice = await suggestCareAdvice({
                plant,
                candidates,
                recentAdvice: plantHistory,
                careHints: plant.metadata?.care_hints || null,
                seasonInfo,
                group,
                timeZone,
                now
            })

            if (!advice || advice.decision !== 'recommend') {
                logAiAdvice({
                    userId,
                    kind: 'care',
                    plantName: plant.name,
                    species: plant.species,
                    season: seasonInfo?.season,
                    resultType: 'skip',
                    confidence: advice?.confidence,
                    source: advice?.source,
                    latencyMs: advice?.latencyMs
                })
                continue
            }

            const action = candidates.find(candidate => candidate.code === advice.actionCode)
            if (!action) continue

            const dedupeKey = `care:${plant.id}:${dayKey}:${action.code}`
            const { notification, created } = await storeNotification({
                userId,
                plantId: plant.id,
                type: action.notificationType || 'care_reminder',
                title: advice.title,
                body: advice.body,
                url: `/my-plants?plant=${plant.id}`,
                dedupeKey,
                scheduledFor: now,
                payload: {
                    action_code: action.code,
                    action_title: action.title,
                    topic: action.topic,
                    confidence: advice.confidence,
                    source: advice.source,
                    why_now: advice.whyNow || null
                }
            })

            if (!created) continue

            logAiAdvice({
                userId,
                kind: 'care',
                plantName: plant.name,
                species: plant.species,
                season: seasonInfo?.season,
                resultType: 'recommendation',
                confidence: advice.confidence,
                source: advice.source,
                latencyMs: advice.latencyMs
            })

            await sendNotificationPush({
                userId,
                title: advice.title,
                body: advice.body,
                data: {
                    plantId: plant.id,
                    url: `/my-plants?plant=${plant.id}`,
                    tag: `care_${action.code}`,
                    notificationId: notification.id
                }
            })

            generated += 1
        }

        await preference.update({ last_care_advice_date: dayKey })

        console.log(
            `🌿 Советы по уходу: пользователь ${userId}, отправлено ${generated}, ` +
            `кандидатов ${eligible.length}, день ${dayKey}`
        )

        return { generated, skipped: null, date: dayKey }
    }
}

export default new CareAdviceService()
