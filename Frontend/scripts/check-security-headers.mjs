import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const htaccessPath = resolve(root, 'htaccess')
const dist = resolve(root, 'dist')

const problems = []
let assertions = 0

function fail(message) {
  problems.push(message)
}

function ok(message, condition) {
  assertions += 1
  if (!condition) fail(message)
  return Boolean(condition)
}

function headerValue(source, name) {
  const pattern = new RegExp(
    `^\\s*Header\\s+always\\s+set\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+"([^"]*)"`,
    'im'
  )
  const match = pattern.exec(source)
  return match ? match[1].trim() : null
}

function parseCsp(value) {
  const directives = new Map()
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    const [name, ...sources] = tokens
    directives.set(name.toLowerCase(), sources)
  }
  return directives
}

function hasSource(directives, name, source) {
  return (directives.get(name) || []).includes(source)
}

function inlineSha256(source) {
  return 'sha256-' + createHash('sha256').update(source, 'utf8').digest('base64')
}

async function collectInlineStyles(htmlDir) {
  const files = (await readdir(htmlDir)).filter(name => name.endsWith('.html')).sort()
  const styles = new Map()
  let styleAttributeCount = 0
  for (const file of files) {
    const html = await readFile(join(htmlDir, file), 'utf8')
    const stylePattern = /<style([^>]*)>([\s\S]*?)<\/style>/gi
    let match
    while ((match = stylePattern.exec(html)) !== null) {
      if (!match[2].trim()) continue
      const hash = inlineSha256(match[2])
      if (!styles.has(hash)) styles.set(hash, [])
      styles.get(hash).push(file)
    }
    styleAttributeCount += (html.match(/\sstyle="/g) || []).length
  }
  return { styles, styleAttributeCount }
}

const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript'
])

async function collectInlineScripts(htmlDir) {
  const files = (await readdir(htmlDir)).filter(name => name.endsWith('.html')).sort()
  const scripts = new Map()
  const handlers = new Map()
  for (const file of files) {
    const html = await readFile(join(htmlDir, file), 'utf8')

    const scriptPattern = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi
    let match
    while ((match = scriptPattern.exec(html)) !== null) {
      const attrs = match[1]
      const body = match[2]
      const typeMatch = /\btype\s*=\s*"([^"]*)"/i.exec(attrs)
      const type = typeMatch ? typeMatch[1].trim().toLowerCase() : ''
      if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue
      if (!body.trim()) continue
      const hash = inlineSha256(body)
      if (!scripts.has(hash)) scripts.set(hash, [])
      scripts.get(hash).push(file)
    }

    const handlerPattern = /<[^>]+?\son([a-z]+)\s*=\s*"([^"]*)"/gi
    while ((match = handlerPattern.exec(html)) !== null) {
      const value = match[2]
      if (!handlers.has(value)) handlers.set(value, new Set())
      handlers.get(value).add(file)
    }
  }
  return { files, scripts, handlers }
}

console.log('Проверка security-заголовков (.htaccess) и CSP\n')

const htaccess = await readFile(htaccessPath, 'utf8').catch(() => null)
if (!ok('Frontend/htaccess существует', htaccess !== null)) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const cspHeader = headerValue(htaccess, 'Content-Security-Policy')
const reportOnly = headerValue(htaccess, 'Content-Security-Policy-Report-Only')
ok('CSP задан боевым заголовком Content-Security-Policy', Boolean(cspHeader))
ok('CSP не оставлен в режиме Report-Only', cspHeader !== null && reportOnly === null)

const xfo = headerValue(htaccess, 'X-Frame-Options')
ok('X-Frame-Options: DENY (anti-clickjacking)', xfo === 'DENY')

const coop = headerValue(htaccess, 'Cross-Origin-Opener-Policy')
ok('Cross-Origin-Opener-Policy: same-origin', coop === 'same-origin')

