
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
