
import { resolve } from 'node:path'
import { loadRouting, resolveRequest } from './lib/routing.mjs'

const dist = resolve(import.meta.dirname, '..', 'dist')
const { rules, fileExists } = await loadRouting(dist)

const debugPath = process.argv[2]
if (debugPath) {
  console.log(`Правил разобрано: ${rules.length}\n`)
  for (const rule of rules) {
    const matches = new RegExp(rule.pattern).test(debugPath)
    console.log(`${matches ? '→' : ' '} ${rule.source}`)
    for (const condition of rule.conditions) {
      console.log(`      cond: ${condition}`)
    }
  }
  const result = resolveRequest(rules, debugPath, { fileExists })
  console.log(`\n${debugPath} → ${result.status} ${result.location ?? ''} (${result.description})`)
  process.exit(0)
}

const cases = [
  ['/login', 200, 'вход'],
  ['/register', 200, 'регистрация'],
  ['/home', 200, 'личный раздел'],
  ['/my-plants', 200, 'мои растения'],
  ['/add-plant', 200, 'добавление растения'],
  ['/edit-profile', 200, 'настройки профиля'],
  ['/plants', 200, 'справочник растений'],
  ['/plants/', 200, 'справочник со слэшем'],
  ['/plants/monstera', 200, 'карточка растения'],
  ['/plants/monstera/', 200, 'карточка со слэшем'],
  ['/care', 200, 'список статей'],
  ['/care/poliv-zimoy-i-letom', 200, 'статья'],
  ['/robots.txt', 200, 'robots.txt'],
  ['/sitemap.xml', 200, 'sitemap.xml'],
  ['/og-image.png', 200, 'обложка для соцсетей'],
  ['/favicon.ico', 200, 'фавикон'],
  ['/icons/icon-512.png', 200, 'иконка PWA'],
  ['/manifest.json', 200, 'манифест'],
  ['/sw.js', 200, 'service worker'],
  ['/404.html', 200, 'страница 404'],

  ['/some-nonexistent-page-xyz', 404, 'несуществующая страница'],
  ['/htaccess', 404, 'файл конфигурации недоступен'],
  ['/package.json', 404, 'package.json недоступен'],
  ['/indes.css', 404, 'несуществующий CSS (раньше отдавал HTML)'],
  ['/plants/monstera/extra', 404, 'лишний сегмент пути'],
  ['/wp-admin', 404, 'сканерский адрес'],
  ['/foo/bar/baz', 404, 'глубокий несуществующий путь'],
  ['/index.html', 301, 'дубль главной перенаправляется'],

  ['/plants/unknown-plant', 200, 'неизвестный slug — страница с noindex'],
  ['/care/unknown-article', 200, 'неизвестный slug статьи — страница с noindex']
]

console.log('Проверка правил .htaccess\n')

const failures = []
for (const [path, expected, description] of cases) {
  const result = resolveRequest(rules, path, { fileExists })
  const pass = result.status === expected
  const label = `${path.padEnd(30)} → ${String(result.status).padEnd(3)}`
  console.log(`  ${pass ? '✓' : '✗'} ${label} (${description})`)
  if (!pass) {
    failures.push(`${path}: получен ${result.status}, ожидался ${expected}`)
  }
}

console.log('\nРедирект на канонический хост\n')
const redirectCases = [
  ['/', { host: 'www.checktheplants.ru' }, 301, 'www → без www'],
  ['/plants', { host: 'www.checktheplants.ru' }, 301, 'на внутренней странице'],
  ['/login', { host: 'www.checktheplants.ru' }, 301, 'на странице входа'],
  ['/robots.txt', { host: 'www.checktheplants.ru' }, 301, 'для robots.txt']
]

for (const [path, options, expected, description] of redirectCases) {
  const result = resolveRequest(rules, path, { ...options, fileExists })
  const pass = result.status === expected
  console.log(
    `  ${pass ? '✓' : '✗'} ${path.padEnd(30)} → ${result.status} ${result.location ?? ''} (${description})`
  )
  if (!pass) failures.push(`${path} [${JSON.stringify(options)}]: получен ${result.status}`)
}

console.log('\nОтсутствие ложных редиректов\n')
const falseRedirectCases = ['/', '/login', '/plants']
for (const path of falseRedirectCases) {
  const result = resolveRequest(rules, path, { fileExists, host: 'checktheplants.ru' })
  const pass = result.status !== 301
  console.log(`  ${pass ? '✓' : '✗'} ${path.padEnd(30)} → ${result.status} (редиректа нет)`)
  if (!pass) failures.push(`${path}: ложный редирект при каноническом хосте`)
}

const total = cases.length + redirectCases.length + falseRedirectCases.length
console.log('')
if (failures.length) {
  console.error(`✗ Провалено проверок: ${failures.length} из ${total}`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`✓ Все ${total} проверок маршрутизации пройдены`)
