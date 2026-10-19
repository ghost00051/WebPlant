import 'dotenv/config'
import { Op } from 'sequelize'
import sequelize from '../db.js'
import Plant from '../models/Plant.js'
import WateringLog from '../models/WateringLog.js'
import {
    DAY_MS,
    intervalBoundsForPlant,
    readPrediction,
    updateIntervalEstimate
} from '../utils/wateringPrediction.js'

const args = new Map(
    process.argv.slice(2).map(arg => {
        const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
        return [key, value]
    })
)

const days = Number.parseInt(args.get('days') ?? '365', 10)
const limit = Number.parseInt(args.get('limit') ?? '2000', 10)
const asJson = args.get('json') === 'true'
const sweep = args.get('sweep') !== 'false'
const onlyPlant = args.get('plant') ? Number.parseInt(args.get('plant'), 10) : null

if (!Number.isInteger(days) || days < 30 || days > 3650) {
    console.error('--days должен быть целым числом от 30 до 3650')
    process.exit(1)
}

function emptyMetrics() {
    return { count: 0, errorSum: 0, within1: 0, within2: 0 }
}

function addSample(metrics, error) {
    metrics.count += 1
    metrics.errorSum += Math.abs(error)
    if (Math.abs(error) <= 1) metrics.within1 += 1
    if (Math.abs(error) <= 2) metrics.within2 += 1
}

function summarize(metrics) {
    if (!metrics.count) return { count: 0, mae: null, within1: null, within2: null }
    return {
        count: metrics.count,
        mae: Number((metrics.errorSum / metrics.count).toFixed(2)),
        within1: Math.round((metrics.within1 / metrics.count) * 100),
        within2: Math.round((metrics.within2 / metrics.count) * 100)
    }
}

function walkForward({ plant, waterings, skips, weights }) {
    const bounds = intervalBoundsForPlant(plant)
    const stored = readPrediction(plant.metadata)
    const baseRaw = stored?.baseIntervalDays ?? plant.watering_interval_days ?? 7
    const base = Math.min(bounds.max, Math.max(bounds.min, Math.round(baseRaw)))

    let estimate = base
    const baseline = emptyMetrics()
    const adaptive = emptyMetrics()
    let early = 0
    let withSkips = 0

    for (let index = 1; index < waterings.length; index += 1) {
        const previous = waterings[index - 1].getTime()
        const current = waterings[index].getTime()
        const gapDays = Math.round((current - previous) / DAY_MS)
        if (gapDays < 1 || gapDays > 60) continue

        const skippedBetween = skips.some(skip => skip.getTime() >= previous && skip.getTime() < current)
        if (skippedBetween) withSkips += 1
        if (gapDays < estimate - 1) early += 1

        if (!skippedBetween) {
            addSample(baseline, gapDays - base)
            addSample(adaptive, gapDays - Math.round(estimate))
        }

        const updated = updateIntervalEstimate({
            estimateDays: estimate,
            gapDays,
            skipped: skippedBetween,
            bounds,
            weights
        })
        estimate = updated.estimateDays
    }

    return {
        base,
        baseline,
        adaptive,
        early,
        withSkips,
        gaps: waterings.length - 1
    }
}

function pickWeights(entries) {
    const grid = []
    for (const early of [0.2, 0.3, 0.35, 0.5]) {
        for (const late of [0, 0.1, 0.2, 0.3]) grid.push({ early, late })
    }

    let best = null
    for (const weights of grid) {
        const adaptive = emptyMetrics()
        for (const entry of entries) {
            const result = walkForward({ ...entry, weights })
            const { count, errorSum, within1, within2 } = result.adaptive
            adaptive.count += count
            adaptive.errorSum += errorSum
            adaptive.within1 += within1
            adaptive.within2 += within2
        }
        const summary = summarize(adaptive)
        if (!summary.count) continue
        if (!best || summary.mae < best.mae) best = { ...weights, ...summary }
    }
    return best
}

