import { DEFAULT_TIME_ZONE, resolveTimeZone } from './timeZone.js'

export const DEFAULT_BACKUP_TIMES = Object.freeze(['02:00', '14:00'])

export const BACKUP_SOURCES = Object.freeze(['host', 'cluster'])

export const BACKUP_SOURCE_LABELS = Object.freeze({
    host: 'хост (ctp_backup)',
    cluster: 'кластер (CronJob db-backup)'
})

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const SECONDS_PER_DAY = 86400

// Допустимое опоздание: расписание 12 ч, поэтому бэкап старше 14 ч считаем пропущенным.
const FAILED_SLOT_GRACE_HOURS = 2

/**
 * Приводит строку "02:00,14:00" (или массив) к списку слотов.
 * Некорректные и повторяющиеся значения отбрасываются; если валидных нет — возвращаются
 * значения по умолчанию, чтобы админка никогда не показывала пустое расписание.
 */
export function parseBackupTimes(value = DEFAULT_BACKUP_TIMES) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(',')

    const slots = []
    const seen = new Set()

    for (const item of raw) {
        const text = String(item ?? '').trim()
        if (!seen.has(text) && TIME_PATTERN.test(text)) {
            seen.add(text)
            const [, hours, minutes] = TIME_PATTERN.exec(text)
            slots.push({ label: text, minutes: Number(hours) * 60 + Number(minutes) })
        }
    }

    if (!slots.length) {
        return DEFAULT_BACKUP_TIMES.map(label => {
            const [hours, minutes] = label.split(':').map(Number)
            return { label, minutes: hours * 60 + minutes }
        })
    }

    return slots.sort((a, b) => a.minutes - b.minutes)
}

export function backupScheduleFromEnv(env = process.env) {
    return {
        times: parseBackupTimes(env.BACKUP_TIMES),
        timeZone: resolveTimeZone(env.BACKUP_TIME_ZONE || env.APP_TIME_ZONE || DEFAULT_TIME_ZONE)
    }
}

export function backupIntervalHours(times = DEFAULT_BACKUP_TIMES) {
    return 24 / parseBackupTimes(times).length
}

/**
 * Смещение часового пояса относительно UTC в миллисекундах для конкретного момента.
 * Считается через Intl, чтобы не тащить зависимости.
 */
export function getTimeZoneOffsetMs(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(date)

    const value = type => {
        const part = parts.find(item => item.type === type)
        return part ? Number(part.value) : NaN
    }

    const asUtc = Date.UTC(
        value('year'),
        value('month') - 1,
        value('day'),
        value('hour') % 24,
        value('minute'),
        value('second')
    )

    return asUtc - date.getTime()
}

/**
 * Ближайший запуск строго после `now`. Переход на летнее время не учитывается
 * (Europe/Moscow его не имеет с 2014 года).
 */
export function nextBackupRun({ now = new Date(), times = DEFAULT_BACKUP_TIMES, timeZone = DEFAULT_TIME_ZONE } = {}) {
    const slots = parseBackupTimes(times)
    const offset = getTimeZoneOffsetMs(now, timeZone)
    const local = new Date(now.getTime() + offset)

    const secondsOfDay = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds()
    const candidates = slots.map(slot => slot.minutes * 60)
    const nextSeconds = candidates.find(seconds => seconds > secondsOfDay)

    const dayShift = nextSeconds === undefined ? SECONDS_PER_DAY : 0
    const targetSeconds = nextSeconds === undefined ? candidates[0] : nextSeconds

    const localMidnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())

    return new Date(localMidnightUtc + (dayShift + targetSeconds) * 1000 - offset)
}

