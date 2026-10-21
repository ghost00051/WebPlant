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
  'my-plants.html',
  'reset-password.html',
  'notifications.html'
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
{
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1])
  ok(
    'sitemap: нет дат в будущем',
    lastmods.every(lastmod => lastmod <= today)
  )
  ok(
    'sitemap: lastmod автоматический (есть дата текущей сборки)',
    lastmods.includes(today)
  )
}
ok(
  'sitemap: нет закрытых разделов',
  !sitemapLocs.some(loc =>
    /\/(login|register|home|add-plant|edit-profile|my-plants|reset-password)$/.test(loc)
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

const PRIVATE_TITLES = {
  'notifications.html': 'Уведомления — Лейка',
  'reset-password.html': 'Восстановление пароля — Лейка',
  'home.html': 'Мой сад — Лейка',
  'my-plants.html': 'Мои растения — Лейка',
  'add-plant.html': 'Добавление растения — Лейка',
  'edit-profile.html': 'Настройки профиля — Лейка',
  'login.html': 'Вход — Лейка',
  'register.html': 'Регистрация — Лейка'
}

for (const file of PRIVATE_PAGES) {
  const html = await readPage(file)
  if (!html) {
    fail(`${file}: отсутствует`)
    continue
  }
  const robots = metaContent(html, 'name', 'robots')
  const hasNoindex = Boolean(robots && robots.includes('noindex'))
  const hasJsonLd = jsonLdBlocks(html).length > 0
  const title = extract(html, /<title>([\s\S]*?)<\/title>/i)
  ok(`${file}: noindex`, hasNoindex)
  ok(`${file}: без структурированных данных`, !hasJsonLd)
  ok(`${file}: без пререндера`, !html.includes('data-prerendered="true"'))
  if (PRIVATE_TITLES[file]) {
    ok(`${file}: корректный title (${PRIVATE_TITLES[file]})`, title === PRIVATE_TITLES[file])
  }
}

{
  const seoSource = await readFile(
    resolve(root, 'src/component/SeoMetadata/SeoMetadata.jsx'),
    'utf8'
  )
  ok(
    'SeoMetadata: /notifications в PRIVATE_META',
    /'\/notifications':[\s\S]*?indexable: false/.test(seoSource)
  )
  ok(
    'SeoMetadata: /reset-password в PRIVATE_META',
    /'\/reset-password':[\s\S]*?indexable: false/.test(seoSource)
  )
  ok(
    'SeoMetadata: неизвестный путь → noindex, а не HOME_META',
    /return UNKNOWN_META/.test(seoSource)
  )
}

{
  const html = await readPage('404.html')
  const robots = html ? metaContent(html, 'name', 'robots') : null
  ok('404.html: noindex', Boolean(robots && robots.includes('noindex')))
  ok('404.html: не подменяет главную', Boolean(html && !html.includes('data-prerendered')))
  ok(
    '404.html: ссылки на справочник и статьи об уходе',
    Boolean(html && html.includes('href="/plants"') && html.includes('href="/care"'))
  )
  ok(
    '404.html: блок «Возможно, вы искали» с рекомендациями',
    Boolean(html && html.includes('Возможно, вы искали') && html.includes('/plants/monstera'))
  )
  ok(
    '404.html: отдельное состояние для /admin',
    Boolean(html && html.includes('id="adminNote"') && html.includes('/admin'))
  )
  ok(
    '404.html: контрастная схема для светлой и тёмной темы',
    Boolean(html && html.includes('prefers-color-scheme: dark'))
  )
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

{
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  const fontPreloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => /as="font"/.test(tag))
    .map(tag => {
      const href = /href="([^"]+)"/.exec(tag)
      return href ? href[1] : null
    })
    .filter(Boolean)
  ok('index.html: preload ровно одного шрифта', fontPreloads.length === 1)
  ok(
    'index.html: preload только кириллического сабсета',
    fontPreloads.length === 1 && fontPreloads[0] === '/fonts/inter-cyrillic.woff2'
  )
  ok(
    'index.html: латинский сабсет не preload-ится',
    !fontPreloads.some(href => href.includes('inter-latin'))
  )
  ok(
    'index.html: preconnect к API',
    /<link rel="preconnect" href="https:\/\/server\.checktheplants\.ru"/.test(html)
  )
  ok(
    'index.html: preconnect без сторонней аналитики',
    !/rel="preconnect"[^>]*(googletagmanager|google-analytics|mc\.yandex)/.test(html)
  )
  ok('index.html: skip-link на месте', html.includes('class="skipLink"'))
  ok('index.html: контейнер #main-content на месте', html.includes('id="main-content"'))
  ok(
    'index.html: skip-link ведёт на существующий якорь',
    /class="skipLink" href="#main-content"/.test(html) && html.includes('id="main-content"')
  )
}

