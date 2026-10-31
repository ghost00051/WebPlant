import { monthGenitive, toDate } from './date.js'
import { zonedIsoDay } from './wateringNeeds.js'

const MAX_NAMED_PLANTS = 2

const SEASON_PLANT_TIPS = Object.freeze({
  autumn: 'осенью пьют меньше: поливайте реже и сокращайте подкормки до весны',
  winter: 'зимой лучше держать подальше от батарей: воздух сухой, а полив — реже',
  spring: 'весной просыпаются: проверяйте грунт на 2–3 см и возвращайте подкормки',
  summer: 'летом пьют больше: проверяйте грунт чаще и притеняйте от полуденного солнца'
})

const BASE_CARE_TIPS = Object.freeze([
  {
    id: 'soil-check',
    title: 'Проверьте грунт',
    text: 'Календарь — ориентир, а не приказ. Погрузите палец или палочку на 2–3 см: если сухо — можно поливать.'
  },
  {
    id: 'leaf-clean',
    title: 'Протрите листья',
    text: 'Пыль мешает фотосинтезу и прячет вредителей. Протрите листья влажной тканью — заодно осмотрите нижнюю сторону.'
  },
  {
    id: 'light-turn',
    title: 'Поверните к свету',
    text: 'Раз в неделю поворачивайте горшок на четверть оборота — крона будет расти ровнее.'
  },
  {
    id: 'humidity',
    title: 'Влажность воздуха',
    text: 'Отопление сушит воздух: опрыскайте листья утром мягкой водой или поставьте рядом ёмкость с водой.'
  }
])

const SEASON_CARE_TIPS = Object.freeze({
  autumn: {
    id: 'autumn-fertilize',
    title: 'Подкормки — по расписанию',
    text: 'Осенью рост замедляется: подкармливайте реже или не подкармливайте до весны, особенно если растение в прохладе.'
  },
  winter: {
    id: 'winter-light',
    title: 'Больше света',
    text: 'Зимой света мало: переставьте растения ближе к окну и не поливайте холодной водой.'
  },
  spring: {
    id: 'spring-repot',
    title: 'Пора пересадки',
    text: 'Весна — лучшее время пересадить растение, если корни показались из дренажных отверстий.'
  },
  summer: {
    id: 'summer-shade',
    title: 'Притените от солнца',
    text: 'В полдень солнце может оставить ожоги: притените окно тюлем или переставьте растение в полутень.'
  }
})

const FEATURE_TIPS = Object.freeze([
  {
    id: 'feature-missed',
    title: 'Пропущенный полив',
    text: 'Если не отметили полив вовремя, во вкладке «Пропущено» можно ответить «Полил(а) позже» — день не потеряется.'
  },
  {
    id: 'feature-care-tab',
    title: 'Уход рядом',
    text: 'Подкормка, опрыскивание и осмотр теперь во вкладке «Уход» — отмечайте их так же просто, как полив.'
  },
  {
    id: 'feature-first-day',
    title: 'Первый день',
    text: 'После добавления растения блок «Первый день» подскажет свет, сезон и дату первого полива.'
  },
  {
    id: 'feature-week',
    title: 'Неделя вперёд',
    text: 'Панель «На неделю» под календарём покажет, сколько поливов, подкормок и осмотров впереди.'
  },
  {
    id: 'feature-streak',
    title: 'Серия ухода',
    text: 'Если серия прервалась, в карточке серии будет видна причина, а заморозка поможет сохранить счёт.'
  },
  {
    id: 'feature-today',
    title: 'Один тап на полив',
    text: 'В сводке дня есть одна кнопка «Полить»: она отмечает все растения, которым нужен полив сегодня.'
  }
])

function plantLabel(plants) {
  const names = (Array.isArray(plants) ? plants : [])
    .map(plant => (typeof plant?.name === 'string' ? plant.name.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_NAMED_PLANTS)

  if (names.length === 0) return 'Ваши растения'
  if (names.length === 1) return `«${names[0]}»`
  return `«${names[0]}» и «${names[1]}»`
}

function dayIndex(date, timeZone) {
  const iso = zonedIsoDay(date, timeZone)
  if (!iso) return 0
  const parsed = toDate(iso)
  return Math.floor(parsed.getTime() / 86_400_000)
}

function pick(list, index) {
  if (!Array.isArray(list) || list.length === 0) return null
  const safeIndex = Math.abs(Math.trunc(index)) % list.length
  return list[safeIndex]
}

export function homeInsightSeenKey(now = new Date(), timeZone) {
  const iso = zonedIsoDay(now, timeZone)
  return iso ? `webplant.homeInsightSeen.${iso}` : 'webplant.homeInsightSeen'
}

export function buildDailyInsight({
  plants = [],
  seasonInfo = null,
  now = new Date(),
  timeZone
} = {}) {
  const season = seasonInfo?.season ?? 'autumn'
  const label = plantLabel(plants)
  const seasonTip = SEASON_PLANT_TIPS[season] ?? SEASON_PLANT_TIPS.autumn
  const index = dayIndex(now, timeZone)
  const careTip = SEASON_CARE_TIPS[season] ?? pick(BASE_CARE_TIPS, index)
  const featureTip = pick(FEATURE_TIPS, index)

  const items = [
    {
      id: `season-${season}`,
      title: 'Сезонный совет',
      text: `${label} ${seasonTip}.`
    },
    careTip,
    featureTip
  ].filter(Boolean)

  const iso = zonedIsoDay(now, timeZone)
  const parsed = iso ? toDate(iso) : new Date()

  return {
    key: iso || '',
    title: 'Что нового',
    dateLabel: `${parsed.getDate()} ${monthGenitive(parsed)}`,
    items
  }
}

export function homeInsightAriaLabel(insight) {
  if (!insight || !Array.isArray(insight.items) || insight.items.length === 0) {
    return 'Что нового'
  }
  return `Что нового: ${insight.items.map(item => item.title).join(', ')}`
}