async function main() {
    await sequelize.authenticate()

    const since = new Date(Date.now() - days * DAY_MS)
    const plants = await Plant.findAll({
        attributes: ['id', 'user_id', 'name', 'species', 'watering_interval_days', 'metadata'],
        ...(onlyPlant ? { where: { id: onlyPlant } } : {}),
        limit
    })

    const logs = await WateringLog.findAll({
        where: {
            action_at: { [Op.gte]: since },
            ...(onlyPlant ? { plant_id: onlyPlant } : {})
        },
        attributes: ['plant_id', 'action', 'action_at'],
        order: [['action_at', 'ASC'], ['id', 'ASC']],
        raw: true
    })

    const byPlant = new Map()
    for (const log of logs) {
        if (!byPlant.has(log.plant_id)) byPlant.set(log.plant_id, { waterings: [], skips: [] })
        const bucket = byPlant.get(log.plant_id)
        if (log.action === 'watered') bucket.waterings.push(new Date(log.action_at))
        else if (log.action === 'skipped') bucket.skips.push(new Date(log.action_at))
    }

    const entries = []
    for (const plant of plants) {
        const bucket = byPlant.get(plant.id)
        if (!bucket || bucket.waterings.length < 2) continue
        entries.push({
            plant,
            waterings: bucket.waterings,
            skips: bucket.skips
        })
    }

    if (!entries.length) {
        console.log(`Нет данных для анализа за ${days} дн. (нужно минимум 2 полива на растение)`)
        await sequelize.close()
        return
    }

    const baseline = emptyMetrics()
    const adaptive = emptyMetrics()
    let gaps = 0
    let early = 0
    let withSkips = 0

    for (const entry of entries) {
        const result = walkForward(entry)
        baseline.count += result.baseline.count
        baseline.errorSum += result.baseline.errorSum
        baseline.within1 += result.baseline.within1
        baseline.within2 += result.baseline.within2
        adaptive.count += result.adaptive.count
        adaptive.errorSum += result.adaptive.errorSum
        adaptive.within1 += result.adaptive.within1
        adaptive.within2 += result.adaptive.within2
        gaps += result.gaps
        early += result.early
        withSkips += result.withSkips
    }

    const report = {
        periodDays: days,
        plants: entries.length,
        gaps,
        cleanGaps: baseline.count,
        gapsWithAutoSkip: withSkips,
        earlyShare: gaps ? Math.round((early / gaps) * 100) : 0,
        baseline: summarize(baseline),
        adaptive: summarize(adaptive),
        bestWeights: sweep && entries.length <= 500 ? pickWeights(entries) : null
    }

    if (asJson) {
        console.log(JSON.stringify(report, null, 2))
        await sequelize.close()
        return
    }

    console.log(`Период: последние ${days} дн., растений с историей: ${entries.length}, интервалов: ${gaps}`)
    console.log(`Чистых интервалов (без автоскипов): ${report.cleanGaps}, с автоскипами: ${withSkips}, ранних поливов: ${report.earlyShare}%`)
    console.log('')
    console.log('Модель                 MAE, дн   в ±1 дн   в ±2 дн')
    console.log(`Текущий интервал       ${String(report.baseline.mae).padStart(6)}   ${String(report.baseline.within1).padStart(6)}%   ${String(report.baseline.within2).padStart(6)}%`)
    console.log(`Адаптивный             ${String(report.adaptive.mae).padStart(6)}   ${String(report.adaptive.within1).padStart(6)}%   ${String(report.adaptive.within2).padStart(6)}%`)

    if (report.bestWeights) {
        const { early: earlyWeight, late: lateWeight, mae, within1 } = report.bestWeights
        console.log('')
        console.log(`Лучшие веса на этих данных: early=${earlyWeight}, late=${lateWeight} → MAE ${mae} дн., в ±1 дн. ${within1}%`)
    }

    await sequelize.close()
}

main().catch(async error => {
    console.error('Ошибка аудита:', error?.message || error)
    try {
        await sequelize.close()
    } catch {}
    process.exit(1)
})
