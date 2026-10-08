export const MAX_TITLE_LENGTH = 120
export const MAX_BODY_LENGTH = 1000
export const MAX_URL_LENGTH = 2048
export const MAX_ICON_LENGTH = 2048
export const MAX_USER_IDS = 1000
export const MIN_SCHEDULE_DELAY_MS = 30 * 1000
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000

const TITLE_MESSAGE = 'Укажите заголовок до 120 символов'
const BODY_MESSAGE = 'Укажите текст до 1000 символов'
const URL_MESSAGE = 'Ссылка должна быть внутренним путём, например /home'
const ICON_MESSAGE = 'Некорректная иконка'
const TARGET_MODE_MESSAGE = 'Некорректный режим получателей'
const USER_IDS_MESSAGE = 'Выберите хотя бы одного получателя'
const INCLUDE_GUESTS_MESSAGE = 'Гостевые подписки доступны только при рассылке всем'
const SCHEDULED_MESSAGE = 'Время отправки должно быть в будущем'

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/
const WHITESPACE = /\s/

// Длина в символах (code points), а не в UTF-16 code units.
function characterLength(value) {
    return Array.from(value).length
}

function failure(message) {
    return { ok: false, message }
}

function normalizeTitle(value) {
    const title = typeof value === 'string' ? value.trim() : ''
    const length = characterLength(title)
    if (length < 1 || length > MAX_TITLE_LENGTH) return failure(TITLE_MESSAGE)
    return { ok: true, value: title }
}

function normalizeBody(value) {
    const body = typeof value === 'string' ? value.trim() : ''
    const length = characterLength(body)
    if (length < 1 || length > MAX_BODY_LENGTH) return failure(BODY_MESSAGE)
    return { ok: true, value: body }
}

function normalizeUrl(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: '/' }
    }
    if (typeof value !== 'string') return failure(URL_MESSAGE)

    const url = value.trim()
    if (!url) return { ok: true, value: '/' }

    const invalid = !url.startsWith('/') ||
        url.startsWith('//') ||
        url.startsWith('/\\') ||
        WHITESPACE.test(url) ||
        CONTROL_CHARACTERS.test(url) ||
        characterLength(url) > MAX_URL_LENGTH

    if (invalid) return failure(URL_MESSAGE)
    return { ok: true, value: url }
}

function normalizeIcon(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null }
    }
    if (typeof value !== 'string') return failure(ICON_MESSAGE)

    const icon = value.trim()
    if (!icon) return { ok: true, value: null }

    const allowedPrefix = icon.startsWith('/') || /^https?:\/\//i.test(icon)
    if (!allowedPrefix || characterLength(icon) > MAX_ICON_LENGTH) {
        return failure(ICON_MESSAGE)
    }
    return { ok: true, value: icon }
}

function normalizeTargetMode(value) {
    if (value === undefined || value === null) {
        return { ok: true, value: 'all' }
    }
    if (value !== 'all' && value !== 'users') return failure(TARGET_MODE_MESSAGE)
    return { ok: true, value }
}

function toPositiveUserId(entry) {
    if (typeof entry === 'number') {
        return Number.isSafeInteger(entry) && entry > 0 ? entry : null
    }
    if (typeof entry === 'string' && /^\d+$/.test(entry.trim())) {
        const parsed = Number(entry.trim())
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
    }
    return null
}

function normalizeUserIds(value, targetMode) {
    if (targetMode !== 'users') return { ok: true, value: [] }
    if (!Array.isArray(value)) return failure(USER_IDS_MESSAGE)

    const unique = []
    const seen = new Set()
    for (const entry of value) {
        const userId = toPositiveUserId(entry)
        if (userId === null) return failure(USER_IDS_MESSAGE)
        if (seen.has(userId)) continue
        seen.add(userId)
        unique.push(userId)
    }

    if (unique.length === 0 || unique.length > MAX_USER_IDS) {
        return failure(USER_IDS_MESSAGE)
    }
    return { ok: true, value: unique }
}

function normalizeIncludeGuests(value, targetMode) {
    const includeGuests = value === true
    if (includeGuests && targetMode !== 'all') return failure(INCLUDE_GUESTS_MESSAGE)
    return { ok: true, value: includeGuests }
}

function normalizeScheduledFor(value, now = new Date()) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null }
    }
    if (typeof value !== 'string' && !(value instanceof Date)) {
        return failure(SCHEDULED_MESSAGE)
    }

    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    if (Number.isNaN(date.getTime())) return failure(SCHEDULED_MESSAGE)

    const delay = date.getTime() - now.getTime()
    if (delay < MIN_SCHEDULE_DELAY_MS || delay > MAX_SCHEDULE_AHEAD_MS) {
        return failure(SCHEDULED_MESSAGE)
    }
    return { ok: true, value: date.toISOString() }
}

export function validateBroadcastInput(payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}

    const title = normalizeTitle(source.title)
    if (!title.ok) return title

    const body = normalizeBody(source.body)
    if (!body.ok) return body

    const url = normalizeUrl(source.url)
    if (!url.ok) return url

    const icon = normalizeIcon(source.icon)
    if (!icon.ok) return icon

    const targetMode = normalizeTargetMode(source.targetMode)
    if (!targetMode.ok) return targetMode

    const userIds = normalizeUserIds(source.userIds, targetMode.value)
    if (!userIds.ok) return userIds

    const includeGuests = normalizeIncludeGuests(source.includeGuests, targetMode.value)
    if (!includeGuests.ok) return includeGuests

    const scheduledFor = normalizeScheduledFor(source.scheduledFor)
    if (!scheduledFor.ok) return scheduledFor

    return {
        ok: true,
        value: {
            title: title.value,
            body: body.value,
            url: url.value,
            icon: icon.value,
            targetMode: targetMode.value,
            userIds: userIds.value,
            includeGuests: includeGuests.value,
            scheduledFor: scheduledFor.value
        }
    }
}

export function resolveScheduledStatus(scheduledFor, now = new Date()) {
    if (scheduledFor === undefined || scheduledFor === null || scheduledFor === '') {
        return 'sending'
    }
    const date = scheduledFor instanceof Date
        ? scheduledFor
        : new Date(scheduledFor)
    if (Number.isNaN(date.getTime())) return 'sending'
    return date.getTime() > now.getTime() ? 'pending' : 'sending'
}

export function isValidBroadcastId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false
    return Number.isSafeInteger(Number(value))
}
