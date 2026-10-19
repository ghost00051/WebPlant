const RU_MONTHS_NOMINATIVE = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

const RU_WEEKDAYS_FULL = [
  'воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота',
]

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

const MS_PER_DAY = 86_400_000

let relativeFormatter = null

function getRelativeFormatter() {
  if (relativeFormatter) return relativeFormatter
  try {
    relativeFormatter = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })
  } catch {
    relativeFormatter = null
  }
  return relativeFormatter
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function toDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value)
    return new Date(fromNumber.getFullYear(), fromNumber.getMonth(), fromNumber.getDate())
  }

  if (typeof value === 'string') {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (dateOnlyMatch) {

      return new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3])
      )
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    }

    const match = ISO_DATE_PATTERN.exec(value)
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    }
  }

  const fallback = new Date()
  return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate())
}

export function today() {
  return toDate(new Date())
}

export function addDays(value, amount) {
  const date = toDate(value)
  date.setDate(date.getDate() + amount)
  return date
}

export function startOfISOWeek(value) {
  const date = toDate(value)
  const weekday = date.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(date, offset)
}

export function toISODate(value) {
  const date = toDate(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function diffInDays(to, from) {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY)
}

export function isSameDay(a, b) {
  const left = toDate(a)
  const right = toDate(b)
  return left.getTime() === right.getTime()
}

export function isBefore(a, b) {
  return toDate(a).getTime() < toDate(b).getTime()
}

export const APP_TIME_ZONE = 'Europe/Moscow'

export const MISSED_GRACE_HOUR = 24

function toInstant(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value)
    return Number.isFinite(fromNumber.getTime()) ? fromNumber : null
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  return null
}

const zonedFormatters = new Map()

function zonedFormatter(timeZone) {
  let formatter = zonedFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    zonedFormatters.set(timeZone, formatter)
  }
  return formatter
}

function zonedParts(date, timeZone = APP_TIME_ZONE) {
  const parts = zonedFormatter(timeZone).formatToParts(date)
  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return values
}

function zonedDateTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = APP_TIME_ZONE
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const observed = zonedParts(new Date(utcGuess), timeZone)
  const observedAsUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second
  )
  return new Date(utcGuess - (observedAsUtc - utcGuess))
}

export function missedDeadline(value) {
  const scheduled = toInstant(value)
  if (!scheduled) return null

  const parts = zonedParts(scheduled)

  return zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day + 1 })
}

export function isMissedOccurrence(value, now = new Date()) {
  const deadline = missedDeadline(value)
  const current = toInstant(now)
  if (!deadline || !current) return false

  return current.getTime() >= deadline.getTime()
}

export function resolveDayKind({ isPastDay, hasPlans, hasEvents }) {
  if (isPastDay) return hasPlans || hasEvents ? 'past' : 'empty'
  return hasPlans || hasEvents ? 'future' : 'empty'
}

export function buildDayView({ date, now = new Date(), plannedPlants = [], events = [] }) {
  const target = toDate(date)
  const isPastDay = diffInDays(target, now) < 0
  const dayEvents = Array.isArray(events) ? events : []
  const resolvedPlantIds = new Set(dayEvents.map(event => event?.plant?.id))

  const plants = []
  const missedFromPlans = []

  for (const plant of Array.isArray(plannedPlants) ? plannedPlants : []) {
    if (!plant || resolvedPlantIds.has(plant.id)) continue

    const isMissed = typeof plant.is_missed === 'boolean'
      ? plant.is_missed
      : isPastDay || isMissedOccurrence(plant.next_watering_at, now)

    if (isMissed) {
      missedFromPlans.push({
        kind: 'overdue',
        plant,
        scheduled_for: plant.next_watering_at,
        hours_late: null,
        days_late: null,
        fromPlan: true,
      })
    } else {
      plants.push(plant)
    }
  }

  const combinedEvents = missedFromPlans.length
    ? [...missedFromPlans, ...dayEvents]
    : dayEvents

  return {
    date: target,
    iso: toISODate(target),
    isPastDay,
    kind: resolveDayKind({
      isPastDay,
      hasPlans: plants.length > 0,
      hasEvents: combinedEvents.length > 0,
    }),
    plants,
    events: combinedEvents,
  }
}

export function partitionScheduleDates(schedule, now = new Date()) {
  const planned = new Set()
  const missed = new Set()
  const nowTime = new Date(now).getTime()
  if (!Number.isFinite(nowTime)) return { planned, missed }

  for (const item of Array.isArray(schedule) ? schedule : []) {
    const date = item?.date
    const plants = Array.isArray(item?.plants) ? item.plants : []
    if (!date || plants.length === 0) continue

    for (const plant of plants) {
      const isMissed = typeof plant?.is_missed === 'boolean'
        ? plant.is_missed
        : isMissedOccurrence(plant?.next_watering_at, now)

      if (isMissed) missed.add(date)
      else planned.add(date)
    }
  }

  return { planned, missed }
}

export function resolveWateringMarkers({ isPlanned, hasHistory, hasMissed }) {
  return {
    isFuture: Boolean(isPlanned),
    isPast: Boolean(hasHistory) && !hasMissed,
    isOverdue: Boolean(hasMissed),
  }
}

export function reminderWeekdaysForInterval(intervalDays, startDate = new Date()) {
  if (typeof intervalDays !== 'number' || !Number.isInteger(intervalDays) || intervalDays < 1) {
    return []
  }
  if (intervalDays === 1) return [0, 1, 2, 3, 4, 5, 6]
  if (intervalDays % 7 !== 0) return []

  const firstWatering = addDays(toDate(startDate), intervalDays)
  return [firstWatering.getDay()]
}

export function weekdayRestrictionApplies(intervalDays) {
  if (typeof intervalDays !== 'number' || !Number.isInteger(intervalDays) || intervalDays < 1) {
    return false
  }
  return intervalDays === 1 || intervalDays % 7 === 0
}

export function upcomingWateringDays(intervalDays, startDate = new Date(), count = 4) {
  if (typeof intervalDays !== 'number' || !Number.isInteger(intervalDays) || intervalDays < 1) {
    return []
  }
  if (!Number.isInteger(count) || count < 1) return []

  const start = toDate(startDate)
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(start, intervalDays * (index + 1))
    return { date, weekday: date.getDay() }
  })
}

export function dayOfMonth(value) {
  return toDate(value).getDate()
}

export function weekdayName(value) {
  return RU_WEEKDAYS_FULL[toDate(value).getDay()]
}

export function monthNominative(value) {
  return RU_MONTHS_NOMINATIVE[toDate(value).getMonth()]
}

export function monthGenitive(value) {
  return RU_MONTHS_GENITIVE[toDate(value).getMonth()]
}

export function relativeDayLabel(value, from = new Date()) {
  const difference = diffInDays(value, from)

  if (difference === 0) return 'Сегодня'
  if (difference === -1) return 'Вчера'
  if (difference === 1) return 'Завтра'

  const formatter = getRelativeFormatter()
  if (formatter) {
    return capitalize(formatter.format(difference, 'day'))
  }

  const amount = Math.abs(difference)
  const unit = amount % 10 === 1 && amount % 100 !== 11
    ? 'день'
    : amount % 10 >= 2 && amount % 10 <= 4 && (amount % 100 < 10 || amount % 100 >= 20)
      ? 'дня'
      : 'дней'
  return difference > 1
    ? `через ${amount} ${unit}`
    : `${amount} ${unit} назад`
}
