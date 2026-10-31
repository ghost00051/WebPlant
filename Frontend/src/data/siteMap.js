
import { ARTICLES } from './careArticles.js'
import { PLANTS } from './plants.js'

export const SITE_URL = 'https://checktheplants.ru'

export const HOME_PATH = '/'
export const PLANTS_PATH = '/plants'
export const CARE_PATH = '/care'

export const SECTION_META = {
  home: {
    title: 'Лейка — полив комнатных растений: календарь и напоминания',
    description:
      'Расписание полива, напоминания и дневник ухода за комнатными растениями. Справочник растений и статьи по уходу — в бесплатной «Лейке».'
  },
  plants: {
    title: 'Комнатные растения: справочник полива и ухода — Лейка',
    description:
      'Частота полива, свет и типичные проблемы популярных комнатных растений: монстера, фикус, сансевиерия, спатифиллум и другие. Справочник «Лейки».'
  },
  care: {
    title: 'Уход за комнатными растениями: статьи и руководства — Лейка',
    description:
      'Как часто поливать, почему желтеют листья, полив зимой и в отпуске — понятные руководства по уходу за комнатными растениями с расчётом интервалов.'
  }
}

export const MAIN_NAV = [
  { path: PLANTS_PATH, label: 'Справочник растений' },
  { path: CARE_PATH, label: 'Уход' }
]

export const CARE_INDEX_FAQ = [
  {
    question: 'Как часто поливать комнатные растения?',
    answer:
      'Ориентир для обычных комнатных условий: монстера, фикус и драцена — раз в 7–10 дней, спатифиллум и бегония — раз в 3–5 дней, сансевиерия, замиокулькас и каланхоэ — раз в 2–3 недели. Интервал зависит от света, температуры, размера горшка и состава грунта, поэтому его уточняют по скорости просыхания земли на глубине 3–4 см.'
  },
  {
    question: 'Почему желтеют листья у комнатных растений?',
    answer:
      'Чаще всего из-за перелива: грунт остаётся сырым, корни перестают дышать. Другие причины — нехватка света, сухой воздух, жёсткая вода, дефицит питания и естественное старение нижних листьев. Определить причину помогают вид растения, расположение пожелтевших листьев и состояние грунта.'
  },
  {
    question: 'Можно ли оставить растения без полива на время отпуска?',
    answer:
      'Да, на 1–3 недели большинство комнатных растений переносит отсутствие полива, если подготовиться: убрать горшки от прямого солнца, хорошо увлажнить грунт перед отъездом, использовать фитильный полив или группировку растений. Кактусы и суккуленты спокойно переносят две-три недели сухости.'
  },
  {
    question: 'Нужно ли опрыскивать комнатные растения?',
    answer:
      'Опрыскивание ненадолго повышает влажность, но не заменяет её общий уровень. Тропическим растениям с влажностью 60 % и выше полезнее поддон с влажным керамзитом, увлажнитель воздуха или группировка растений рядом друг с другом.'
  }
]

export function plantPath(slug) {
  return `${PLANTS_PATH}/${slug}`
}

export function articlePath(slug) {
  return `${CARE_PATH}/${slug}`
}

export const ARTICLE_TOPICS = {
  'kak-ponyat-pora-polivat': [
    'watering-check', 'overwatering', 'yellowing'
  ],
  'kak-chasto-polivat': [
    'watering-frequency', 'watering-check', 'light', 'soil'
  ],
  'poliv-zimoy-i-letom': [
    'seasons', 'watering-frequency', 'light', 'humidity'
  ],
  'pochemu-zhelteyut-listya': [
    'yellowing', 'overwatering', 'humidity'
  ],
  'poliv-v-otpuske': [
    'vacation', 'watering-frequency', 'humidity'
  ],
  'peresadka-posle-pokupki': [
    'repotting', 'soil', 'pests', 'light'
  ],
  'vlazhnost-vozduha': [
    'humidity', 'yellowing', 'light'
  ],
  'osveshchenie-dlya-rasteniy': [
    'light', 'yellowing', 'seasons'
  ],
  'letniy-uhod': [
    'seasons', 'light', 'pests'
  ],
  'vesennyaya-obrabotka': [
    'pests', 'repotting', 'seasons'
  ],
  'kak-vesti-dnevnik-uhoda': [
    'diary', 'watering-frequency', 'watering-check', 'yellowing'
  ]
}

