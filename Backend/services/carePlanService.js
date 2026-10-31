import { Op } from 'sequelize'
import PlantCarePlan from '../models/PlantCarePlan.js'
import { suggestCarePlan } from './aiService.js'
import { buildDefaultCarePlan, CARE_KNOWLEDGE_VERSION, sanitizeCarePlan } from '../utils/careKnowledge.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PLAN_AGE_DAYS = 90

class CarePlanService {
    isFresh(row, season, now = new Date()) {
        if (!row || !row.plan || typeof row.plan !== 'object') return false
        const actionKeys = Object.keys(row.plan).filter(key => key !== '_version')
        if (!actionKeys.length) return false
        if (row.plan._version !== CARE_KNOWLEDGE_VERSION) return false
        if (row.season !== season) return false

        const generatedAt = row.generated_at ? new Date(row.generated_at).getTime() : NaN
        if (!Number.isFinite(generatedAt)) return false

        const age = now.getTime() - generatedAt
        const maxAge = row.source === 'default'
            ? DAY_MS
            : MAX_PLAN_AGE_DAYS * DAY_MS
        return age >= 0 && age < maxAge
    }

    resolvePlan({ plant, group, row = null, season, now = new Date() } = {}) {
        if (row && this.isFresh(row, season, now)) {
            return sanitizeCarePlan(row.plan, { plant, group })
        }
        return buildDefaultCarePlan({ plant, group })
    }

    async loadPlans(plantIds = []) {
        const ids = [...new Set(plantIds)].filter(id => Number.isInteger(id))
        if (!ids.length) return new Map()

        const rows = await PlantCarePlan.findAll({
            where: { plant_id: { [Op.in]: ids } }
        })
        return new Map(rows.map(row => [row.plant_id, row]))
    }

    async getOrCreatePlan({ plant, group, seasonInfo, careHints = null, timeZone, now = new Date() }) {
        if (!plant) return null

        const existing = await PlantCarePlan.findOne({ where: { plant_id: plant.id } })
        if (existing && this.isFresh(existing, seasonInfo?.season, now)) {
            return existing.plan
        }

        const generated = await suggestCarePlan({
            plant,
            group,
            seasonInfo,
            careHints,
            timeZone,
            now
        })
        const plan = generated?.plan && Object.keys(generated.plan).length
            ? generated.plan
            : buildDefaultCarePlan({ plant, group })

        await PlantCarePlan.upsert({
            plant_id: plant.id,
            plan: { ...plan, _version: CARE_KNOWLEDGE_VERSION },
            source: generated?.source || 'default',
            season: seasonInfo?.season || null,
            model: generated?.model || null,
            generated_at: now
        })

        return plan
    }
}

export default new CarePlanService()
