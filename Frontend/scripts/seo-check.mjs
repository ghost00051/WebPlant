import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const siteUrl = 'https://checktheplants.ru'

const problems = []
const rows = []

function fail(message) {
  problems.push(message)
}

function metaContent(html, attribute, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(
    `<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"`,
    'i'
  ).exec(html)
  return match ? match[1] : null
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function jsonLdBlocks(html) {
  const blocks = []
  const pattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(html)) !== null) blocks.push(match[1])
  return blocks
}

function jsonLdTypes(html) {
  const types = []
  for (const block of jsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(block)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of list) {
        if (item && item['@type']) types.push(String(item['@type']))
      }
    } catch {
      fail('невалидный JSON-LD')
    }
  }
  return types
}

function pageFile(path) {
  if (path === '/') return 'index.html'
  const clean = path.replace(/^\//, '')
  const parts = clean.split('/')
  if (parts.length === 1) return `${parts[0]}.html`
  return `${parts[0]}-${parts.slice(1).join('-')}.html`
}

const sitemapXml = await readFile(join(dist, 'sitemap.xml'), 'utf8').catch(() => null)
if (!sitemapXml) {
  console.error('✗ dist/sitemap.xml не найден — сначала соберите проект (npm run build)')
  process.exit(1)
}

const sitemapLocations = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
const sitemapPaths = sitemapLocations.map(loc => loc.replace(siteUrl, '') || '/')
const lastmods = [...sitemapXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(match => match[1])
const today = new Date().toISOString().slice(0, 10)

if (new Set(sitemapLocations).size !== sitemapLocations.length) fail('sitemap: дубли адресов')
if (lastmods.some(lastmod => !/^\d{4}-\d{2}-\d{2}$/.test(lastmod))) {
  fail('sitemap: lastmod не в формате YYYY-MM-DD')
}
if (lastmods.some(lastmod => lastmod > today)) fail('sitemap: lastmod в будущем')

const titles = new Map()
const descriptions = new Map()
const canonicals = new Map()

for (const path of sitemapPaths) {
  const file = pageFile(path)
  const html = await readFile(join(dist, file), 'utf8').catch(() => null)
  if (!html) {
    fail(`sitemap: ${path} → нет файла ${file}`)
    continue
  }

  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [null, null])[1]
  const description = metaContent(html, 'name', 'description')
  const robots = metaContent(html, 'name', 'robots')
  const canonical = (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html) || [null, null])[1]
  const expectedUrl = path === '/' ? `${siteUrl}/` : `${siteUrl}${path}`

  if (!title) fail(`${path}: нет title`)
  else {
    if (title.length < 20) fail(`${path}: короткий title (${title.length})`)
    if (title.length > 90) fail(`${path}: длинный title (${title.length})`)
    if (titles.has(title)) fail(`${path}: title совпадает с ${titles.get(title)}`)
    else titles.set(title, path)
  }

  if (!description) fail(`${path}: нет description`)
  else {
    if (description.length < 50) fail(`${path}: короткое description (${description.length})`)
    if (description.length > 200) fail(`${path}: длинное description (${description.length})`)
    if (descriptions.has(description)) {
      fail(`${path}: description совпадает с ${descriptions.get(description)}`)
    } else descriptions.set(description, path)
  }

  if (!canonical) fail(`${path}: нет canonical`)
  else {
    if (canonical !== expectedUrl) fail(`${path}: canonical ${canonical} ≠ ${expectedUrl}`)
    if (canonicals.has(canonical)) fail(`${path}: canonical совпадает с ${canonicals.get(canonical)}`)
    else canonicals.set(canonical, path)
  }

  if (robots && robots.includes('noindex')) fail(`${path}: неожиданный noindex`)
  if (!html.includes('data-prerendered="true"')) fail(`${path}: нет пререндера`)

  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => stripTags(match[1]))
  if (h1.length !== 1) fail(`${path}: h1 ${h1.length} раз(а)`)
  else if (!h1[0]) fail(`${path}: пустой h1`)

  const h2Count = (html.match(/<h2\b/gi) || []).length
  if (h2Count < 2 && path !== '/') fail(`${path}: мало h2 (${h2Count})`)

  const ogTitle = metaContent(html, 'property', 'og:title')
  const ogImage = metaContent(html, 'property', 'og:image')
  const twitterCard = metaContent(html, 'name', 'twitter:card')
  if (!ogTitle) fail(`${path}: нет og:title`)
  if (ogImage !== `${siteUrl}/og-image.png`) fail(`${path}: og:image не обложка`)
  if (twitterCard !== 'summary_large_image') fail(`${path}: нет twitter:card`)

  const types = jsonLdTypes(html)
  if (!types.length) fail(`${path}: нет JSON-LD`)

  if (path === '/') {
    for (const required of ['WebApplication', 'WebSite', 'FAQPage']) {
      if (!types.includes(required)) fail(`${path}: нет ${required} в JSON-LD`)
    }
  }
  if (path === '/plants' || path === '/care') {
    for (const required of ['BreadcrumbList', 'ItemList']) {
      if (!types.includes(required)) fail(`${path}: нет ${required} в JSON-LD`)
    }
  }
  if (path.startsWith('/plants/') || path.startsWith('/care/')) {
    for (const required of ['BreadcrumbList', 'Article']) {
      if (!types.includes(required)) fail(`${path}: нет ${required} в JSON-LD`)
    }
  }

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0])
  for (const image of images) {
    if (!/\balt=/.test(image)) fail(`${path}: img без alt (${image.slice(0, 60)})`)
  }

  const internalLinks = [...html.matchAll(/href="(\/(?!assets\/)[^"]*)"/g)]
    .map(match => match[1])
    .filter(href => !href.startsWith('//'))
  if (path === '/' && internalLinks.filter(href => href.startsWith('/plants') || href.startsWith('/care')).length < 15) {
    fail(`${path}: мало внутренних ссылок на контент`)
  }

  const text = stripTags(html)
  const words = text.split(' ').filter(Boolean).length
  if (words < 120) fail(`${path}: мало текста (${words} слов)`)
  rows.push(
    `${path.padEnd(34)} title=${String(title.length).padStart(3)} desc=${String(description.length).padStart(3)} words=${String(words).padStart(5)}`
  )
}

