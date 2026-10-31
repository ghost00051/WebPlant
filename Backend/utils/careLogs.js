export const CARE_ACTION_CODES = [
    'fertilize',
    'spray',
    'leaf_clean',
    'rotate',
    'pest_check',
    'humidity_support'
]

export const CARE_ACTION_TITLES = {
    fertilize: 'Подкормка',
    spray: 'Опрыскивание',
    leaf_clean: 'Протирание листьев',
    rotate: 'Поворот к свету',
    pest_check: 'Осмотр на вредителей',
    humidity_support: 'Влажность воздуха'
}

export const CARE_METHODS = ['spray_bottle', 'humidifier']

export const DEFAULT_CARE_METHOD = 'spray_bottle'

const MAX_PRODUCT_NAME_LENGTH = 160
const MAX_DOSE_LENGTH = 120
const MAX_NOTE_LENGTH = 500
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

export function careTitleFor(code) {
    return CARE_ACTION_TITLES[code] ?? null
}

function normalizeOptionalText(value, { maxLength, invalidError, tooLongError }) {
    if (value === undefined || value === null) return { ok: true, value: null }
    if (typeof value !== 'string') return { ok: false, error: invalidError }
    const trimmed = value.trim()
    if (!trimmed) return { ok: true, value: null }
    if (trimmed.length > maxLength) return { ok: false, error: tooLongError }
    return { ok: true, value: trimmed }
}

function normalizePerformedAt(value, now) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: now }
    }

    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    if (!Number.isFinite(date.getTime())) {
        return { ok: false, error: 'Некорректная дата выполнения ухода' }
    }
    if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
        return { ok: false, error: 'Нельзя отметить уход будущей датой' }
    }
    if (date.getTime() < now.getTime() - MAX_AGE_MS) {
        return { ok: false, error: 'Дата ухода должна быть не старше 365 дней' }
    }
    return { ok: true, value: date }
}

function normalizeMethod(actionCode, value) {
    if (actionCode !== 'spray') return { ok: true, value: null }
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: DEFAULT_CARE_METHOD }
    }
    if (typeof value !== 'string' || !CARE_METHODS.includes(value.trim())) {
        return { ok: false, error: 'Некорректный способ опрыскивания' }
    }
    return { ok: true, value: value.trim() }
}

export function normalizeCareActionPayload(body, { now = new Date() } = {}) {
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
    const actionCode = typeof source.action_code === 'string' ? source.action_code.trim() : ''

    if (!actionCode) return { ok: false, error: 'Выберите действие ухода' }
    if (!CARE_ACTION_CODES.includes(actionCode)) {
        return { ok: false, error: 'Некорректное действие ухода' }
    }

    const productName = normalizeOptionalText(source.product_name, {
        maxLength: MAX_PRODUCT_NAME_LENGTH,
        invalidError: 'Некорректное название средства',
        tooLongError: 'Название средства должно содержать не более 160 символов'
    })
    if (!productName.ok) return productName
    if (actionCode === 'fertilize' && !productName.value) {
        return { ok: false, error: 'Укажите средство для подкормки' }
    }

    const dose = normalizeOptionalText(source.dose, {
        maxLength: MAX_DOSE_LENGTH,
        invalidError: 'Некорректная дозировка',
        tooLongError: 'Дозировка должна содержать не более 120 символов'
    })
    if (!dose.ok) return dose

    const note = normalizeOptionalText(source.note, {
        maxLength: MAX_NOTE_LENGTH,
        invalidError: 'Некорректное примечание',
        tooLongError: 'Примечание должно содержать не более 500 символов'
    })
    if (!note.ok) return note

    const method = normalizeMethod(actionCode, source.method)
    if (!method.ok) return method

    const performedAt = normalizePerformedAt(source.performed_at, now)
    if (!performedAt.ok) return performedAt

    return {
        ok: true,
        value: {
            action_code: actionCode,
            product_name: productName.value,
            dose: dose.value,
            method: method.value,
            note: note.value,
            performed_at: performedAt.value
        }
    }
}

function toIsoString(value) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) return null
    return date.toISOString()
}

export function serializeCareLog(row, { plantName = null } = {}) {
    const source = row || {}
    const actionCode = typeof source.action_code === 'string' ? source.action_code : null

    return {
        id: source.id ?? null,
        plant_id: source.plant_id ?? null,
        plant_name: plantName ?? null,
        action_code: actionCode,
        title: careTitleFor(actionCode),
        product_name: source.product_name ?? null,
        dose: source.dose ?? null,
        method: source.method ?? null,
        note: source.note ?? null,
        performed_at: toIsoString(source.performed_at),
        created_at: toIsoString(source.created_at)
    }
}
