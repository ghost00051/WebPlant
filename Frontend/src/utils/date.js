
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
    const match = ISO_DATE_PATTERN.exec(value)
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    }
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
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

// Что показывать в карточке дня: расписание ('future') или историю ('past').
// Пропущенный или просроченный полив остаётся в расписании до автопропуска,
// поэтому приоритет у истории — иначе по такой дате открывалась бы карточка
// с плановым временем вместо отметки о просрочке. Это касается и сегодняшнего
// дня: время полива уже прошло, и на дне горит красная точка.
export function resolveDayKind({ isPastDay, hasSchedule, hasEvents, hasMissed }) {
  if (hasEvents && (hasMissed || isPastDay)) return 'past'
  if (hasSchedule) return 'future'
  return hasEvents ? 'past' : 'empty'
}

// Позиции расписания делятся на ещё не наступившие (план) и уже прошедшие
// (просрочка). Сервер отдаёт прошедшую позицию в том же списке — она остаётся
// там до автопропуска, и раньше по ней рисовалась точка «будущий полив».
// Проверяется каждая позиция растения, а не день целиком: на одну дату могут
// приходиться план одного растения и пропуск другого.
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
      const at = new Date(plant?.next_watering_at ?? '').getTime()
      // Без времени начала считаем позицию плановой, чтобы не показать
      // пропуск там, где его нет.
      if (Number.isFinite(at) && at < nowTime) missed.add(date)
      else planned.add(date)
    }
  }

  return { planned, missed }
}

// Отметки дня в календаре: плановая — только для ещё не наступившего полива,
// пропущенная — для просроченного или пропущенного. У разных растений на одном
// дне могут быть и план, и пропуск, поэтому отметки не взаимоисключающие; а вот
// завершённый полив не показывается, если в этот день есть пропуск.
export function resolveWateringMarkers({ isPlanned, hasHistory, hasMissed }) {
  return {
    isFuture: Boolean(isPlanned),
    isPast: Boolean(hasHistory) && !hasMissed,
    isOverdue: Boolean(hasMissed),
  }
}

// Дни недели для напоминаний подбираются по частоте полива. Ограничение по дню
// недели осмысленно, только если полив попадает на одни и те же дни, то есть
// интервал кратен неделе. Для «каждый день» отмечаем все дни. При смещающемся
// графике (например, раз в 3 дня) ограничение не накладываем: иначе
// подсвечивались бы все семь дней и выбор терял смысл (BUG-019).
export function reminderWeekdaysForInterval(intervalDays, startDate = new Date()) {
  if (typeof intervalDays !== 'number' || !Number.isInteger(intervalDays) || intervalDays < 1) {
    return []
  }
  if (intervalDays === 1) return [0, 1, 2, 3, 4, 5, 6]
  if (intervalDays % 7 !== 0) return []

  const firstWatering = addDays(toDate(startDate), intervalDays)
  return [firstWatering.getDay()]
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
