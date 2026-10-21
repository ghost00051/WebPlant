export const MAX_SUBJECT_LENGTH = 200
export const MAX_BODY_LENGTH = 5000
export const MAX_CTA_LABEL_LENGTH = 80
export const MAX_CTA_URL_LENGTH = 2048
export const MAX_USER_IDS = 1000
export const MIN_SCHEDULE_DELAY_MS = 30 * 1000
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000

const SUBJECT_MESSAGE = `Укажите тему письма до ${MAX_SUBJECT_LENGTH} символов`
const BODY_MESSAGE = `Укажите текст письма до ${MAX_BODY_LENGTH} символов`
const CTA_MESSAGE = 'Заполните и подпись кнопки, и ссылку — либо оставьте оба поля пустыми'
const CTA_URL_MESSAGE = 'Ссылка кнопки должна быть путём вида /home или адресом https://…'
const TARGET_MODE_MESSAGE = 'Некорректный режим получателей'
const USER_IDS_MESSAGE = 'Выберите хотя бы одного получателя'
const SCHEDULED_MESSAGE = 'Время отправки должно быть в будущем'

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/
const BODY_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const WHITESPACE = /\s/

function characterLength(value) {
    return Array.from(value).length
}

function failure(message) {
    return { ok: false, message }
}

function normalizeText(value, { max, message, multiline = false }) {
    const text = typeof value === 'string' ? value.trim() : ''
    const length = characterLength(text)
    if (length < 1 || length > max) return failure(message)

    const forbidden = multiline ? BODY_CONTROL_CHARACTERS : CONTROL_CHARACTERS
    if (forbidden.test(text)) return failure(message)

    return { ok: true, value: text }
}

function normalizeOptionalLabel(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null }
    }
    if (typeof value !== 'string') return failure(CTA_MESSAGE)

    const label = value.trim()
    if (!label) return { ok: true, value: null }
    if (characterLength(label) > MAX_CTA_LABEL_LENGTH) return failure(CTA_MESSAGE)
    return { ok: true, value: label }
}

function isInternalPath(url) {
    return url.startsWith('/') &&
        !url.startsWith('//') &&
        !url.startsWith('/\\') &&
        !WHITESPACE.test(url)
}

function isAbsoluteHttpUrl(url) {
    try {
        const parsed = new URL(url)
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            Boolean(parsed.hostname) &&
            !WHITESPACE.test(url)
    } catch {
        return false
    }
}

function normalizeCtaUrl(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null }
    }
    if (typeof value !== 'string') return failure(CTA_URL_MESSAGE)

    const url = value.trim()
    if (!url) return { ok: true, value: null }

    const invalid = CONTROL_CHARACTERS.test(url) ||
        characterLength(url) > MAX_CTA_URL_LENGTH ||
        (!isInternalPath(url) && !isAbsoluteHttpUrl(url))

    if (invalid) return failure(CTA_URL_MESSAGE)
    return { ok: true, value: url }
}

function normalizeCta(label, url) {
    if ((label.value === null) !== (url.value === null)) return failure(CTA_MESSAGE)
    return { ok: true, value: { ctaLabel: label.value, ctaUrl: url.value } }
}

function normalizeTargetMode(value) {
    if (value === undefined || value === null) return { ok: true, value: 'all' }
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

export function validateMailBroadcastInput(payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}

    const subject = normalizeText(source.subject, {
        max: MAX_SUBJECT_LENGTH,
        message: SUBJECT_MESSAGE
    })
    if (!subject.ok) return subject

    const body = normalizeText(source.body, {
        max: MAX_BODY_LENGTH,
        message: BODY_MESSAGE,
        multiline: true
    })
    if (!body.ok) return body

    const cta = normalizeCta(
        normalizeOptionalLabel(source.ctaLabel),
        normalizeCtaUrl(source.ctaUrl)
    )
    if (!cta.ok) return cta

    const targetMode = normalizeTargetMode(source.targetMode)
    if (!targetMode.ok) return targetMode

    const userIds = normalizeUserIds(source.userIds, targetMode.value)
    if (!userIds.ok) return userIds

    const scheduledFor = normalizeScheduledFor(source.scheduledFor)
    if (!scheduledFor.ok) return scheduledFor

    return {
        ok: true,
        value: {
            subject: subject.value,
            body: body.value,
            ctaLabel: cta.value.ctaLabel,
            ctaUrl: cta.value.ctaUrl,
            targetMode: targetMode.value,
            userIds: userIds.value,
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

export { isValidBroadcastId } from './pushBroadcastValidation.js'
