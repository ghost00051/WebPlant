
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function parseRule(line) {
  const body = line.replace(/^RewriteRule\s+/, '').trimEnd()
  const flagIndex = body.lastIndexOf('[')
  const hasFlags = flagIndex !== -1 && body.endsWith(']')

  const main = (hasFlags ? body.slice(0, flagIndex) : body).trim()
  const flags = hasFlags ? body.slice(flagIndex + 1, body.length - 1) : ''

  const separator = main.search(/\s/)
  if (separator === -1) return null

  return {
    pattern: main.slice(0, separator),
    substitution: main.slice(separator).trim(),
    flags
  }
}

export function parseHtaccess(htaccess) {
  const rules = []
  let conditions = []

  for (const rawLine of htaccess.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('RewriteCond ')) {
      conditions.push(line.replace(/^RewriteCond\s+/, ''))
      continue
    }

    if (line.startsWith('RewriteRule ')) {
      const parsed = parseRule(line)
      if (parsed) rules.push({ ...parsed, conditions, source: line })
      conditions = []
      continue
    }

    conditions = []
  }

  return rules
}

export function expandPattern(pattern) {
  let result = ''
  let inClass = false

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const code = pattern.charCodeAt(i)

    if (code === 0x5c && i + 1 < pattern.length) {
      result += char + pattern[i + 1]
      i += 1
      continue
    }

    if (code === 0x5b) inClass = true
    else if (code === 0x5d) inClass = false

    if (code === 0x2a && !inClass) {
      result += '(.*)'
      continue
    }

    result += char
  }

  return result
}

const CONDITION_FLAGS = ['[OR]', '[NC]', '[nocase]']

export function stripFlags(condition) {
  let result = condition.trim()
  let changed = true

  while (changed) {
    changed = false
    for (const flag of CONDITION_FLAGS) {
      if (result.endsWith(flag)) {
        result = result.slice(0, -flag.length).trim()
        changed = true
      }
    }
  }

  return result
}

export function hasOrFlag(condition) {
  return /\[OR\]$/i.test(condition.trim())
}

export function evaluateCondition(condition, context) {
  const clean = stripFlags(condition)
  const parts = clean.split(/\s+/)
  if (parts.length < 2) return null

  const variable = parts[0]
  const rest = parts.slice(1)

  let negated = false
  let operator = 'pattern'
  let expected

  const first = rest[0]
  if (first.startsWith('!=')) {
    operator = '='
    negated = true
    expected = [first.slice(2), ...rest.slice(1)].join(' ').trim()
  } else if (first === '=' || first.startsWith('=')) {
    operator = '='
    expected = [first.slice(1), ...rest.slice(1)].join(' ').trim()
  } else if (first === '-f' || first === '-d') {
    operator = first
    expected = ''
  } else if (first.startsWith('!')) {
    negated = true
    expected = [first.slice(1), ...rest.slice(1)].join(' ').trim()
  } else {
    expected = rest.join(' ').trim()
  }

  let actual
  if (variable === '%{HTTP_HOST}') actual = context.host
  else if (variable === '%{HTTPS}') actual = context.https ? 'on' : 'off'
  else if (variable === '%{HTTP:X-Forwarded-Proto}') actual = context.forwardedProto
  else if (variable === '%{REQUEST_FILENAME}') actual = context.fileExists ? 'exists' : 'missing'
  else if (variable === '%{THE_REQUEST}') actual = context.theRequest
  else return null

  if (operator === '=') return { matched: actual === expected, negated }

  if (operator === '-f' || operator === '-d') {
    return { matched: actual === 'exists', negated }
  }

  const pattern = new RegExp(`^(?:${expandPattern(expected)})`, 'i')
  return { matched: pattern.test(actual), negated }
}

export function conditionsPass(conditions, context) {
  if (!conditions.length) return true

  const evaluated = conditions.map(condition => evaluateCondition(condition, context))
  if (evaluated.some(item => item === null)) {
    return null
  }

  let hasAccumulator = false
  let accumulator = false

  for (let i = 0; i < evaluated.length; i += 1) {
    const { matched, negated } = evaluated[i]
    const value = negated ? !matched : matched

    if (!hasAccumulator) {
      accumulator = value
      hasAccumulator = true
    } else if (hasOrFlag(conditions[i - 1])) {
      accumulator = accumulator || value
    } else {
      accumulator = accumulator && value
    }
  }

  return Boolean(accumulator)
}

export async function createFileSystem(distDirectory) {
  const entries = await readdir(distDirectory, { withFileTypes: true })
  const rootFiles = new Set()
  const rootDirectories = new Set()

  for (const entry of entries) {
    if (entry.isDirectory()) rootDirectories.add(entry.name)
    else rootFiles.add(entry.name)
  }

  return function fileExists(uriPath) {
    const clean = uriPath.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!clean) return true

    const segments = clean.split('/')
    if (segments.length === 1) {
      return rootFiles.has(segments[0]) || rootDirectories.has(segments[0])
    }

    if (!rootDirectories.has(segments[0])) return false
    return existsSync(join(distDirectory, ...segments))
  }
}

export function resolveRequest(rules, uriPath, options = {}) {
  const relativePath = uriPath.replace(/^\/+/, '')

  const context = {
    host: options.host ?? 'checktheplants.ru',
    https: options.https ?? true,
    forwardedProto: options.https === false ? 'http' : 'https',
    theRequest: options.theRequest ?? `GET ${uriPath} HTTP/1.1`,
    fileExists: (options.fileExists ?? (() => false))(relativePath || uriPath)
  }

  for (const rule of rules) {
    if (!new RegExp(rule.pattern).test(relativePath)) continue

    const passed = conditionsPass(rule.conditions, context)
    if (passed === false) continue

    if (rule.flags.includes('R=301')) {
      let target = rule.substitution
      if (target === '^') target = uriPath
      if (!target.startsWith('http')) {
        target = `https://checktheplants.ru${target}`
      }
      target = target.replace('%{REQUEST_URI}', uriPath)
      return { status: 301, location: target, description: 'канонический редирект' }
    }

    if (rule.flags.includes('R=404')) {
      return { status: 404, description: 'правило 404: адрес не совпал ни с одним маршрутом' }
    }

    if (rule.flags.includes('L') && rule.substitution.endsWith('.html')) {
      return { status: 200, description: `отдаётся ${rule.substitution}` }
    }

    if (rule.substitution === '-') {
      return { status: 200, description: 'существующий файл отдаётся как есть' }
    }
  }

  return { status: 404, description: 'ни одно правило не совпало' }
}

export async function loadRouting(distDirectory) {
  const { readFile } = await import('node:fs/promises')
  const htaccessPath = join(distDirectory, '..', 'htaccess')
  const htaccess = await readFile(htaccessPath, 'utf8')
  const fileExists = await createFileSystem(distDirectory)

  return {
    rules: parseHtaccess(htaccess),
    fileExists
  }
}