export const PLANT_TOPICS = {
  monstera: ['watering-frequency', 'humidity', 'light', 'yellowing'],
  'ficus-benjamina': ['watering-frequency', 'yellowing', 'light', 'repotting'],
  sansevieria: ['watering-frequency', 'overwatering', 'light', 'vacation', 'soil'],
  spathiphyllum: ['humidity', 'watering-frequency', 'light', 'yellowing'],
  zamioculcas: ['watering-frequency', 'overwatering', 'light', 'vacation'],
  chlorophytum: ['watering-frequency', 'humidity', 'light', 'vacation'],
  dracaena: ['humidity', 'yellowing', 'light', 'watering-frequency'],
  begonia: ['humidity', 'watering-frequency', 'light', 'yellowing', 'soil'],
  kalanchoe: ['light', 'watering-frequency', 'vacation', 'seasons'],
  'orchid-phalaenopsis': ['watering-frequency', 'humidity', 'overwatering', 'light', 'yellowing']
}

function countSharedTopics(sourceTopics, candidateTopics) {
  if (!Array.isArray(sourceTopics) || !Array.isArray(candidateTopics)) return 0
  const candidateSet = new Set(candidateTopics)
  let shared = 0
  for (const topic of sourceTopics) {
    if (candidateSet.has(topic)) shared += 1
  }
  return shared
}

function rankByTopics(items, sourceTopics, candidateTopics, currentSlug, limit) {
  const source = Array.isArray(sourceTopics) ? sourceTopics : []
  const scored = []
  const seenSlugs = new Set()
  items.forEach((item, index) => {
    if (!item || typeof item.slug !== 'string' || item.slug === currentSlug) return
    if (seenSlugs.has(item.slug)) return
    seenSlugs.add(item.slug)
    const topics = Array.isArray(candidateTopics[item.slug]) ? candidateTopics[item.slug] : []
    const shared = countSharedTopics(source, topics)
    const union = new Set([...source, ...topics]).size
    scored.push({ item, index, shared, union })
  })
  scored.sort((left, right) => {
    if (right.shared !== left.shared) return right.shared - left.shared
    if (left.shared > 0 && left.union > 0 && right.union > 0) {
      const leftRatio = left.shared * right.union
      const rightRatio = right.shared * left.union
      if (leftRatio !== rightRatio) return rightRatio - leftRatio
    }
    return left.index - right.index
  })
  return scored.slice(0, Math.max(0, Number(limit) || 0)).map(entry => entry.item)
}

export function getRelatedArticles(slug, limit = 3) {
  return rankByTopics(ARTICLES, ARTICLE_TOPICS[slug] ?? [], ARTICLE_TOPICS, slug, limit)
}

export function getRelatedPlants(slug, limit = 4) {
  return rankByTopics(PLANTS, PLANT_TOPICS[slug] ?? [], PLANT_TOPICS, slug, limit)
}

export function getPlantArticles(plantSlug, limit = 3) {
  return rankByTopics(ARTICLES, PLANT_TOPICS[plantSlug] ?? [], ARTICLE_TOPICS, null, limit)
}

export function getArticlePlants(articleSlug, limit = 3) {
  return rankByTopics(PLANTS, ARTICLE_TOPICS[articleSlug] ?? [], PLANT_TOPICS, null, limit)
}

function toPrerenderList() {
  const pages = [
    {
      route: 'index.html',
      path: HOME_PATH,
      kind: 'home'
    },
    {
      route: 'plants.html',
      path: PLANTS_PATH,
      kind: 'plantsIndex',
      title: SECTION_META.plants.title,
      description: SECTION_META.plants.description
    },
    {
      route: 'care.html',
      path: CARE_PATH,
      kind: 'careIndex',
      title: SECTION_META.care.title,
      description: SECTION_META.care.description
    }
  ]

  for (const plant of PLANTS) {
    pages.push({
      route: `plants-${plant.slug}.html`,
      path: plantPath(plant.slug),
      kind: 'plantDetail',
      slug: plant.slug,
      title: `${plant.name} (${plant.latin}): полив и уход — Лейка`,
      description: `${plant.name}: полив ${plant.intervalLabel}, ${plant.light.toLowerCase()}. Признаки проблем и что делать.`,
      lastmod: plant.updated || undefined
    })
  }

  for (const article of ARTICLES) {
    pages.push({
      route: `care-${article.slug}.html`,
      path: articlePath(article.slug),
      kind: 'articleDetail',
      slug: article.slug,
      title: `${article.title} — Лейка`,
      description: article.description,
      lastmod: article.updated
    })
  }

  return pages
}

export const PUBLIC_PAGES = toPrerenderList()
