export const DEFAULT_TIME_ZONE = 'Europe/Moscow'

const MAX_TIME_ZONE_LENGTH = 64


export function isValidTimeZone(value) {
    if (typeof value !== 'string') return false

    const candidate = value.trim()
    if (!candidate || candidate.length > MAX_TIME_ZONE_LENGTH) return false

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate })
        return true
    } catch {
        return false
    }
}

export function resolveTimeZone(value) {
    return isValidTimeZone(value) ? value.trim() : DEFAULT_TIME_ZONE
}

export function resolveHemisphere(user, env = process.env) {
    const personal = typeof user?.hemisphere === 'string' ? user.hemisphere.trim().toLowerCase() : ''
    if (personal === 'south' || personal === 'north') return personal

    const global = String(env.HEMISPHERE || '').trim().toLowerCase()
    return global === 'south' ? 'south' : 'north'
}
