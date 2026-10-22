import { parseVisitPath, parseVisitorId } from './adminAnalytics.js'

export const MAX_EVENTS_PER_BATCH = 20
export const MAX_PROPS_BYTES = 2048
export const MAX_PATH_LENGTH = 300

export const ALLOWED_EVENTS = Object.freeze([
    'landing_view',
    'register',
    'plant_created',
    'watering_marked',
    'push_subscribed',
    'chat_message',
    'photo_added',
    'plant_id_started',
    'plant_id_success',
    'share_clicked'
])

const ALLOWED_EVENT_SET = new Set(ALLOWED_EVENTS)

const PII_EXACT_KEYS = new Set(['email', 'phone', 'name', 'password', 'token'])
const PII_KEY_ENDINGS = ['email', 'phone', 'password', 'token']
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function normalizePropKey(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isAllowedEvent(event) {
    return typeof event === 'string' && ALLOWED_EVENT_SET.has(event)
}

export function isForbiddenPropKey(key) {
    const normalized = normalizePropKey(key)
    if (!normalized) return false
    if (PII_EXACT_KEYS.has(normalized)) return true
    return PII_KEY_ENDINGS.some(ending =>
        normalized.endsWith(ending) || normalized.startsWith(ending)
    )
}

function isPrimitivePropValue(value) {
    if (value === null) return true
    const type = typeof value
    if (type === 'string' || type === 'boolean') return true
    if (type === 'number') return Number.isFinite(value)
    return false
}

export function sanitizeProps(props) {
    if (props === undefined || props === null) return {}
    if (!isPlainObject(props)) return null

    const output = {}
    for (const key of Object.keys(props)) {
        if (DANGEROUS_KEYS.has(key)) continue
        if (isForbiddenPropKey(key)) return null

        const value = props[key]
        if (value === undefined) continue
        if (!isPrimitivePropValue(value)) return null
        output[key] = value
    }

    const serialized = JSON.stringify(output)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PROPS_BYTES) return null
    return output
}

export function validateEventItem(item) {
    if (!isPlainObject(item)) {
        return { ok: false, message: 'Каждое событие должно быть объектом' }
    }
    if (!isAllowedEvent(item.event)) {
        return { ok: false, message: 'Недопустимое имя события' }
    }

    const props = sanitizeProps(item.props)
    if (props === null) {
        return { ok: false, message: 'Некорректные свойства события: допустимы примитивы без персональных данных и не больше 2048 байт' }
    }

    let path = null
    if (item.path !== undefined && item.path !== null) {
        path = parseVisitPath(item.path)
        if (!path) {
            return { ok: false, message: `Путь события должен начинаться с / и быть не длиннее ${MAX_PATH_LENGTH} символов` }
        }
    }

    return { ok: true, event: { event: item.event, props, path } }
}

export function parseEventsBody(body) {
    if (!isPlainObject(body)) {
        return { ok: false, message: 'Тело запроса должно быть JSON-объектом' }
    }

    const rawEvents = body.events
    if (!Array.isArray(rawEvents)) {
        return { ok: false, message: 'Поле events должно быть массивом' }
    }
    if (rawEvents.length > MAX_EVENTS_PER_BATCH) {
        return { ok: false, message: `За один запрос можно отправить не больше ${MAX_EVENTS_PER_BATCH} событий` }
    }

    let visitorId = null
    if (body.visitorId !== undefined && body.visitorId !== null) {
        visitorId = parseVisitorId(body.visitorId)
        if (!visitorId) {
            return { ok: false, message: 'Некорректный visitorId' }
        }
    }

    const events = []
    for (let index = 0; index < rawEvents.length; index += 1) {
        const result = validateEventItem(rawEvents[index])
        if (!result.ok) {
            return { ok: false, message: `Событие #${index + 1}: ${result.message}` }
        }
        events.push(result.event)
    }

    return { ok: true, events, visitorId }
}
