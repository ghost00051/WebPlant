
import { ARTICLES } from './careArticles.js'
import { PLANTS } from './plants.js'

export const SITE_URL = 'https://checktheplants.ru'

export const HOME_PATH = '/'
export const PLANTS_PATH = '/plants'
export const CARE_PATH = '/care'

export const MAIN_NAV = [
  { path: PLANTS_PATH, label: 'Справочник растений' },
  { path: CARE_PATH, label: 'Уход' }
]

export function plantPath(slug) {
  return `${PLANTS_PATH}/${slug}`
}

export function articlePath(slug) {
  return `${CARE_PATH}/${slug}`
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
      title: 'Комнатные растения: справочник по поливу и уходу — Лейка',
      description:
        'Частота полива, требования к свету и влажности, типичные проблемы популярных комнатных растений. Справочник «Лейки».'
    },
    {
      route: 'care.html',
      path: CARE_PATH,
      kind: 'careIndex',
      title: 'Уход за комнатными растениями: статьи и руководства — Лейка',
      description:
        'Как понять, пора ли поливать, что делать при переливе, как подготовить растения к отпуску и другие руководства по уходу.'
    }
  ]

  for (const plant of PLANTS) {
    pages.push({
      route: `plants-${plant.slug}.html`,
      path: plantPath(plant.slug),
      kind: 'plantDetail',
      slug: plant.slug,
      title: `${plant.name} (${plant.latin}): полив и уход — Лейка`,
      description: `${plant.name}: полив ${plant.intervalLabel}, ${plant.light.toLowerCase()}. Признаки проблем и что делать.`
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
