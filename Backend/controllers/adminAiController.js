import { fn, col } from 'sequelize'
import AiAdviceLog from '../models/AiAdviceLog.js'
import User from '../models/userModels.js'
import '../models/associations.js'
import { getAiCacheStats } from '../utils/aiCache.js'
import {
    AI_SCOPE_LABELS,
    readAiMetricsRange
} from '../utils/aiMetrics.js'
import { getMaxAdviceQuestions } from '../services/aiService.js'

const MAX_DAYS = 90
const MAX_LIMIT = 100
const ADVICE_KINDS = ['species', 'watering', 'time']
const ADVICE_KIND_LABELS = {
    species: 'Определение вида',
    watering: 'Частота полива',
    time: 'Время полива'
}
const SOURCE_LABELS = {
    ai: 'модель',
    cache: 'кэш',
    fallback: 'запасной вариант',
    unknown: 'не указан'
}

function parseDays(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed)) return 7
    return Math.min(Math.max(parsed, 1), MAX_DAYS)
}

function parseLimit(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed)) return 50
    return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function parseOffset(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed < 0) return 0
    return parsed
}

function compactSeries(series) {
    return series.map(day => ({
        day: day.day,
        requests: day.totals.requests,
        errors: day.totals.errors,
        timeouts: day.totals.timeouts,
        cacheHits: day.totals.cacheHits,
        cacheMisses: day.totals.cacheMisses,
        tokensIn: day.totals.tokensIn,
        tokensOut: day.totals.tokensOut,
        avgLatencyMs: day.derived.avgLatencyMs
    }))
}

async function getMetrics(req, res) {
    try {
        const days = parseDays(req.query.days)
        const metrics = await readAiMetricsRange({ days })

        const config = {
            chatTimeoutMs: Number.parseInt(process.env.AI_CHAT_TIMEOUT_MS, 10) || 20_000,
            adviceTimeoutMs: Number.parseInt(process.env.AI_ADVICE_TIMEOUT_MS, 10) || 15_000,
            chatDeadlineMs: Number.parseInt(process.env.AI_CHAT_DEADLINE_MS, 10) || null,
            adviceDeadlineMs: Number.parseInt(process.env.AI_ADVICE_DEADLINE_MS, 10) || null,
            dailyBudget: metrics.budget.limit,
            maxAdviceQuestions: getMaxAdviceQuestions(),
            priceConfigured: Boolean(metrics.summary.cost)
        }

        return res.json({
            days: metrics.days,
            generatedAt: metrics.generatedAt,
            summary: metrics.summary,
            series: compactSeries(metrics.series),
            budget: metrics.budget,
            scopes: AI_SCOPE_LABELS,
            cache: getAiCacheStats(),
            config
        })
    } catch (error) {
        console.error('❌ Ошибка телеметрии ИИ:', error)
        return res.status(500).json({ message: 'Не удалось собрать телеметрию ИИ' })
    }
}

async function getLogs(req, res) {
    const kind = ADVICE_KINDS.includes(req.query.kind) ? req.query.kind : null
    const limit = parseLimit(req.query.limit)
    const offset = parseOffset(req.query.offset)
    const where = kind ? { kind } : {}

    try {
        const [total, rows, kindRows] = await Promise.all([
            AiAdviceLog.count({ where }),
            AiAdviceLog.findAll({
                where,
                limit,
                offset,
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                include: [{ model: User, attributes: ['id', 'email', 'username'] }]
            }),
            AiAdviceLog.findAll({
                attributes: ['kind', [fn('count', col('id')), 'count']],
                group: ['kind'],
                raw: true
            })
        ])

        const byKind = Object.fromEntries(ADVICE_KINDS.map(item => [item, 0]))
        for (const row of kindRows) {
            if (row.kind in byKind) byKind[row.kind] = Number(row.count) || 0
        }

        return res.json({
            total,
            limit,
            offset,
            kind,
            byKind,
            kindLabels: ADVICE_KIND_LABELS,
            sourceLabels: SOURCE_LABELS,
            items: rows.map(row => ({
                id: row.id,
                kind: row.kind,
                kindLabel: ADVICE_KIND_LABELS[row.kind] || row.kind,
                plantName: row.plant_name,
                species: row.species,
                season: row.season,
                resultType: row.result_type,
                intervalDays: row.interval_days,
                timeOfDay: row.time_of_day,
                confidence: row.confidence,
                questionsAsked: row.questions_asked,
                source: row.source,
                sourceLabel: SOURCE_LABELS[row.source] || row.source,
                latencyMs: row.latency_ms,
                createdAt: row.created_at,
                user: row.user
                    ? { id: row.user.id, email: row.user.email, username: row.user.username }
                    : null
            }))
        })
    } catch (error) {
        console.error('❌ Ошибка журнала подсказок ИИ:', error)
        
        if (error?.original?.code === '42P01' || /does not exist/i.test(String(error?.message))) {
            return res.json({
                total: 0,
                limit,
                offset,
                kind,
                byKind: Object.fromEntries(ADVICE_KINDS.map(item => [item, 0])),
                kindLabels: ADVICE_KIND_LABELS,
                sourceLabels: SOURCE_LABELS,
                items: [],
                pendingMigration: true
            })
        }
        return res.status(500).json({ message: 'Не удалось прочитать журнал подсказок' })
    }
}

export default { getMetrics, getLogs }
