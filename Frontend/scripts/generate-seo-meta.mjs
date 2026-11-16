import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import {
  ARTICLE_META_OVERRIDES,
  PLANT_META_OVERRIDES
} from '../src/data/seoOverrides.js'

const root = resolve(import.meta.dirname, '..')
const targetPath = resolve(root, 'src/data/seoMeta.js')
const checkOnly = process.argv.includes('--check')

const MAX_DESCRIPTION_LENGTH = 160
const MAX_TITLE_LENGTH = 60

const PLANT_TITLE_SUFFIX = 'полив и уход — Лейка'
const PLANT_DESCRIPTION_TAIL = 'Признаки проблем, вредители и сезонный уход — в справочнике «Лейки».'

function clampDescription(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized

  const cut = normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')
  return `${trimmed}…`
}

function clampTitle(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized
  const cut = normalized.slice(0, MAX_TITLE_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s–-]+$/, '')}…`
}

function buildIndex(plants, articles) {
  const plantMeta = {}
  const plantNav = []
  for (const plant of plants) {
    const override = PLANT_META_OVERRIDES[plant.slug] || {}
    plantMeta[plant.slug] = {
      title: clampTitle(
        override.title || `${plant.name} (${plant.latin}): ${PLANT_TITLE_SUFFIX}`
      ),
      description: clampDescription(
        override.description ||
          `${plant.name}: как часто поливать (${plant.intervalLabel}), ${plant.light.toLowerCase()}. ${PLANT_DESCRIPTION_TAIL}`
      )
    }
    plantNav.push({
      slug: plant.slug,
      name: plant.name,
      intervalLabel: plant.intervalLabel
    })
  }

  const articleMeta = {}
  const articleNav = []
  for (const article of articles) {
    const override = ARTICLE_META_OVERRIDES[article.slug] || {}
    articleMeta[article.slug] = {
      title: clampTitle(override.title || `${article.title} — Лейка`),
      description: clampDescription(override.description || article.description)
    }
    articleNav.push({ slug: article.slug, title: article.title })
  }

  return { plantMeta, articleMeta, plantNav, articleNav }
}

function collectMetaIssues({ plantMeta, articleMeta, plantNav, articleNav }) {
  const issues = []
  const titles = new Map()
  const descriptions = new Map()

  const remember = (map, value, key) => {
    const normalized = value.toLowerCase()
    if (map.has(normalized)) {
      issues.push(`дубль метаданных: «${key}» совпадает с «${map.get(normalized)}»`)
      return
    }
    map.set(normalized, key)
  }

  for (const nav of plantNav) {
    const meta = plantMeta[nav.slug]
    if (!meta) {
      issues.push(`нет метаданных для растения ${nav.slug}`)
      continue
    }
    if (meta.title.length > MAX_TITLE_LENGTH) issues.push(`длинный title растения ${nav.slug}`)
    if (meta.description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push(`длинное description растения ${nav.slug}`)
    }
    remember(titles, meta.title, nav.slug)
    remember(descriptions, meta.description, nav.slug)
  }

  for (const nav of articleNav) {
    const meta = articleMeta[nav.slug]
    if (!meta) {
      issues.push(`нет метаданных для статьи ${nav.slug}`)
      continue
    }
    if (meta.title.length > MAX_TITLE_LENGTH) issues.push(`длинный title статьи ${nav.slug}`)
    if (meta.description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push(`длинное description статьи ${nav.slug}`)
    }
    remember(titles, meta.title, nav.slug)
    remember(descriptions, meta.description, nav.slug)
  }

  return issues
}

function serialize({ plantMeta, articleMeta, plantNav, articleNav }) {
  const body = [
    `export const PLANT_META = ${JSON.stringify(plantMeta, null, 2)}`,
    '',
    `export const ARTICLE_META = ${JSON.stringify(articleMeta, null, 2)}`,
    '',
    `export const PLANT_NAV = ${JSON.stringify(plantNav, null, 2)}`,
    '',
    `export const ARTICLE_NAV = ${JSON.stringify(articleNav, null, 2)}`,
    '',
    'export function getPlantMeta(slug) {',
    '  return PLANT_META[slug] ?? null',
    '}',
    '',
    'export function getArticleMeta(slug) {',
    '  return ARTICLE_META[slug] ?? null',
    '}',
    ''
  ].join('\n')

  return body
}

const vite = await createServer({
  configFile: resolve(root, 'vite.config.js'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const [{ PLANTS }, { ARTICLES }] = await Promise.all([
    vite.ssrLoadModule('/src/data/plants.js'),
    vite.ssrLoadModule('/src/data/careArticles.js'),
  ])

  const index = buildIndex(PLANTS, ARTICLES)
  const issues = collectMetaIssues(index)
  if (issues.length) {
    console.error('✗ Метаданные не прошли проверку:')
    for (const issue of issues) console.error(`  ✗ ${issue}`)
    process.exit(1)
  }

  const expected = serialize(index)

  if (checkOnly) {
    const actual = await readFile(targetPath, 'utf8').catch(() => '')
    if (actual.trim() !== expected.trim()) {
      console.error(
        '✗ src/data/seoMeta.js устарел. Запустите: node scripts/generate-seo-meta.mjs'
      )
      process.exit(1)
    }
    console.log('✓ src/data/seoMeta.js актуален')
  } else {
    await writeFile(targetPath, expected, 'utf8')
    console.log(
      `✓ src/data/seoMeta.js обновлён: ${PLANTS.length} растений, ${ARTICLES.length} статей, ` +
      `${Object.keys(ARTICLE_META_OVERRIDES).length} ручных title/description`
    )
  }
} finally {
  await vite.close()
}
