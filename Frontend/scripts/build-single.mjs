import { copyFile, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const outputDirectory = resolve(root, 'dist')
const siteUrl = 'https://checktheplants.ru'
const buildDate = new Date().toISOString().slice(0, 10)

const { PLANTS } = await import(new URL('../src/data/plants.js', import.meta.url).href)
const { ARTICLES } = await import(new URL('../src/data/careArticles.js', import.meta.url).href)
const { HOME_PATH, PLANTS_PATH, CARE_PATH, plantPath, articlePath } = await import(new URL('../src/data/siteMap.js', import.meta.url).href)

const publicPages = new Set([
  'index.html',
  'plants.html',
  'care.html',
  ...PLANTS.map(plant => `plants-${plant.slug}.html`),
  ...ARTICLES.map(article => `care-${article.slug}.html`)
])

const keep = new Set([
  'index.html',
  '404.html',
  'login.html',
  'register.html',
  'home.html',
  'add-plant.html',
  'edit-profile.html',
  'my-plants.html',
  'reset-password.html',
  '.htaccess',
  'robots.txt',
  'sitemap.xml',
  'manifest.json',
  'sw.js',
  'favicon.ico',
  'og-image.png'
])

const entries = await readdir(outputDirectory)
const removed = []
for (const entry of entries) {
  if (!entry.endsWith('.html')) continue
  if (keep.has(entry)) continue
  await unlink(resolve(outputDirectory, entry))
  removed.push(entry)
}

const indexPath = resolve(outputDirectory, 'index.html')
const shell = (await readFile(indexPath, 'utf8')).replace(
  /<div id="root" data-prerendered="true">[\s\S]*?<\/div>/,
  '<div id="root"></div>'
)
await writeFile(indexPath, shell)

const sitemapEntries = [
  { path: HOME_PATH, lastmod: buildDate, changefreq: 'weekly', priority: '1.0' },
  { path: PLANTS_PATH, lastmod: buildDate, changefreq: 'monthly', priority: '0.9' },
  { path: CARE_PATH, lastmod: buildDate, changefreq: 'weekly', priority: '0.9' },
  ...PLANTS.map(plant => ({
    path: plantPath(plant.slug),
    lastmod: plant.updated || buildDate,
    changefreq: 'monthly',
    priority: '0.8'
  })),
  ...ARTICLES.map(article => ({
    path: articlePath(article.slug),
    lastmod: article.updated || buildDate,
    changefreq: 'monthly',
    priority: '0.7'
  }))
]

const urls = sitemapEntries.map(entry => [
  '  <url>',
  `    <loc>${siteUrl}${entry.path}</loc>`,
  `    <lastmod>${entry.lastmod}</lastmod>`,
  `    <changefreq>${entry.changefreq}</changefreq>`,
  `    <priority>${entry.priority}</priority>`,
  '  </url>'
].join('\n'))

await writeFile(
  resolve(outputDirectory, 'sitemap.xml'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n'),
  'utf8'
)

await copyFile(resolve(root, 'htaccess'), resolve(outputDirectory, '.htaccess'))

const remaining = (await readdir(outputDirectory)).filter(name => name.endsWith('.html'))
console.log(`✓ Режим одного index.html: удалено ${removed.length} отдельных страниц`)
console.log(`  осталось HTML-файлов: ${remaining.length} (${remaining.sort().join(', ')})`)
console.log(`  sitemap: ${sitemapEntries.length} URL`)
console.log('  все публичные маршруты отдаются одним index.html, приватные и 404 — своими файлами')
