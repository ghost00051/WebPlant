import { PLANTS } from '../data/plants.js'
import { monthGenitive, toDate, toISODate } from './date.js'
import { seasonIntervalNote, seasonWateringHint } from './season.js'

const MS_PER_HOUR = 3_600_000
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

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function matchGuidePlant(input = {}) {
  const { name, species } = input || {}
  const plantName = normalizeText(name)
  const plantSpecies = normalizeText(species)
  if (!plantName && !plantSpecies) return null

  return (
    PLANTS.find(item => {
      const latin = normalizeText(item.latin)
      if (plantSpecies && latin && plantSpecies === latin) return true
      const title = normalizeText(item.name)
      if (plantName && title && plantName === title) return true
      if (plantName && title && (plantName.includes(title) || title.includes(plantName))) {
        return true
      }
      if (plantSpecies && latin) {
        const genus = latin.split(' ')[0]
        if (genus && plantSpecies.startsWith(genus)) return true
      }
      return false
    }) ?? null
  )
}

export function daysSinceCreated(plant, now = new Date()) {
  const created = toInstant(plant?.createdAt ?? plant?.created_at)
  const current = toInstant(now)
  if (!created || !current) return null
  return Math.floor((current.getTime() - created.getTime()) / MS_PER_HOUR / 24)
}

export function selectFirstDayPlant(plants, { now = new Date(), maxAgeHours = 24 } = {}) {
  if (!Array.isArray(plants) || plants.length === 0) return null
  const current = toInstant(now)
  if (!current) return null

  let newest = null
  let newestTime = -Infinity

  for (const plant of plants) {
    const created = toInstant(plant?.createdAt ?? plant?.created_at)
    if (!created) continue
    const age = current.getTime() - created.getTime()
    if (age < 0 || age > maxAgeHours * MS_PER_HOUR) continue
    if (created.getTime() > newestTime) {
      newest = plant
      newestTime = created.getTime()
    }
  }

  return newest
}

export function firstDayDismissKey(plantId, now = new Date()) {
  if (plantId === null || plantId === undefined) return ''
  return `webplant.firstDayDismissed.${plantId}.${toISODate(now)}`
}

function intervalDaysOf(plant) {
  const value = Math.round(Number(plant?.watering_interval_days ?? plant?.wateringIntervalDays))
  return Number.isInteger(value) && value >= 1 ? value : null
}

function formatShortDate(date) {
  return `${date.getDate()} ${monthGenitive(date)}`
}

function dueLabel(date, now) {
  const target = toDate(date)
  const today = toDate(now)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'завтра'
  if (diff > 1) return `через ${diff} ${plural(diff, DAY_WORD_FORMS)}`
  if (diff === -1) return 'просрочен на 1 день'
  return `просрочен на ${Math.abs(diff)} ${plural(Math.abs(diff), DAY_WORD_FORMS)}`
}

export function resolveNextWateringAt(plant) {
  const planned = toInstant(plant?.next_watering_at ?? plant?.nextWateringAt)
  if (planned) return planned

  const interval = intervalDaysOf(plant)
  const lastWatered = toInstant(plant?.last_watered_at ?? plant?.lastWateredAt)
  const base = lastWatered ?? toInstant(plant?.createdAt ?? plant?.created_at)
  if (!interval || !base) return null

  const next = new Date(base.getTime())
  next.setDate(next.getDate() + interval)
  return Number.isFinite(next.getTime()) ? next : null
}

export function buildFirstDayFacts(input = {}) {
  const { plant, now = new Date(), seasonInfo = null } = input || {}
  if (!plant || typeof plant !== 'object') return []
  const interval = intervalDaysOf(plant)
  const guide = matchGuidePlant({ name: plant.name, species: plant.species })
  const hasWatered = Boolean(toInstant(plant.last_watered_at ?? plant.lastWateredAt))
  const nextWatering = resolveNextWateringAt(plant)
  const facts = []

  if (nextWatering) {
    facts.push({
      id: 'watering',
      title: hasWatered ? 'Следующий полив' : 'Первый полив',
      text: hasWatered
        ? `Следующий полив — ${formatShortDate(nextWatering)} (${dueLabel(nextWatering, now)}).`
        : `Первый полив — ${dueLabel(nextWatering, now)}. Отметьте его во вкладке «Полив», и «Лейка» начнёт считать серию.`
    })
  }

  if (interval) {
    const reference = guide?.intervalLabel
      ? `Справочник для «${guide.name}» советует ${guide.intervalLabel}.`
      : 'Столько «Лейка» советует для растения такого типа.'
    facts.push({
      id: 'interval',
      title: `Почему раз в ${interval} ${plural(interval, DAY_WORD_FORMS)}`,
      text: `${reference} ${capitalize(seasonIntervalNote(seasonInfo))}. Проверяйте грунт на 2–3 см: если просох — можно полить раньше.`
    })
  } else if (seasonInfo?.season) {
    facts.push({
      id: 'season',
      title: 'Сезон',
      text: seasonWateringHint(seasonInfo)
    })
  }

  if (guide?.light) {
    facts.push({
      id: 'light',
      title: 'Свет',
      text: `${capitalize(guide.light.toLowerCase())}. Поставьте горшок без прямых лучей в полдень и проверяйте листья первые дни.`
    })
  } else {
    facts.push({
      id: 'light',
      title: 'Свет',
      text: 'Выберите место у окна без прямых лучей в полдень. Если листья бледнеют — переставьте ближе к свету.'
    })
  }

  return facts.slice(0, 3)
}

function capitalize(value) {
  const text = typeof value === 'string' ? value : ''
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}
