export const HEALTH_CHECK_METADATA_KEY = 'health_check'

export const HEALTH_CHECK_QUESTION_MAX_LENGTH = 500

export const HEALTH_CHECK_MESSAGES = Object.freeze({
    UNAVAILABLE: 'Сервис проверки здоровья временно недоступен',
    UNSUPPORTED_IMAGE: 'Не удалось прочитать изображение. Попробуйте JPEG или PNG.',
    BUDGET: 'На сегодня лимит анализа фото исчерпан — попробуйте позже 🌱',
    FAILED: 'Не удалось проанализировать фото. Попробуйте позже.',
    NO_IMAGE: 'Загрузите фото растения или укажите photoUrl',
    INVALID_PHOTO_URL: 'Некорректная ссылка на фото растения',
    PHOTO_NOT_UPLOADED: 'Фотография должна быть предварительно загружена на сервер'
})

const UNSUPPORTED_IMAGE_CODES = new Set([
    'AI_VISION_UNSUPPORTED_IMAGE',
    'AI_VISION_NO_IMAGE',
    'CHAT_PHOTO_EMPTY',
    'CHAT_PHOTO_UNSUPPORTED'
])

const UNAVAILABLE_CODES = new Set([
    'AI_VISION_UNAVAILABLE',
    'AI_VISION_NOT_CONFIGURED',
    'AI_VISION_FAILED',
    'CHAT_PHOTO_UNAVAILABLE'
])

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toIso(value, fallback) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : fallback
    }
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value)
        if (Number.isFinite(date.getTime())) return date.toISOString()
    }
    return fallback
}

export function normalizeHealthCheckQuestion(value) {
    if (value === undefined || value === null) return { ok: true, question: '' }
    if (typeof value !== 'string') return { ok: false, question: '' }
    return {
        ok: true,
        question: value.trim().slice(0, HEALTH_CHECK_QUESTION_MAX_LENGTH)
    }
}

export function buildHealthCheckRecord({ text, diagnosis, photoUrl, createdAt } = {}) {
    return {
        text: typeof text === 'string' ? text : '',
        diagnosis: isPlainObject(diagnosis) ? diagnosis : null,
        photoUrl: typeof photoUrl === 'string' ? photoUrl : '',
        createdAt: toIso(createdAt, new Date().toISOString())
    }
}

export function buildHealthCheckResponse(record) {
    const safe = buildHealthCheckRecord(record)
    return {
        text: safe.text,
        diagnosis: safe.diagnosis,
        photoUrl: safe.photoUrl,
        createdAt: safe.createdAt,
        saved: true
    }
}

export function mergePlantHealthCheck(metadata, record) {
    const next = isPlainObject(metadata) ? { ...metadata } : {}
    next[HEALTH_CHECK_METADATA_KEY] = buildHealthCheckRecord(record)
    return next
}

export function mergePhotoDiagnosisMetadata(metadata, { diagnosis, text } = {}) {
    const next = isPlainObject(metadata) ? { ...metadata } : {}
    next.diagnosis = isPlainObject(diagnosis) ? diagnosis : null
    next.diagnosis_text = typeof text === 'string' ? text : ''
    return next
}

export function mapVisionErrorResponse(error, {
    unavailableMessage = HEALTH_CHECK_MESSAGES.UNAVAILABLE
} = {}) {
    const code = typeof error?.code === 'string' ? error.code : ''

    if (UNSUPPORTED_IMAGE_CODES.has(code)) {
        return { status: 400, message: HEALTH_CHECK_MESSAGES.UNSUPPORTED_IMAGE }
    }
    if (code === 'AI_BUDGET_EXCEEDED') {
        return { status: 503, message: HEALTH_CHECK_MESSAGES.BUDGET }
    }
    if (UNAVAILABLE_CODES.has(code)) {
        return { status: 503, message: unavailableMessage }
    }
    return { status: 500, message: HEALTH_CHECK_MESSAGES.FAILED }
}

export default {
    HEALTH_CHECK_MESSAGES,
    HEALTH_CHECK_METADATA_KEY,
    HEALTH_CHECK_QUESTION_MAX_LENGTH,
    buildHealthCheckRecord,
    buildHealthCheckResponse,
    mapVisionErrorResponse,
    mergePhotoDiagnosisMetadata,
    mergePlantHealthCheck,
    normalizeHealthCheckQuestion
}
