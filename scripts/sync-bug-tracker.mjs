#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_SHEET_ID = '1L7tFQ7F6zib4b-BS46vwNCk0VWiWdXrMIIXREyvNgPw'
const DEFAULT_GID = '2001850722'

const CSV_HEADER = 'ID бага'
const XLSX_MAGIC = [0x50, 0x4b]

const COLUMNS = {
  id: 0,
  component: 4,
  title: 6,
  severity: 10,
  priority: 11,
  status: 13,
  assignee: 14,
  dueDate: 15,
  fixedAt: 16,
  overdue: 23,
}

class SyncError extends Error {}

function parseArgs(argv) {
  const options = {
    check: false,
    force: false,
    print: false,
    quiet: false,
    help: false,
    sheetId: process.env.BUG_TRACKER_SHEET_ID || DEFAULT_SHEET_ID,
    gid: process.env.BUG_TRACKER_GID || DEFAULT_GID,
    xlsxPath: resolve(ROOT, process.env.BUG_TRACKER_XLSX || 'Bug-Tracker-WebPlant.xlsx'),
    csvPath: resolve(ROOT, process.env.BUG_TRACKER_CSV || 'Bug-Tracker-WebPlant.csv'),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new SyncError(`для ${arg} нужно значение`)
      i += 1
      return value
    }

    if (arg === '--check') options.check = true
    else if (arg === '--force') options.force = true
    else if (arg === '--print') options.print = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--sheet') options.sheetId = next()
    else if (arg === '--gid') options.gid = next()
    else if (arg === '--xlsx') options.xlsxPath = resolve(ROOT, next())
    else if (arg === '--csv') options.csvPath = resolve(ROOT, next())
    else throw new SyncError(`неизвестный аргумент: ${arg}`)
  }

  if (options.check && (options.force || options.print)) {
    throw new SyncError('--check несовместим с --force/--print')
  }

  return options
}

function printHelp() {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n')
    .filter(line => line.startsWith(' *'))
    .map(line => line.replace(/^ \* ?/, ''))
  console.log(lines.join('\n'))
}

function exportUrl(sheetId, format, extra = '') {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=${format}${extra}`
}

async function fetchExport(url, label) {
  let response
  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    throw new SyncError(`${label}: не удалось обратиться к Google Sheets (${error.message})`)
  }

  if (response.status === 404) {
    throw new SyncError(`${label}: таблица не найдена (HTTP 404) — проверьте BUG_TRACKER_SHEET_ID/--sheet`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new SyncError(
      `${label}: нет доступа (HTTP ${response.status}) — включите «Все, у кого есть ссылка → Читатель»`
    )
  }
  if (!response.ok) {
    throw new SyncError(`${label}: Google Sheets вернул HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new SyncError(`${label}: вместо данных пришла HTML-страница входа — таблица закрыта для чтения по ссылке`)
  }

  return Buffer.from(await response.arrayBuffer())
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function registryRows(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length === 0) return []
  return rows.slice(1).filter(row => (row[COLUMNS.id] ?? '').trim() !== '')
}

function rowsById(csvText) {
  const map = new Map()
  for (const row of registryRows(csvText)) {
    map.set(row[COLUMNS.id].trim(), row)
  }
  return map
}

function diffRegistries(previousCsv, nextCsv) {
  if (previousCsv === null) return null

  const previous = rowsById(previousCsv)
  const next = rowsById(nextCsv)
  const added = [...next.keys()].filter(id => !previous.has(id))
  const removed = [...previous.keys()].filter(id => !next.has(id))
  const changed = [...next.keys()].filter(id =>
    previous.has(id) && previous.get(id).join('\u0000') !== next.get(id).join('\u0000')
  )

  return { added, removed, changed }
}

function countBy(rows, index) {
  const counts = new Map()
  for (const row of rows) {
    const value = (row[index] ?? '').trim() || '—'
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
}

function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  try {
    renameSync(tmp, path)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      ;
    }
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      throw new SyncError(`не удалось заменить ${path}: файл занят (закройте его в Excel и повторите)`)
    }
    throw error
  }
}

