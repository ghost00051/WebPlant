
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const targetPath = resolve(root, 'src/data/seoMeta.js')
const checkOnly = process.argv.includes('--check')

const MAX_DESCRIPTION_LENGTH = 160

function clampDescription(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized

  const cut = normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')
  return `${trimmed}…`
}

function buildIndex(plants, articles) {
  const plantMeta = {}
  const plantNav = []
  for (const plant of plants) {
    plantMeta[plant.slug] = {
      title: `${plant.name} (${plant.latin}): полив и уход — Лейка`,
      description: clampDescription(
        `${plant.name}: полив ${plant.intervalLabel}, ${plant.light.toLowerCase()}. Признаки проблем и что делать.`
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
    articleMeta[article.slug] = {
      title: `${article.title} — Лейка`,
      description: clampDescription(article.description)
    }
    articleNav.push({ slug: article.slug, title: article.title })
  }

  return { plantMeta, articleMeta, plantNav, articleNav }
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

  const expected = serialize(buildIndex(PLANTS, ARTICLES))

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
      `✓ src/data/seoMeta.js обновлён: ${PLANTS.length} растений, ${ARTICLES.length} статей`
    )
  }
} finally {
  await vite.close()
}
