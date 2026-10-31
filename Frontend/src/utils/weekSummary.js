import { addDays, monthGenitive, toDate, toISODate } from './date.js'
import { zonedIsoDay } from './wateringNeeds.js'

export const WEEK_SUMMARY_DAYS = 7

const WEEK_WORD_FORMS = ['день', 'дня', 'дней']

export function pluralRu(count, forms) {
  const value = Math.abs(Number(count))
  if (!Number.isFinite(value)) return forms[2]
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export function weekSummaryWindow(now = new Date(), timeZone) {
  const todayIso = zonedIsoDay(now, timeZone)
  if (!todayIso) return null
  const start = toDate(todayIso)
  const end = addDays(start, WEEK_SUMMARY_DAYS - 1)
  return {
    startIso: todayIso,
    endIso: toISODate(end),
    start,
    end
  }
}

export function weekSummaryDateLabel(window) {
  if (!window) return ''
  return `${window.start.getDate()} ${monthGenitive(window.start)} — ${window.end.getDate()} ${monthGenitive(window.end)}`
}

function careCounts(items, window) {
  const counts = {
    feedings: 0,
    inspections: 0,
    sprays: 0,
    other: 0,
    otherTitles: []
  }

  for (const item of Array.isArray(items) ? items : []) {
    const iso = typeof item?.date === 'string' ? item.date : null
    if (!iso || iso < window.startIso || iso > window.endIso) continue
    const code = item.action_code ?? item.actionCode
    if (code === 'fertilize') counts.feedings += 1
    else if (code === 'pest_check') counts.inspections += 1
    else if (code === 'spray') counts.sprays += 1
    else if (code) {
      counts.other += 1
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : ''
      if (title && !counts.otherTitles.includes(title)) counts.otherTitles.push(title)
    }
  }

  return counts
}

function wateringCount(items, window) {
  let count = 0
  for (const item of Array.isArray(items) ? items : []) {
    const iso = typeof item?.date === 'string' ? item.date : null
    if (!iso || iso < window.startIso || iso > window.endIso) continue
    for (const plant of Array.isArray(item.plants) ? item.plants : []) {
      if (plant?.is_missed === true) continue
      count += 1
    }
  }
  return count
}

export function buildWeekSummary({
  schedule = [],
  careItems = [],
  now = new Date(),
  timeZone
} = {}) {
  const window = weekSummaryWindow(now, timeZone)
  if (!window) {
    return {
      window: null,
      dateLabel: '',
      waterings: 0,
      feedings: 0,
      inspections: 0,
      sprays: 0,
      other: 0,
      total: 0,
      extraText: '',
      summaryText: 'Планов на неделю нет'
    }
  }

  const waterings = wateringCount(schedule, window)
  const care = careCounts(careItems, window)

  const extraParts = []
  if (care.sprays > 0) {
    extraParts.push(
      `${care.sprays} ${pluralRu(care.sprays, ['опрыскивание', 'опрыскивания', 'опрыскиваний'])}`
    )
  }
  if (care.other > 0) {
    extraParts.push(
      `${care.other} ${pluralRu(care.other, ['уход', 'ухода', 'уходов'])}`
    )
  }

  const total = waterings + care.feedings + care.inspections + care.sprays + care.other
  const summaryText = [
    `${waterings} ${pluralRu(waterings, ['полив', 'полива', 'поливов'])}`,
    `${care.feedings} ${pluralRu(care.feedings, ['подкормка', 'подкормки', 'подкормок'])}`,
    `${care.inspections} ${pluralRu(care.inspections, ['осмотр', 'осмотра', 'осмотров'])}`
  ].join(' · ')

  return {
    window,
    dateLabel: weekSummaryDateLabel(window),
    waterings,
    feedings: care.feedings,
    inspections: care.inspections,
    sprays: care.sprays,
    other: care.other,
    otherTitles: care.otherTitles,
    total,
    extraText: extraParts.length ? `Ещё на неделе: ${extraParts.join(' и ')}` : '',
    summaryText
  }
}

export function weekSummaryAriaLabel(summary) {
  if (!summary || !summary.total) return 'На неделю планов нет'
  return `На неделю: ${summary.summaryText}`
}

export function weekSummaryDaysCount(window) {
  if (!window) return 0
  return WEEK_SUMMARY_DAYS
}

export function pluralDays(count) {
  return pluralRu(count, WEEK_WORD_FORMS)
}
