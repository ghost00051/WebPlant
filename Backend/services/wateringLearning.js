import { Op } from 'sequelize'
import WateringLog from '../models/WateringLog.js'
import { appTimeZone } from '../utils/localDay.js'
import {
    MAX_WATERING_SAMPLES,
    PREDICTION_METADATA_KEY,
    buildPrediction,
    buildPredictionMetadata
} from '../utils/wateringPrediction.js'

const LOOKBACK_DAYS = 400
const MAX_SKIP_LOGS = 200
const DAY_MS = 24 * 60 * 60 * 1000

async function loadWaterings({ plant, transaction, since }) {
    const rows = await WateringLog.findAll({
        where: {
            plant_id: plant.id,
            user_id: plant.user_id,
            action: 'watered',
            action_at: { [Op.gte]: since }
        },
        attributes: ['action_at'],
        order: [['action_at', 'DESC'], ['id', 'DESC']],
        limit: MAX_WATERING_SAMPLES,
        transaction,
        raw: true
    })
    return rows.map(row => row.action_at).reverse()
}

async function loadSkips({ plant, transaction, since }) {
    const rows = await WateringLog.findAll({
        where: {
            plant_id: plant.id,
            user_id: plant.user_id,
            action: 'skipped',
            action_at: { [Op.gte]: since }
        },
        attributes: ['action_at'],
        order: [['action_at', 'DESC'], ['id', 'DESC']],
        limit: MAX_SKIP_LOGS,
        transaction,
        raw: true
    })
    return rows.map(row => row.action_at).reverse()
}

export async function recalculatePrediction({
    plant,
    transaction = null,
    now = new Date(),
    timeZone = appTimeZone()
} = {}) {
    if (!plant || !plant.id || !plant.user_id) return null

    const stored = plant.metadata?.[PREDICTION_METADATA_KEY]
    const baseChangedAt = stored?.baseChangedAt ? new Date(stored.baseChangedAt) : null
    const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)
    const since = baseChangedAt && baseChangedAt > lookbackStart ? baseChangedAt : lookbackStart

    const [waterings, skips] = await Promise.all([
        loadWaterings({ plant, transaction, since }),
        loadSkips({ plant, transaction, since })
    ])

    const result = buildPrediction({ plant, waterings, skips, now, timeZone })

    return {
        ...result,
        metadata: buildPredictionMetadata(plant.metadata, result.prediction)
    }
}

export function resetPrediction({ metadata, intervalDays } = {}) {
    const value = Number.isInteger(intervalDays) && intervalDays > 0
        ? intervalDays
        : 7

    return buildPredictionMetadata(metadata, {
        baseIntervalDays: value,
        intervalDays: value,
        samples: 0,
        lastObservedAt: null,
        baseChangedAt: new Date().toISOString()
    })
}
