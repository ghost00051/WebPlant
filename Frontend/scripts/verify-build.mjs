
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const siteUrl = 'https://checktheplants.ru'

const problems = []
const checks = []
let assertions = 0

function fail(message) {
  problems.push(message)
}

function ok(message, condition) {
  assertions += 1
  if (condition) {
    checks.push(`  ✓ ${message}`)
  } else {
    fail(message)
  }
}

function extract(html, pattern) {
  const match = pattern.exec(html)
  return match ? match[1] : null
}

function metaContent(html, attribute, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"`,
    'i'
  )
  return extract(html, pattern)
}

function jsonLdBlocks(html) {
  const blocks = []
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

async function readPage(name) {
  try {
    return await readFile(join(dist, name), 'utf8')
  } catch {
    return null
  }
}

const files = await readdir(dist, { withFileTypes: true })
const htmlFiles = files
  .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
  .map(entry => entry.name)
  .filter(name => name !== '404.html')
  .sort()

const PRIVATE_PAGES = [
  'login.html',
  'register.html',
  'home.html',
  'add-plant.html',
  'edit-profile.html',
  'my-plants.html'
]

console.log('Проверка dist\n')

for (const required of [
  'index.html',
  '404.html',
  '.htaccess',
  'robots.txt',
  'sitemap.xml',
  'manifest.json',
  'favicon.ico',
  'og-image.png',
  'sw.js'
]) {
  const exists = await stat(join(dist, required)).then(() => true).catch(() => false)
  ok(`служебный файл ${required} присутствует`, exists)
}

{
  const keyFiles = (await readdir(dist))
    .filter(name => name.endsWith('.txt') && name !== 'robots.txt')
    .map(name => name.slice(0, -4))
    .filter(name => /^[a-zA-Z0-9-]{8,128}$/.test(name))

  ok('IndexNow: ровно один файл ключа', keyFiles.length === 1)

  if (keyFiles.length === 1) {
    const key = keyFiles[0]
    const content = (await readFile(join(dist, `${key}.txt`), 'utf8')).trim()
    ok('IndexNow: содержимое файла совпадает с именем ключа', content === key)
  }
}

const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8')
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
const today = new Date().toISOString().slice(0, 10)

ok('sitemap содержит более 20 URL', sitemapLocs.length > 20)
ok(
  'sitemap: все адреса на каноническом хосте',
  sitemapLocs.every(loc => loc.startsWith(`${siteUrl}/`) || loc === `${siteUrl}/`)
)
ok('sitemap: нет дублей адресов', new Set(sitemapLocs).size === sitemapLocs.length)
ok(
  'sitemap: нет дат в будущем',
  [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].every(m => m[1] <= today)
)
ok(
  'sitemap: нет закрытых разделов',
  !sitemapLocs.some(loc =>
    /\/(login|register|home|add-plant|edit-profile|my-plants)$/.test(loc)
  )
)

const sitemapPaths = new Set(
  sitemapLocs.map(loc => loc.replace(siteUrl, '') || '/')
)

function pageForPath(path) {
  if (path === '/') return 'index.html'
  const clean = path.replace(/^\//, '')
  const parts = clean.split('/')
  if (parts.length === 1) return `${parts[0]}.html`
  return `${parts[0]}-${parts.slice(1).join('-')}.html`
}

for (const path of sitemapPaths) {
  const file = pageForPath(path)
  const exists = await stat(join(dist, file)).then(() => true).catch(() => false)
  ok(`sitemap: ${path} → ${file}`, exists)
}

console.log('\nПубличные страницы:\n')

for (const file of htmlFiles) {
  if (PRIVATE_PAGES.includes(file)) continue

  const html = await readPage(file)
  if (!html) {
    fail(`${file}: не читается`)
    continue
  }

  const title = extract(html, /<title>([\s\S]*?)<\/title>/i)
  const description = metaContent(html, 'name', 'description')
  const robots = metaContent(html, 'name', 'robots')
  const canonical = extract(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i)
  const ogImage = metaContent(html, 'property', 'og:image')

  const issues = []
  if (!title) issues.push('нет title')
  if (!description) issues.push('нет description')
  if (!canonical) issues.push('нет canonical')
  if (robots && robots.includes('noindex')) issues.push('неожиданный noindex')
  if (!html.includes('data-prerendered="true"')) issues.push('нет пререндера')
  if (ogImage !== `${siteUrl}/og-image.png`) issues.push('og:image не 1200x630-обложка')

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  if (bodyText.trim().length < 400) issues.push('мало текста в пререндере')

  for (const block of jsonLdBlocks(html)) {
    try {
      JSON.parse(block)
    } catch {
      issues.push('невалидный JSON-LD')
    }
  }

  if (description && description.length > 200) {
    issues.push(`description слишком длинный (${description.length})`)
  }
  if (title && title.length > 90) {
    issues.push(`title слишком длинный (${title.length})`)
  }

  assertions += 1
  if (issues.length) {
    fail(`${file}: ${issues.join(', ')}`)
  } else {
    checks.push(`  ✓ ${file} — ${title}`)
  }
}

console.log('\nЗакрытые разделы:\n')

for (const file of PRIVATE_PAGES) {
  const html = await readPage(file)
  if (!html) {
    fail(`${file}: отсутствует`)
    continue
  }
  const robots = metaContent(html, 'name', 'robots')
  const hasNoindex = Boolean(robots && robots.includes('noindex'))
  const hasJsonLd = jsonLdBlocks(html).length > 0
  ok(`${file}: noindex`, hasNoindex)
  ok(`${file}: без структурированных данных`, !hasJsonLd)
  ok(`${file}: без пререндера`, !html.includes('data-prerendered="true"'))
}

{
  const html = await readPage('404.html')
  const robots = html ? metaContent(html, 'name', 'robots') : null
  ok('404.html: noindex', Boolean(robots && robots.includes('noindex')))
  ok('404.html: не подменяет главную', Boolean(html && !html.includes('data-prerendered')))
}

{
  const robots = await readFile(join(dist, 'robots.txt'), 'utf8')
  ok('robots.txt: указывает на sitemap', robots.includes(`${siteUrl}/sitemap.xml`))
  ok('robots.txt: не закрывает весь сайт', !/^Disallow:\s*\/\s*$/m.test(robots))
}

{
  const htaccess = await readFile(join(dist, '.htaccess'), 'utf8')
  ok('.htaccess: неизвестные адреса дают 404', /R=404/.test(htaccess))
  ok('.htaccess: нет заглушки ErrorDocument', !/ErrorDocument 404 "htaccess-OK"/.test(htaccess))
  ok('.htaccess: ErrorDocument указывает на страницу', /ErrorDocument 404 \/404\.html/.test(htaccess))
  ok('.htaccess: дубль index.html перенаправляется', /index\\\.html/.test(htaccess))
  ok(
    '.htaccess: есть правила для справочника и статей',
    /\^plants\/\?/.test(htaccess) && /\^care\/\?/.test(htaccess) &&
    /\^plants\/\(\[a-z0-9-\]\+\)/.test(htaccess)
  )
  ok('.htaccess: настроено кеширование', /max-age=31536000/.test(htaccess))
  ok('.htaccess: настроено сжатие', /mod_deflate/.test(htaccess))
}

{
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'))
  const sizes = (manifest.icons ?? []).map(icon => icon.sizes)
  ok('manifest: есть иконка 192x192', sizes.includes('192x192'))
  ok('manifest: есть иконка 512x512', sizes.includes('512x512'))
  ok(
    'manifest: есть maskable-иконка',
    (manifest.icons ?? []).some(icon => icon.purpose === 'maskable')
  )
  ok('manifest: указан язык', manifest.lang === 'ru')
  ok(
    'manifest: иконки существуют',
    (await Promise.all(
      (manifest.icons ?? []).map(icon =>
        stat(join(dist, icon.src.replace(/^\//, ''))).then(() => true).catch(() => false)
      )
    )).every(Boolean)
  )
}

function pngSize(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

{
  const pngs = {
    'icons/icon-192.png': [192, 192],
    'icons/icon-512.png': [512, 512],
    'icons/icon-maskable-512.png': [512, 512],
    'icons/apple-touch-icon.png': [180, 180],
    'og-image.png': [1200, 630]
  }
  for (const [file, [width, height]] of Object.entries(pngs)) {
    const buffer = await readFile(join(dist, file)).catch(() => null)
    if (!buffer) {
      fail(`${file}: отсутствует`)
      continue
    }
    const size = pngSize(buffer)
    ok(
      `${file}: реальный размер ${width}x${height}`,
      Boolean(size && size.width === width && size.height === height)
    )
  }
}

{
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  ok('index.html: summary_large_image', html.includes('summary_large_image'))
  ok('index.html: og:image:alt', html.includes('og:image:alt'))
  ok('index.html: FAQPage в разметке', html.includes('FAQPage'))
  ok('index.html: mobile-web-app-capable', html.includes('mobile-web-app-capable'))
  ok('index.html: тема выставляется до отрисовки', /webplant-theme/.test(html))
  ok('index.html: нет курсивной оси Inter', !html.includes('ital,opsz'))
  ok('index.html: нет устаревшей ссылки на icon-192.v2.png', !html.includes('icon-192.v2.png'))

  const internalLinks = [...html.matchAll(/href="(\/(?!assets\/)[^"]*)"/g)]
    .map(m => m[1])
    .filter(href => !href.startsWith('//'))
  const contentLinks = internalLinks.filter(href =>
    href.startsWith('/plants') || href.startsWith('/care')
  )
  ok(
    `index.html: внутренние ссылки на контент (${contentLinks.length})`,
    contentLinks.length >= 15
  )

  const preloads = [...html.matchAll(/rel="modulepreload"[^>]*href="([^"]+)"/g)]
    .map(m => m[1])
  ok(
    'index.html: момент и календарь не предзагружаются на главной',
    !preloads.some(href => /home|AddPlantPage|myPlant|registration/.test(href))
  )
}

{
  const assets = await readdir(join(dist, 'assets'))
  let momentFound = null
  for (const asset of assets.filter(name => name.endsWith('.js'))) {
    const content = await readFile(join(dist, 'assets', asset), 'utf8')
    if (content.includes('Invalid date') && content.includes('moment')) {
      momentFound = asset
    }
  }
  ok('moment отсутствует в сборке', momentFound === null)
}

console.log(`\nПроверок выполнено: ${assertions}`)
if (problems.length) {
  console.error(`\n✗ Найдено проблем: ${problems.length}\n`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(checks.join('\n'))
console.log('\n✓ Все проверки пройдены')