const permissions = headerValue(htaccess, 'Permissions-Policy')
ok('Permissions-Policy задан', Boolean(permissions))
if (permissions) {
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'browsing-topics']) {
    ok(`Permissions-Policy отключает ${feature}`, new RegExp(`(?:^|,\\s*)${feature}\\s*=\\s*\\(\\)`).test(permissions))
  }
  ok(
    'Permissions-Policy не запрещает publickey-credentials-get (passkey)',
    !/(?:^|,\s*)publickey-credentials-(?:get|create)\s*=\s*\(/.test(permissions)
  )
}

const directives = cspHeader ? parseCsp(cspHeader) : new Map()

if (cspHeader) {
  ok("CSP default-src 'self'", hasSource(directives, 'default-src', "'self'"))
  ok("CSP frame-ancestors 'none'", hasSource(directives, 'frame-ancestors', "'none'"))
  ok("CSP object-src 'none'", hasSource(directives, 'object-src', "'none'"))
  ok("CSP base-uri 'self'", hasSource(directives, 'base-uri', "'self'"))
  ok("CSP form-action 'self'", hasSource(directives, 'form-action', "'self'"))
  ok('CSP upgrade-insecure-requests включён', directives.has('upgrade-insecure-requests'))

  const scriptSrc = directives.get('script-src') || []
  ok("CSP script-src содержит 'self'", scriptSrc.includes("'self'"))
  ok("CSP script-src без 'unsafe-inline' (XSS-защита не выключена)", !scriptSrc.includes("'unsafe-inline'"))
  ok("CSP script-src без 'unsafe-eval'", !scriptSrc.includes("'unsafe-eval'"))
  ok(
    'CSP script-src разрешает GTM (www.googletagmanager.com)',
    scriptSrc.includes('https://www.googletagmanager.com')
  )
  ok('CSP script-src разрешает Яндекс.Метрику (mc.yandex.ru)', scriptSrc.includes('https://mc.yandex.ru'))
  ok(
    'CSP script-src не содержит сторонних доменов вне аналитики',
    scriptSrc
      .filter(source => /^https?:\/\//.test(source))
      .every(source => [
        'https://www.googletagmanager.com',
        'https://mc.yandex.ru'
      ].includes(source))
  )

  const styleSrc = directives.get('style-src') || []
  ok("CSP style-src содержит 'self'", styleSrc.includes("'self'"))
  ok(
    "CSP style-src без 'unsafe-inline' (inline-<style> разрешены хэшами)",
    !styleSrc.includes("'unsafe-inline'")
  )
  const styleAttrDirective = directives.get('style-src-attr') || []
  ok(
    "CSP style-src-attr 'unsafe-inline' (style-атрибуты пререндеренных карточек)",
    styleAttrDirective.includes("'unsafe-inline'")
  )

  const imgSrc = directives.get('img-src') || []
  ok("CSP img-src содержит 'self'", imgSrc.includes("'self'"))
  ok('CSP img-src разрешает data: (иконки/фоны)', imgSrc.includes('data:'))
  ok(
    'CSP img-src разрешает blob: (превью загружаемых фото)',
    imgSrc.includes('blob:')
  )
  ok(
    'CSP img-src разрешает фото с API (server.checktheplants.ru)',
    imgSrc.includes('https://server.checktheplants.ru')
  )

  const connectSrc = directives.get('connect-src') || []
  ok("CSP connect-src содержит 'self'", connectSrc.includes("'self'"))
  ok(
    'CSP connect-src разрешает API (server.checktheplants.ru)',
    connectSrc.includes('https://server.checktheplants.ru')
  )
  ok(
    'CSP connect-src разрешает сбор GA4 (google-analytics.com)',
    connectSrc.includes('https://www.google-analytics.com') &&
      connectSrc.includes('https://region1.google-analytics.com')
  )
  ok(
    'CSP connect-src разрешает Метрику (mc.yandex.ru)',
    connectSrc.includes('https://mc.yandex.ru')
  )

  ok("CSP font-src 'self' (шрифты self-hosted)", hasSource(directives, 'font-src', "'self'"))
  ok("CSP worker-src 'self' (service worker)", hasSource(directives, 'worker-src', "'self'"))
  ok("CSP manifest-src 'self'", hasSource(directives, 'manifest-src', "'self'"))
}

const distHtaccessPath = join(dist, '.htaccess')
const distHtaccess = await readFile(distHtaccessPath, 'utf8').catch(() => null)
ok('dist/.htaccess скопирован сборкой', distHtaccess !== null)
ok('dist/.htaccess совпадает с Frontend/htaccess', distHtaccess === htaccess)

const { files: htmlFiles, scripts, handlers } = await collectInlineScripts(dist).catch(() => ({
  files: [],
  scripts: new Map(),
  handlers: new Map()
}))
ok('в dist/ есть HTML-страницы', htmlFiles.length > 0)

const scriptSrc = directives.get('script-src') || []
for (const [hash, inFiles] of scripts) {
  ok(
    `CSP содержит хэш inline-скрипта ${hash} (${inFiles.slice(0, 3).join(', ')}${inFiles.length > 3 ? ', …' : ''})`,
    scriptSrc.includes(`'${hash}'`)
  )
}

const { styles, styleAttributeCount } = await collectInlineStyles(dist).catch(() => ({
  styles: new Map(),
  styleAttributeCount: 0
}))
const styleSrc2 = directives.get('style-src') || []
for (const [hash, inFiles] of styles) {
  ok(
    `CSP содержит хэш inline-стиля ${hash} (${inFiles.slice(0, 3).join(', ')}${inFiles.length > 3 ? ', …' : ''})`,
    styleSrc2.includes(`'${hash}'`)
  )
}
ok(
  `style-src не ослаблен до 'unsafe-inline' при наличии ${styles.size} inline-<style>`,
  !styleSrc2.includes("'unsafe-inline'")
)
if (styleAttributeCount > 0) {
  const styleAttr = directives.get('style-src-attr') || []
  ok(
    `style-атрибуты (${styleAttributeCount}) разрешены через style-src-attr`,
    styleAttr.includes("'unsafe-inline'") ||
      (styleAttr.includes("'unsafe-hashes'") && styleAttr.some(source => source.startsWith("'sha256-")))
  )
}

const scriptAttr = directives.get('script-src-attr') || []
if (handlers.size) {
  ok(
    `inline-обработчики (${handlers.size} шт.) разрешены только через script-src-attr`,
    scriptAttr.includes("'unsafe-inline'") ||
      (scriptAttr.includes("'unsafe-hashes'") &&
        [...handlers.keys()].every(value => scriptAttr.includes(`'${inlineSha256(value)}'`)))
  )
  ok(
    'script-src не ослаблен ради inline-обработчиков',
    !scriptSrc.includes("'unsafe-inline'")
  )
}

ok('есть X-Content-Type-Options: nosniff', headerValue(htaccess, 'X-Content-Type-Options') === 'nosniff')
ok(
  'есть Referrer-Policy: strict-origin-when-cross-origin',
  headerValue(htaccess, 'Referrer-Policy') === 'strict-origin-when-cross-origin'
)
ok(
  'HSTS задан',
  (headerValue(htaccess, 'Strict-Transport-Security') || '').includes('max-age=31536000')
)

if (problems.length) {
  console.error('ПРОБЛЕМЫ:')
  for (const problem of problems) console.error('  ✗ ' + problem)
  console.error(`\nПровалено проверок: ${problems.length} из ${assertions}`)
  process.exit(1)
}

console.log(
  `Security-заголовки в порядке: ${assertions} проверок; ` +
    `${htmlFiles.length} HTML, ${scripts.size} inline-скрипт(ов), ${styles.size} inline-стил(ей), ` +
    `${handlers.size} inline-обработчик(ов), ${styleAttributeCount} style-атрибут(ов).`
)
