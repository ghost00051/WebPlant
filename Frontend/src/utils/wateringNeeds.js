import { APP_TIME_ZONE } from './date.js'

const MS_PER_DAY = 86_400_000
const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_WORD_FORMS = ['день', 'дня', 'дней']

function plural(count, forms) {
  const value = Math.abs(Number(count))
  if (!Number.isFinite(value)) return forms[2]
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function toInstant(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

function formatZonedDay(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const values = {}
    for (const part of parts) {
      if (part.type !== 'literal') values[part.type] = part.value
    }
    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`
    }
  } catch {
    return null
  }
  return null
}

function localIsoDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function zonedIsoDay(value, timeZone = APP_TIME_ZONE) {
  const date = toInstant(value)
  if (!date) return null

  const preferred = timeZone || APP_TIME_ZONE
  const preferredDay = formatZonedDay(date, preferred)
  if (preferredDay) return preferredDay
  if (preferred !== APP_TIME_ZONE) {
    const fallbackDay = formatZonedDay(date, APP_TIME_ZONE)
    if (fallbackDay) return fallbackDay
  }
  return localIsoDay(date)
}

function isoDayToUtcTime(isoDay) {
  const match = ISO_DAY_PATTERN.exec(isoDay)
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function isoDayDiff(laterDay, earlierDay) {
  const later = isoDayToUtcTime(laterDay)
  const earlier = isoDayToUtcTime(earlierDay)
  if (later === null || earlier === null) return null
  return Math.round((later - earlier) / MS_PER_DAY)
}

function missedSortValue(entry) {
  return entry.dueDay || '9999-12-31'
}

function intervalDaysOf(plant) {
  const value = Number(plant?.watering_interval_days)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function splitNeedWateringPlants(
  plants,
  { now = new Date(), timeZone = APP_TIME_ZONE } = {}
) {
  const todayDay = zonedIsoDay(now, timeZone)
  const today = []
  const missed = []

  for (const plant of Array.isArray(plants) ? plants : []) {
    if (!plant || typeof plant !== 'object') continue

    const missedSince = toInstant(plant.metadata?.missed_since)
    const plannedDay = zonedIsoDay(plant.next_watering_at, timeZone)
    const plannedInPast = Boolean(todayDay && plannedDay && plannedDay < todayDay)
    const plannedToday = Boolean(todayDay && plannedDay && plannedDay === todayDay)

    if (!missedSince && !plannedInPast) {
      today.push(plant)
      continue
    }

    const dueDay = missedSince ? zonedIsoDay(missedSince, timeZone) : plannedDay
    const late = todayDay && dueDay ? isoDayDiff(todayDay, dueDay) : null
    const daysLate = Number.isFinite(late) && late > 0 ? late : 0

    missed.push({
      plant,
      dueDay: dueDay || null,
      daysLate
    })

    const intervalDays = intervalDaysOf(plant)
    const nextOccurrenceArrived = Boolean(
      missedSince && intervalDays && daysLate >= intervalDays
    )

    if (plannedToday || nextOccurrenceArrived) {
      today.push({
        ...plant,
        previousMissedWatering: { dueDay: dueDay || null, daysLate }
      })
    }
  }

  missed.sort((a, b) => {
    const byDueDay = missedSortValue(a).localeCompare(missedSortValue(b))
    if (byDueDay !== 0) return byDueDay
    return b.daysLate - a.daysLate
  })

  return { today, missed }
}

export function missedWateringLabel(daysLate) {
  const days = Number(daysLate)
  if (!Number.isInteger(days) || days < 1) return 'Пропущен полив'
  if (days === 1) return 'Полив просрочен на 1 день'
  return `Полив просрочен на ${days} ${plural(days, DAY_WORD_FORMS)}`
}
