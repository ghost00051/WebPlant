import AiAdviceLog from '../models/AiAdviceLog.js'

const MAX_TEXT = 255
const ADVICE_KINDS = ['species', 'watering', 'time']
const ADVICE_SOURCES = ['ai', 'cache', 'fallback']

function trimText(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, MAX_TEXT) : null
}

function toInteger(value) {
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : null
}

export function normalizeAdviceSource(value) {
    return ADVICE_SOURCES.includes(value) ? value : 'ai'
}

export function buildAdviceLogRow(entry = {}) {
    if (!ADVICE_KINDS.includes(entry.kind)) return null

    return {
        user_id: toInteger(entry.userId),
        kind: entry.kind,
        plant_name: trimText(entry.plantName),
        species: trimText(entry.species),
        season: trimText(entry.season),
        result_type: trimText(entry.resultType),
        interval_days: toInteger(entry.intervalDays),
        time_of_day: trimText(entry.timeOfDay),
        confidence: trimText(entry.confidence),
        questions_asked: toInteger(entry.questionsAsked) ?? 0,
        source: normalizeAdviceSource(entry.source),
        latency_ms: toInteger(entry.latencyMs)
    }
}

export function logAiAdvice(entry = {}) {
    const row = buildAdviceLogRow(entry)
    if (!row) return null

    return AiAdviceLog.create(row).catch(error => {
        console.warn('⚠️ Не удалось записать журнал подсказок ИИ:', error?.message || error)
        return null
    })
}
