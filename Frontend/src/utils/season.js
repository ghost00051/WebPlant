import { DEFAULT_TIME_ZONE } from './timeZone.js'

export const SEASON_LABELS = Object.freeze({
  winter: 'зима',
  spring: 'весна',
  summer: 'лето',
  autumn: 'осень'
})

const SEASON_BY_MONTH = Object.freeze({
  1: 'winter',
  2: 'winter',
  3: 'spring',
  4: 'spring',
  5: 'spring',
  6: 'summer',
  7: 'summer',
  8: 'summer',
  9: 'autumn',
  10: 'autumn',
  11: 'autumn',
  12: 'winter'
})

const MONTH_NAME = Object.freeze({
  winter: 'зимой',
  spring: 'весной',
  summer: 'летом',
  autumn: 'осенью'
})

const BADGE_TEXT = Object.freeze({
  winter: 'Сейчас зима: поливайте реже и уберите растения от батарей',
  spring: 'Сейчас весна: растения просыпаются — проверяйте грунт чаще',
  summer: 'Сейчас лето: поливайте чаще, особенно в жару',
  autumn: 'Сейчас осень: поливайте реже'
})

const WATERING_HINT = Object.freeze({
  winter: 'Зимой короткий день — растение пьёт меньше. Поливайте, когда грунт просох на 2–3 см, и не подкармливайте до весны.',
  spring: 'Весной начинается рост: грунт просыхает быстрее, пора вернуть подкормки.',
  summer: 'Летом жара и активный рост — проверяйте грунт чаще, особенно у крупных кашпо.',
  autumn: 'Осенью световой день короче — растение пьёт меньше. Поливайте реже и сократите подкормки.'
})

function toSafeDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : new Date()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  return new Date()
}

export function readMonthNumber(date, timeZone = DEFAULT_TIME_ZONE) {
  const safeDate = toSafeDate(date)
  const zone = timeZone || DEFAULT_TIME_ZONE
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: zone,
      month: 'numeric'
    }).formatToParts(safeDate)
    const raw = parts.find(part => part.type === 'month')?.value
    const month = Number(raw)
    if (Number.isInteger(month) && month >= 1 && month <= 12) return month
  } catch {
    return safeDate.getMonth() + 1
  }
  return safeDate.getMonth() + 1
}

export function seasonForMonth(month) {
  const value = Math.trunc(Number(month))
  return SEASON_BY_MONTH[value] ?? null
}

export function getSeasonInfo(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const safeDate = toSafeDate(now)
  const zone = timeZone || DEFAULT_TIME_ZONE
  const month = readMonthNumber(safeDate, zone)
  const season = seasonForMonth(month) ?? 'autumn'

  let monthName
  try {
    monthName = new Intl.DateTimeFormat('ru-RU', {
      timeZone: zone,
      month: 'long'
    }).format(safeDate)
  } catch {
    monthName = ''
  }

  return {
    season,
    seasonLabel: SEASON_LABELS[season],
    monthLabel: MONTH_NAME[season],
    month,
    monthName,
    year: safeDate.getFullYear(),
    growingSeason: season === 'spring' || season === 'summer'
  }
}

export function seasonBadgeText(seasonInfo) {
  const season = typeof seasonInfo === 'string' ? seasonInfo : seasonInfo?.season
  return BADGE_TEXT[season] ?? BADGE_TEXT.autumn
}

export function seasonWateringHint(seasonInfo) {
  const season = typeof seasonInfo === 'string' ? seasonInfo : seasonInfo?.season
  return WATERING_HINT[season] ?? WATERING_HINT.autumn
}

export function seasonIntervalNote(seasonInfo) {
  const season = typeof seasonInfo === 'string' ? seasonInfo : seasonInfo?.season
  if (season === 'winter') return 'зимой интервал обычно на 30–80% длиннее летнего'
  if (season === 'summer') return 'летом интервал обычно самый короткий'
  if (season === 'spring') return 'весной интервал постепенно сокращается'
  return 'осенью интервал постепенно удлиняется'
}
