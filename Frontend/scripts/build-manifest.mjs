import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const manifestPath = join(dist, 'build-info.json')
const checkOnly = process.argv.includes('--check')

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

async function htmlFiles() {
  const entries = await readdir(dist, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => entry.name)
    .sort()
}

function isHexCommit(value) {
  return typeof value === 'string' && (/^[0-9a-f]{7,40}$/i.test(value) || value === 'unknown')
}

if (checkOnly) {
  const problems = []
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

  let manifest = null
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    problems.push('dist/build-info.json отсутствует или невалиден — сборка не завершила manifest-шаг')
  }

  if (manifest) {
    if (manifest.version !== packageJson.version) {
      problems.push(
        `версия в манифесте (${manifest.version}) не совпадает с package.json (${packageJson.version})`
      )
    }
    if (!isHexCommit(manifest.commit)) {
      problems.push(`поле commit некорректно: ${JSON.stringify(manifest.commit)}`)
    }
    if (Number.isNaN(Date.parse(manifest.builtAt))) {
      problems.push(`поле builtAt некорректно: ${JSON.stringify(manifest.builtAt)}`)
    }
    const html = await htmlFiles().catch(() => [])
    const expectedRoutes = html.filter(name => name !== '404.html').length
    if (manifest.routes !== expectedRoutes) {
      problems.push(
        `routes в манифесте (${manifest.routes}) не совпадает с числом HTML в dist (${expectedRoutes})`
      )
    }
    if (!Array.isArray(manifest.html) || manifest.html.length !== html.length) {
      problems.push('поле html не совпадает со списком HTML-файлов dist')
    }
  }

  if (problems.length) {
    console.error('ПРОБЛЕМЫ build-info.json:')
    for (const problem of problems) console.error('  ✗ ' + problem)
    process.exit(1)
  }

  console.log(`build-info.json OK: v${manifest.version}, коммит ${manifest.commit}, страниц ${manifest.routes}.`)
  process.exit(0)
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const html = await htmlFiles()
if (!html.length) {
  console.error('ОШИБКА: в dist/ нет HTML — build-manifest запускается после vite build/prerender.')
  process.exit(1)
}

const manifest = {
  version: packageJson.version,
  commit: git(['rev-parse', '--short=12', 'HEAD']) || 'unknown',
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
  builtAt: new Date().toISOString(),
  routes: html.filter(name => name !== '404.html').length,
  html
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(
  `build-info.json: v${manifest.version}, коммит ${manifest.commit} (${manifest.branch}), ` +
    `страниц ${manifest.routes}, ${manifest.html.length} HTML-файлов.`
)
