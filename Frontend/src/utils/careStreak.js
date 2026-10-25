import { monthGenitive, toDate, toISODate, weekdayName } from './date.js'

export const WEEK_DAYS_LIMIT = 7

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const DAY_STATUS_LABELS = {
  'on-time': 'полив вовремя',
  late: 'полив с опозданием',
  skipped: 'полив пропущен',
  planned: 'полив запланирован',
  none: 'нет данных о поливе'
}

const WATERING_PLURAL = ['полив', 'полива', 'поливов']
const WATERING_GENITIVE_PLURAL = ['полива', 'поливов', 'поливов']
const CARE_ACTION_PLURAL = [
  'действие ухода',
  'действия ухода',
  'действий ухода'
]

export function pluralRu (count, forms) {
  const value = Math.abs(Number(count))
  if (!Number.isFinite(value)) return forms[2]
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export function streakCountLabel (count) {
  const value = Math.max(0, Math.floor(Number(count) || 0))
  return `${value} ${pluralRu(value, WATERING_PLURAL)}`
}

function readCount (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

export function normalizeWeek (week) {
  const raw = week && typeof week === 'object' ? week : {}
  return {
    wateredOnTime: readCount(raw.wateredOnTime),
    wateredLate: readCount(raw.wateredLate),
    skipped: readCount(raw.skipped),
    scheduled: readCount(raw.scheduled),
    photos: readCount(raw.photos),
    careActions: readCount(raw.careActions)
  }
}

export function hasWeekActivity (week) {
  const data = normalizeWeek(week)
  return (
    data.scheduled > 0 ||
    data.wateredOnTime > 0 ||
    data.wateredLate > 0 ||
    data.skipped > 0 ||
    data.photos > 0 ||
    data.careActions > 0
  )
}

export function describeWeekProgress (week) {
  const data = normalizeWeek(week)
  const done = data.wateredOnTime + data.wateredLate
  const parts = []

  if (data.scheduled > 0) {
    const total = Math.max(data.scheduled, done)
    parts.push(
      `${done} из ${total} ${pluralRu(total, WATERING_GENITIVE_PLURAL)}`
    )
  } else if (done > 0) {
    parts.push(streakCountLabel(done))
  }

  if (data.photos > 0) {
    parts.push(`${data.photos} фото`)
  }

  if (data.careActions > 0) {
    parts.push(
      `${data.careActions} ${pluralRu(data.careActions, CARE_ACTION_PLURAL)}`
    )
  }

  if (data.skipped > 0) {
    parts.push(`${data.skipped} ${pluralRu(data.skipped, ['пропуск', 'пропуска', 'пропусков'])}`)
  }

  return parts.join(', ')
}

export function weekProgressPercent (week) {
  const data = normalizeWeek(week)
  const done = data.wateredOnTime + data.wateredLate
  const total = Math.max(data.scheduled, done)
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

export function normalizeWeekDayStatus (status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (!value) return 'none'
  if (
    value === 'on_time' ||
    value === 'on-time' ||
    value === 'ontime' ||
    value === 'watered_on_time' ||
    value === 'done' ||
    value === 'watered' ||
    value === 'ok'
  ) {
    return 'on-time'
  }
  if (
    value === 'late' ||
    value === 'watered_late' ||
    value === 'overdue' ||
    value === 'delayed'
  ) {
    return 'late'
  }
  if (
    value === 'skipped' ||
    value === 'skip' ||
    value === 'missed' ||
    value === 'auto_skip'
  ) {
    return 'skipped'
  }
  if (
    value === 'planned' ||
    value === 'scheduled' ||
    value === 'pending' ||
    value === 'future' ||
    value === 'upcoming'
  ) {
    return 'planned'
  }
  return 'none'
}

function capitalize (value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function buildWeekDays (days, now = new Date()) {
  if (!Array.isArray(days)) return []

  const todayIso = toISODate(now)

  return days.slice(0, WEEK_DAYS_LIMIT).map(day => {
    const date = toDate(day?.date)
    const iso = toISODate(date)
    const status = normalizeWeekDayStatus(day?.status)

    return {
      iso,
      label: WEEKDAY_SHORT[date.getDay()],
      status,
      statusLabel: DAY_STATUS_LABELS[status],
      isToday: iso === todayIso,
      title: `${capitalize(weekdayName(date))}, ${date.getDate()} ${monthGenitive(date)} — ${DAY_STATUS_LABELS[status]}`
    }
  })
}

export function formatRecapDate (value) {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''

  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) return ''

  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.getDate()
  const month = monthGenitive(date)

  return sameYear ? `${day} ${month}` : `${day} ${month} ${date.getFullYear()}`
}

export function hasCareStreakData (streak) {
  if (!streak || typeof streak !== 'object') return false
  if (readCount(streak.current) > 0) return true
  if (readCount(streak.best) > 0) return true
  if (streak.latestRecap) return true
  return hasWeekActivity(streak.week)
}
