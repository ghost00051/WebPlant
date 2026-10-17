const DAY_MS = 24 * 60 * 60 * 1000

export function appTimeZone(env = process.env) {
    return env.APP_TIME_ZONE || 'Europe/Moscow'
}

export function localDayKey(value, timeZone = appTimeZone()) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date)
}

export function diffLocalDays(target, from, timeZone = appTimeZone()) {
    const targetKey = localDayKey(target, timeZone)
    const fromKey = localDayKey(from, timeZone)
    if (!targetKey || !fromKey) return null
    return Math.round(
        (new Date(`${targetKey}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / DAY_MS
    )
}

export function formatLocalDay(value, timeZone = appTimeZone()) {
    if (value === null || value === undefined || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        day: 'numeric',
        month: 'long'
    }).format(date)
}


export function describePlantDay(value, { now = new Date(), timeZone = appTimeZone() } = {}) {
    const diffDays = diffLocalDays(value, now, timeZone)
    if (diffDays === null) return null

    if (diffDays === 0) return 'сегодня'
    if (diffDays === 1) return 'завтра'
    if (diffDays === -1) return 'вчера'
    if (diffDays < -1) return `просрочен на ${Math.abs(diffDays)} дн.`
    if (diffDays <= 7) return `через ${diffDays} дн.`

    return formatLocalDay(value, timeZone)
}