const PRIVATE_PAGES = [
  'login.html',
  'register.html',
  'home.html',
  'add-plant.html',
  'edit-profile.html',
  'my-plants.html',
  'reset-password.html',
  'notifications.html',
  'garden.html'
]

for (const file of PRIVATE_PAGES) {
  const html = await readFile(join(dist, file), 'utf8').catch(() => null)
  if (!html) {
    fail(`${file}: отсутствует`)
    continue
  }
  const robots = metaContent(html, 'name', 'robots')
  if (!robots || !robots.includes('noindex')) fail(`${file}: нет noindex`)
  if (jsonLdBlocks(html).length) fail(`${file}: JSON-LD в закрытом разделе`)
}

{
  const html = await readFile(join(dist, '404.html'), 'utf8').catch(() => null)
  if (!html) fail('404.html: отсутствует')
  else {
    const robots = metaContent(html, 'name', 'robots')
    if (!robots || !robots.includes('noindex')) fail('404.html: нет noindex')
    if ((html.match(/<h1\b/gi) || []).length !== 1) fail('404.html: не ровно один h1')
  }
}

{
  const robots = await readFile(join(dist, 'robots.txt'), 'utf8').catch(() => '')
  if (!robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) fail('robots.txt: нет Sitemap')
  if (!/^Clean-param:/m.test(robots)) fail('robots.txt: нет Clean-param')
  if (!/^Disallow:\s*\/garden\/\s*$/m.test(robots)) fail('robots.txt: /garden/ открыт')
}

{
  const htaccess = await readFile(join(dist, '.htaccess'), 'utf8').catch(() => '')
  if (!/DirectorySlash Off/.test(htaccess)) fail('.htaccess: нет DirectorySlash Off')
  if (!/ErrorDocument 404 \/404\.html/.test(htaccess)) fail('.htaccess: нет ErrorDocument')
}

console.log('SEO-проверка dist\n')
for (const row of rows) console.log(`  ${row}`)

if (problems.length) {
  console.error(`\n✗ Проблем: ${problems.length}\n`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(
  `\n✓ SEO-проверка пройдена: ${sitemapPaths.length} indexable URL, ${PRIVATE_PAGES.length} noindex`
)