{
  const fontsCss = await readFile(join(dist, 'fonts/inter.css'), 'utf8')
  const cyrRule = (fontsCss.match(/inter-cyrillic\.woff2[^}]*}/) || [''])[0]
  const latinRule = (fontsCss.match(/inter-latin\.woff2[^}]*}/) || [''])[0]

  ok('inter.css: кириллица покрыта U+0400-045F', cyrRule.includes('U+0400-045F'))
  ok('inter.css: latin-сабсет без кириллицы', !latinRule.includes('0400'))
  ok('inter.css: latin-сабсет покрывает U+0020-007E', latinRule.includes('U+0020-007E'))
  ok('inter.css: latin-сабсет сохраняет типографику', latinRule.includes('U+2013-2014'))
  ok(
    'inter.css: font-display:swap у двух сабсетов',
    (fontsCss.match(/font-display:swap/g) || []).length === 2
  )
  ok(
    'inter.css: weight 400 700 у двух сабсетов',
    (fontsCss.match(/font-weight:400 700/g) || []).length === 2
  )

  const latinFont = await stat(join(dist, 'fonts/inter-latin.woff2'))
    .then(stats => stats.size)
    .catch(() => 0)
  const cyrillicFont = await stat(join(dist, 'fonts/inter-cyrillic.woff2'))
    .then(stats => stats.size)
    .catch(() => 0)

  ok(`шрифты: latin-сабсет ≤ 40 КБ (${latinFont} Б)`, latinFont > 0 && latinFont <= 40 * 1024)
  ok(
    `шрифты: cyrillic-сабсет без роста (${cyrillicFont} Б)`,
    cyrillicFont > 0 && cyrillicFont <= 32 * 1024
  )
  ok(
    `шрифты: суммарный вес ≤ 70 КБ (${latinFont + cyrillicFont} Б)`,
    latinFont + cyrillicFont > 0 && latinFont + cyrillicFont <= 70 * 1024
  )
}

{
  const assets = await readdir(join(dist, 'assets'))
  const entryChunks = assets.filter(name => /^index-.*\.js$/.test(name))
  ok('PERF-04: ровно один entry-чанк index-*.js', entryChunks.length === 1)
  if (entryChunks.length === 1) {
    const entryCode = await readFile(join(dist, 'assets', entryChunks[0]), 'utf8')
    ok(
      'PERF-04: entry не содержит код страницы /notifications',
      !entryCode.includes('notificationsMarkAll')
    )
    ok(
      'PERF-04: entry не содержит код страницы /reset-password',
      !entryCode.includes('resetPasswordHero')
    )
    ok(
      'FUNC-07: нет дубля console.log успешной регистрации SW',
      !entryCode.includes('SW зарегистрирован') &&
      !entryCode.includes('Service Worker зарегистрирован')
    )
    ok(
      'FUNC-07: ошибка регистрации SW по-прежнему логируется',
      entryCode.includes('Ошибка SW')
    )
  }
}

console.log(`\nПроверок выполнено: ${assertions}`)
if (problems.length) {
  console.error(`\n✗ Найдено проблем: ${problems.length}\n`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(checks.join('\n'))
console.log('\n✓ Все проверки пройдены')