function formatList(ids) {
  return ids.length === 0 ? '—' : ids.join(', ')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return 0
  }

  const log = (...args) => {
    if (!options.quiet) console.log(...args)
  }

  const csvBuffer = await fetchExport(
    exportUrl(options.sheetId, 'csv', `&gid=${encodeURIComponent(options.gid)}`),
    'CSV реестра'
  )
  const nextCsv = csvBuffer.toString('utf8').replace(/\r\n/g, '\n')

  if (!nextCsv.startsWith(CSV_HEADER)) {
    throw new SyncError(
      `CSV не похож на реестр багов (нет заголовка «${CSV_HEADER}») — проверьте BUG_TRACKER_GID/--gid`
    )
  }

  const previousCsv = existsSync(options.csvPath)
    ? readFileSync(options.csvPath, 'utf8').replace(/\r\n/g, '\n')
    : null
  const changed = previousCsv === null || previousCsv !== nextCsv
  const rows = registryRows(nextCsv)
  const diff = diffRegistries(previousCsv, nextCsv)

  if (options.check) {
    log(changed ? '✖ реестр багов изменился' : '✔ реестр багов совпадает с таблицей')
    if (diff) {
      if (diff.added.length) log(`  добавлено: ${formatList(diff.added)}`)
      if (diff.changed.length) log(`  изменено:  ${formatList(diff.changed)}`)
      if (diff.removed.length) log(`  удалено:   ${formatList(diff.removed)}`)
    }
    return changed ? 1 : 0
  }

  log(`Реестр багов: ${rows.length} записей (${formatList(rows.map(row => row[COLUMNS.id].trim()))})`)

  if (options.print) {
    for (const row of rows) {
      const cells = [
        row[COLUMNS.id],
        row[COLUMNS.status],
        row[COLUMNS.severity],
        row[COLUMNS.component],
        row[COLUMNS.title],
      ].map(value => (value ?? '').trim())
      console.log(`  ${cells[0].padEnd(9)} ${cells[1].padEnd(20)} ${cells[2].padEnd(9)} ${cells[3].padEnd(22)} ${cells[4]}`)
    }
    log('По статусам:', countBy(rows, COLUMNS.status).map(([name, count]) => `${name} — ${count}`).join(', '))
    log('По серьёзности:', countBy(rows, COLUMNS.severity).map(([name, count]) => `${name} — ${count}`).join(', '))
  }

  if (!changed && !options.force) {
    log('✔ изменений нет — файлы не тронуты')
    return 0
  }

  if (diff) {
    if (diff.added.length) log(`  + добавлено: ${formatList(diff.added)}`)
    if (diff.changed.length) log(`  ~ изменено:  ${formatList(diff.changed)}`)
    if (diff.removed.length) log(`  - удалено:   ${formatList(diff.removed)}`)
  } else {
    log('  зеркала CSV ещё не было — создаю')
  }

  const xlsxBuffer = await fetchExport(exportUrl(options.sheetId, 'xlsx'), 'XLSX книги')
  if (xlsxBuffer.length < 4 || xlsxBuffer[0] !== XLSX_MAGIC[0] || xlsxBuffer[1] !== XLSX_MAGIC[1]) {
    throw new SyncError('Google вернул не XLSX (ожидался zip-контейнер) — проверьте доступ к таблице')
  }

  writeFileAtomic(options.xlsxPath, xlsxBuffer)
  writeFileAtomic(options.csvPath, nextCsv)

  log(`✔ обновлено: ${options.xlsxPath}`)
  log(`✔ обновлено: ${options.csvPath}`)
  log('  не забудьте закоммитить оба файла')
  return 0
}

main()
  .then(code => {
    process.exitCode = code
  })
  .catch(error => {
    const message = error instanceof SyncError ? error.message : `${error.name}: ${error.message}`
    console.error(`✖ ${message}`)
    process.exitCode = 2
  })