function toIso(value) {
    if (value === null || value === undefined) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toNumber(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

export function mapBackupRun(row = {}) {
    const startedAt = toIso(row.started_at ?? row.startedAt)
    const finishedAt = toIso(row.finished_at ?? row.finishedAt)
    const files = Array.isArray(row.files) ? row.files.map(String) : []

    const durationSeconds = startedAt && finishedAt
        ? Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000))
        : null

    return {
        id: row.id ?? null,
        source: String(row.source ?? 'unknown'),
        status: row.status === 'ok' ? 'ok' : 'failed',
        startedAt,
        finishedAt,
        durationSeconds,
        databaseBytes: toNumber(row.database_bytes ?? row.databaseBytes),
        uploadsBytes: toNumber(row.uploads_bytes ?? row.uploadsBytes),
        files,
        error: row.error ? String(row.error) : null
    }
}

function percentOfInterval(hours, intervalHours) {
    if (!Number.isFinite(hours)) return null
    return Math.round((hours / intervalHours) * 100)
}

/**
 * Собирает ответ для админки: расписание, следующий запуск, состояние по каждому источнику.
 */
export function summarizeBackupStatus({
    runs = [],
    now = new Date(),
    times = DEFAULT_BACKUP_TIMES,
    timeZone = DEFAULT_TIME_ZONE
} = {}) {
    const schedule = parseBackupTimes(times)
    const intervalHours = backupIntervalHours(schedule)
    const history = runs.map(mapBackupRun)

    const nextAt = nextBackupRun({ now, times: schedule, timeZone })
    const inSeconds = Math.max(0, Math.round((nextAt.getTime() - now.getTime()) / 1000))

    const bySource = {}
    for (const source of BACKUP_SOURCES) {
        const sourceRuns = history.filter(run => run.source === source)
        bySource[source] = {
            label: BACKUP_SOURCE_LABELS[source] || source,
            last: sourceRuns[0] || null,
            lastSuccess: sourceRuns.find(run => run.status === 'ok') || null
        }
    }

    const lastSuccess = history
        .filter(run => run.status === 'ok')
        .reduce((best, run) => {
            const at = Date.parse(run.finishedAt || run.startedAt || '')
            if (Number.isNaN(at)) return best
            return !best || at > best.at ? { run, at } : best
        }, null)

    const hoursSinceSuccess = lastSuccess
        ? Math.max(0, Math.round(((now.getTime() - lastSuccess.at) / 3600000) * 10) / 10)
        : null

    const latestRun = history[0] || null
    const latestRunAt = latestRun ? Date.parse(latestRun.finishedAt || latestRun.startedAt || '') : NaN

    let health
    if (!lastSuccess) {
        health = {
            status: latestRun && latestRun.status === 'failed' ? 'failing' : 'never',
            message: latestRun && latestRun.status === 'failed'
                ? `Успешных бэкапов ещё не было, последний запуск упал: ${latestRun.error || 'без текста ошибки'}`
                : 'Успешных бэкапов ещё не было — журнал пуст'
        }
    } else if (latestRun && latestRun.status === 'failed' && latestRunAt > lastSuccess.at) {
        health = {
            status: 'failing',
            message: `Последний запуск упал: ${latestRun.error || 'без текста ошибки'}`
        }
    } else if (hoursSinceSuccess > intervalHours + FAILED_SLOT_GRACE_HOURS) {
        health = {
            status: 'stale',
            message: `Бэкапа не было ${hoursSinceSuccess} ч — при расписании раз в ${intervalHours} ч это пропуск`
        }
    } else {
        health = {
            status: 'ok',
            message: `Последний успешный бэкап ${hoursSinceSuccess} ч назад`
        }
    }

    return {
        available: true,
        source: 'backup_runs',
        timeZone,
        times: schedule.map(slot => slot.label),
        intervalHours,
        next: {
            at: nextAt.toISOString(),
            inSeconds
        },
        lastSuccess: lastSuccess
            ? { ...lastSuccess.run, hoursAgo: hoursSinceSuccess, intervalPercent: percentOfInterval(hoursSinceSuccess, intervalHours) }
            : null,
        bySource,
        health,
        history
    }
}
