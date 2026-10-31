import { pluralRu } from './careStreak.js'

export const MONTH_WITH_LEYKA_TARGET = 1
export const MONTH_WITH_LEYKA_DAYS = 30
export const PLANTS_ACHIEVEMENT_TARGET = 5
export const WATERINGS_ACHIEVEMENT_TARGET = 10

const DAY_MS = 24 * 60 * 60 * 1000

function readCount (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

function parseDate (value) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function percentOf (value, target) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((value / target) * 100)))
}

export function monthsWithLeyka (createdAt, now = new Date()) {
  const start = parseDate(createdAt)
  const current = parseDate(now)
  if (!start || !current) return null
  if (current.getTime() < start.getTime()) return 0

  const months =
    (current.getFullYear() - start.getFullYear()) * 12 +
    (current.getMonth() - start.getMonth()) -
    (current.getDate() < start.getDate() ? 1 : 0)

  return Math.max(0, months)
}

export function daysWithLeyka (createdAt, now = new Date()) {
  const start = parseDate(createdAt)
  const current = parseDate(now)
  if (!start || !current) return null
  return Math.max(0, Math.floor((current.getTime() - start.getTime()) / DAY_MS))
}

function monthProgressText (months, days) {
  if (months === null || days === null) return 'Дата регистрации недоступна'
  if (months >= MONTH_WITH_LEYKA_TARGET) {
    return `С «Лейкой» ${months} ${pluralRu(months, ['месяц', 'месяца', 'месяцев'])}`
  }
  if (days <= 0) return 'Первый день с «Лейкой»'
  return `С «Лейкой» ${days} ${pluralRu(days, ['день', 'дня', 'дней'])} · цель — месяц`
}

export function buildProfileAchievements (data, now = new Date()) {
  const { createdAt, plantCount, wateringCount } = data || {}
  const plants = readCount(plantCount)
  const waterings = readCount(wateringCount)
  const months = monthsWithLeyka(createdAt, now)
  const days = daysWithLeyka(createdAt, now)
  const hasMonthData = months !== null && days !== null
  const monthValue = hasMonthData ? Math.min(months, MONTH_WITH_LEYKA_TARGET) : 0
  const monthPercent = !hasMonthData
    ? 0
    : months >= MONTH_WITH_LEYKA_TARGET
      ? 100
      : percentOf(days, MONTH_WITH_LEYKA_DAYS)

  return [
    {
      id: 'month',
      icon: 'calendar',
      title: 'Месяц с «Лейкой»',
      value: monthValue,
      target: MONTH_WITH_LEYKA_TARGET,
      unlocked: hasMonthData && months >= MONTH_WITH_LEYKA_TARGET,
      available: hasMonthData,
      progressPercent: monthPercent,
      progressText: monthProgressText(months, days)
    },
    {
      id: 'plants',
      icon: 'plants',
      title: `${PLANTS_ACHIEVEMENT_TARGET} растений`,
      value: Math.min(plants, PLANTS_ACHIEVEMENT_TARGET),
      target: PLANTS_ACHIEVEMENT_TARGET,
      unlocked: plants >= PLANTS_ACHIEVEMENT_TARGET,
      available: true,
      progressPercent: percentOf(plants, PLANTS_ACHIEVEMENT_TARGET),
      progressText: `${Math.min(plants, PLANTS_ACHIEVEMENT_TARGET)} из ${PLANTS_ACHIEVEMENT_TARGET} растений`
    },
    {
      id: 'waterings',
      icon: 'waterings',
      title: `${WATERINGS_ACHIEVEMENT_TARGET} поливов`,
      value: Math.min(waterings, WATERINGS_ACHIEVEMENT_TARGET),
      target: WATERINGS_ACHIEVEMENT_TARGET,
      unlocked: waterings >= WATERINGS_ACHIEVEMENT_TARGET,
      available: true,
      progressPercent: percentOf(waterings, WATERINGS_ACHIEVEMENT_TARGET),
      progressText: `${Math.min(waterings, WATERINGS_ACHIEVEMENT_TARGET)} из ${WATERINGS_ACHIEVEMENT_TARGET} поливов`
    }
  ]
}

export function achievementsUnlockedCount (achievements) {
  if (!Array.isArray(achievements)) return 0
  return achievements.filter(item => item?.unlocked).length
}

export function achievementsSummaryText (achievements) {
  const total = Array.isArray(achievements) ? achievements.length : 0
  const unlocked = achievementsUnlockedCount(achievements)
  return `Открыто ${unlocked} из ${total} ${pluralRu(total, ['достижения', 'достижений', 'достижений'])}`
}
