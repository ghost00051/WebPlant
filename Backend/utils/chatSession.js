export const CHAT_TITLE_MAX_LENGTH = 48
export const CHAT_PHOTO_TITLE = 'Фото растения'
export const CHAT_EMPTY_TITLE = 'Новый чат'

const PHOTO_MESSAGE_PREFIX = /^фото растения/i

function normalizeTitleText(value) {
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim()
}

export function truncateChatTitle(value, maxLength = CHAT_TITLE_MAX_LENGTH) {
    const text = normalizeTitleText(value)
    if (!text) return ''
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

export function buildChatTitle({ text, hasPhoto = false } = {}) {
    const normalized = normalizeTitleText(text)
    if (!normalized) return hasPhoto ? CHAT_PHOTO_TITLE : CHAT_EMPTY_TITLE
    if (hasPhoto && PHOTO_MESSAGE_PREFIX.test(normalized)) return CHAT_PHOTO_TITLE
    return truncateChatTitle(normalized) || (hasPhoto ? CHAT_PHOTO_TITLE : CHAT_EMPTY_TITLE)
}
