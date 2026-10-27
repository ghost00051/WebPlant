import { monthGenitive, toDate } from './date.js'
import { normalizeWeekDayStatus } from './careStreak.js'

const FREEZE_WORD_FORMS = ['день', 'дня', 'дней']

function pluralRu(count, forms) {
  const value = Math.abs(Number(count))
  if (!Number.isFinite(value)) return forms[2]
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function asBoolean(value) {
  return value === true
}

function readCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

function pickFreezeSource(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.freeze && typeof payload.freeze === 'object') return payload.freeze
  if (payload.freezeState && typeof payload.freezeState === 'object') return payload.freezeState
  if (
    typeof payload.freezeAvailable === 'boolean' ||
    typeof payload.canFreeze === 'boolean' ||
    typeof payload.freezeUsedAt === 'string'
  ) {
    return {
      available: payload.freezeAvailable,
      canFreeze: payload.canFreeze,
      usedAt: payload.freezeUsedAt,
      frozenDates: payload.frozenDates
    }
  }
  return null
}

export function hasStreakFreezeSupport(payload) {
  return pickFreezeSource(payload) !== null
}

export function normalizeStreakFreeze(payload) {
  const source = pickFreezeSource(payload)
  if (!source) return null

  const usedAt = typeof source.usedAt === 'string' ? source.usedAt : ''
  const frozenDates = Array.isArray(source.frozenDates)
    ? source.frozenDates.filter(value => typeof value === 'string' && value)
    : []
  const used = asBoolean(source.used) || asBoolean(source.usedThisWeek) || Boolean(usedAt)
  const available =
    typeof source.available === 'boolean' ? source.available : true
  const canFreeze =
    typeof source.canFreeze === 'boolean' ? source.canFreeze : available && !used
  const daysLeft = readCount(source.daysLeft ?? source.remaining ?? 0)

  return {
    available,
    canFreeze: available && canFreeze,
    used,
    usedAt: usedAt || null,
    frozenDates,
    daysLeft,
    label: typeof source.label === 'string' ? source.label : ''
  }
}

export function formatStreakDayLabel(value) {
  if (typeof value !== 'string' || !value) return ''
  const date = toDate(value)
  return `${date.getDate()} ${monthGenitive(date)}`
}

export function findBrokenDay(week) {
  if (!week || !Array.isArray(week.days)) return null
  let broken = null
  for (const day of week.days) {
    const status = normalizeWeekDayStatus(day?.status)
    if (status === 'skipped') broken = day
  }
  if (!broken || typeof broken.date !== 'string' || !broken.date) return null
  return { date: broken.date, status: 'skipped' }
}

export function describeStreakBreak({
  week,
  current = 0,
  best = 0,
  freeze = null,
  breakReason = ''
} = {}) {
  const reason = typeof breakReason === 'string' ? breakReason.trim() : ''
  const broken = findBrokenDay(week)
  const freezeDates = Array.isArray(freeze?.frozenDates) ? freeze.frozenDates : []
  const frozenDay = broken && freezeDates.includes(broken.date)

  if (frozenDay) {
    return {
      kind: 'frozen',
      iso: broken.date,
      text: `Серия сохранена заморозкой ${formatStreakDayLabel(broken.date)} — день не сгорел.`
    }
  }

  if (!broken) {
    if (!reason) return null
    return { kind: 'reason', iso: '', text: reason }
  }

  if (readCount(current) > 0) return null
  if (readCount(best) <= 0 && !reason) return null

  const dateLabel = formatStreakDayLabel(broken.date)
  return {
    kind: 'broken',
    iso: broken.date,
    text: `Серия прервалась ${dateLabel}: полив не был отмечен. Один полив вовремя — и счёт пойдёт заново.`
  }
}

export function freezeDaysLabel(daysLeft) {
  const value = readCount(daysLeft)
  return `${value} ${pluralRu(value, FREEZE_WORD_FORMS)}`
}
