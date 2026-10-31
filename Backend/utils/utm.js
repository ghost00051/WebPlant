export const UTM_MAX_LENGTH = 120

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g
const HTML_CHARS = /[<>]/g

function sliceCodePoints(value, maxLength) {
    const codePoints = Array.from(value)
    if (codePoints.length <= maxLength) return value
    return codePoints.slice(0, maxLength).join('')
}

export function cleanUtmValue(value) {
    if (typeof value !== 'string') return null
    const cleaned = sliceCodePoints(
        value.replace(CONTROL_CHARS, '').replace(HTML_CHARS, '').trim(),
        UTM_MAX_LENGTH
    ).trim()
    return cleaned || null
}

export function parseUtm(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null
    return {
        source: cleanUtmValue(raw?.source),
        medium: cleanUtmValue(raw?.medium),
        campaign: cleanUtmValue(raw?.campaign)
    }
}

export function hasUtm(utm) {
    if (!utm || typeof utm !== 'object') return false
    return Boolean(utm.source || utm.medium || utm.campaign)
}
