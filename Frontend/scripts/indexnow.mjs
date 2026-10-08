
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { PUBLIC_PAGES, SITE_URL } from '../src/data/siteMap.js'

const root = resolve(import.meta.dirname, '..')
const publicDirectory = resolve(root, 'public')

const ENGINES = {
  default: 'https://api.indexnow.org/indexnow',
  yandex: 'https://yandex.com/indexnow',
  bing: 'https://www.bing.com/indexnow',
}

const MAX_URLS_PER_REQUEST = 10_000

function parseArguments(argv) {
  const options = {
    dryRun: false,
    engine: 'default',
    skipKeyCheck: false,
    paths: [],
  }

  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--skip-key-check') options.skipKeyCheck = true
    else if (argument.startsWith('--engine=')) options.engine = argument.slice('--engine='.length)
    else if (argument.startsWith('/')) options.paths.push(argument)
    else if (argument.startsWith('http')) options.paths.push(argument)
    else {
      console.error(`Неизвестный аргумент: ${argument}`)
      process.exit(2)
    }
  }

  return options
}

async function readKey() {
  const entries = await readdir(publicDirectory, { withFileTypes: true })
  const candidates = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.txt'))
    .map(entry => entry.name.slice(0, -4))
    .filter(name => /^[a-zA-Z0-9-]{8,128}$/.test(name))

  const matches = []
  for (const key of candidates) {
    const content = (await readFile(join(publicDirectory, `${key}.txt`), 'utf8')).trim()
    if (content === key) matches.push(key)
  }

  if (matches.length === 0) {
    throw new Error(
      'Файл ключа IndexNow не найден. Ожидается public/<key>.txt, ' +
      'содержащий тот же <key> (8–128 символов: a-z, A-Z, 0-9, дефис).'
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Найдено несколько ключей IndexNow: ${matches.join(', ')}. ` +
      'Оставьте только один, иначе непонятно, какой файл проверяют поисковики.'
    )
  }

  return matches[0]
}

function buildUrlList(paths) {
  if (paths.length === 0) {
    return PUBLIC_PAGES.map(page =>
      page.path === '/' ? `${SITE_URL}/` : `${SITE_URL}${page.path}`
    )
  }

  return paths.map(path =>
    path.startsWith('http') ? path : `${SITE_URL}${path}`
  )
}

async function checkKeyIsLive(host, key) {
  const keyUrl = `${host}/${key}.txt`

  let response
  try {
    response = await fetch(keyUrl, { redirect: 'follow' })
  } catch (error) {
    return { ok: false, reason: `не удалось запросить ${keyUrl}: ${error.message}` }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `${keyUrl} отвечает HTTP ${response.status}. Файл ключа ещё не выгружен на сайт?`
    }
  }

  const body = (await response.text()).trim()
  if (body !== key) {
    return {
      ok: false,
      reason: `${keyUrl} не содержит ключ. Получено: ${JSON.stringify(body.slice(0, 60))}`
    }
  }

  return { ok: true, keyUrl }
}

function chunk(items, size) {
  const result = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

function describeResponse(status) {
  switch (status) {
    case 200: return 'принято, адреса переданы поисковым системам'
    case 202: return 'принято, ожидается проверка ключа'
    case 400: return 'неверный формат запроса'
    case 403: return 'ключ не принят: файл не найден или не содержит ключ'
    case 422: return 'адреса не принадлежат хосту или ключ не соответствует схеме'
    case 429: return 'слишком много обращений, повторите позже'
    default: return 'неожиданный ответ'
  }
}

async function submit(engineUrl, host, key, urlList) {
  const response = await fetch(engineUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, urlList })
  })

  return {
    status: response.status,
    accepted: response.status === 200 || response.status === 202
  }
}


const options = parseArguments(process.argv.slice(2))
const engineUrl = ENGINES[options.engine]

if (!engineUrl) {
  console.error(
    `Неизвестный движок «${options.engine}». Доступны: ${Object.keys(ENGINES).join(', ')}`
  )
  process.exit(2)
}

const host = new URL(SITE_URL).host
const key = await readKey()
const urlList = buildUrlList(options.paths)

console.log(`Хост       : ${host}`)
console.log(`Ключ       : ${key}`)
console.log(`Эндпоинт   : ${engineUrl}`)
console.log(`Адресов    : ${urlList.length}`)
console.log('')

if (options.dryRun) {
  console.log('Режим проверки: отправка не выполняется.\n')
  for (const url of urlList) console.log(`  ${url}`)
  process.exit(0)
}

if (!options.skipKeyCheck) {
  const check = await checkKeyIsLive(`https://${host}`, key)
  if (!check.ok) {
    console.error('✗ Проверка ключа не пройдена — отправка отменена.')
    console.error(`  ${check.reason}`)
    console.error('')
    console.error('  Выгрузите каталог Frontend/dist на сайт и повторите.')
    console.error('  Если проверку нужно пропустить: --skip-key-check')
    process.exit(1)
  }
  console.log(`✓ Ключ доступен: ${check.keyUrl}\n`)
}

const batches = chunk(urlList, MAX_URLS_PER_REQUEST)
let submitted = 0
let failed = 0

for (const [index, batch] of batches.entries()) {
  const label = batches.length > 1 ? ` [${index + 1}/${batches.length}]` : ''
  try {
    const result = await submit(engineUrl, host, key, batch)
    if (result.accepted) {
      submitted += batch.length
      const mark = result.status === 200 ? '✓' : '•'
      console.log(`${mark} ${batch.length} адрес(ов)${label}: HTTP ${result.status} — ${describeResponse(result.status)}`)
    } else {
      failed += batch.length
      console.error(`✗ ${batch.length} адрес(ов)${label}: HTTP ${result.status} — ${describeResponse(result.status)}`)
    }
  } catch (error) {
    failed += batch.length
    console.error(`✗ ${batch.length} адрес(ов)${label}: ${error.message}`)
  }
}

console.log('')
console.log(`Итог: отправлено ${submitted}, с ошибкой ${failed}.`)
if (submitted > 0) {
  console.log('')
  console.log('Результат виден в Яндекс.Вебмастере: «Индексирование» → «IndexNow».')
  console.log('Первые обходы обычно появляются в течение нескольких часов.')
}
process.exit(failed > 0 ? 1 : 0)
