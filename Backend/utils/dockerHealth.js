export const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/

export const DEFAULT_LOGS_TAIL = 100
export const MAX_LOGS_TAIL = 200
export const MAX_LOG_RESPONSE_LENGTH = 20_000
export const MAX_PROBLEM_TEXT_LENGTH = 200
export const MAX_ERROR_TEXT_LENGTH = 200

const DOCKER_LOG_HEADER_SIZE = 8

const HEALTH_STATUSES = new Set(['healthy', 'unhealthy', 'starting'])
const EXIT_STATES = new Set(['exited', 'dead'])
const STOPPED_STATES = new Set(['exited', 'dead', 'created', 'removing'])

const ANSI_PATTERN =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

const DOCKER_UNAVAILABLE_MESSAGES = {
  not_configured:
    'Docker stats недоступны: DOCKER_HOST не задан для этого окружения',
  disabled:
    'Docker stats выключены: DOCKER_STATS_ENABLED=false (обычно так в Kubernetes)',
  unreachable:
    'Docker недоступен: не удалось подключиться к Docker-демону по DOCKER_HOST'
}

const DOCKER_UNAVAILABLE_REASONS = new Set(
  Object.keys(DOCKER_UNAVAILABLE_MESSAGES)
)

function asString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function asState (value) {
  return asString(value).toLowerCase()
}

export function truncateText (value, maxLength = MAX_PROBLEM_TEXT_LENGTH) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const limit = Math.max(1, Number(maxLength) || MAX_PROBLEM_TEXT_LENGTH)
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function healthStatusOf (inspect) {
  const status = inspect?.State?.Health?.Status
  return HEALTH_STATUSES.has(status) ? status : 'none'
}

function lastHealthLog (inspect) {
  const log = inspect?.State?.Health?.Log
  if (!Array.isArray(log) || log.length === 0) return ''
  const last = log[log.length - 1]
  return truncateText(last?.Output)
}

function parseExitCodeFromStatus (status) {
  const match = /\((\d+)\)/.exec(String(status || ''))
  return match ? Number(match[1]) : null
}

function toIsoDate (value) {
  const text = asString(value)
  if (!text) return null
  const time = Date.parse(text)
  if (!Number.isFinite(time) || time <= 0) return null
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function restartCountOf (inspect) {
  const value = inspect?.RestartCount ?? inspect?.State?.RestartCount
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0
}

/**

 * @returns {{ problem: string|null, problemLevel: 'ok'|'warn'|'error' }}
 */
export function describeContainerProblem (inspect, info = {}) {
  const state = asState(info?.State ?? inspect?.State?.Status)
  const stateInfo = inspect?.State || {}
  const healthStatus = healthStatusOf(inspect)
  const restartCount = restartCountOf(inspect)
  const exitCode = Number.isFinite(stateInfo.ExitCode)
    ? stateInfo.ExitCode
    : parseExitCodeFromStatus(info?.Status)
  const errorText = truncateText(stateInfo.Error, MAX_ERROR_TEXT_LENGTH)

  if (stateInfo.OOMKilled === true) {
    return {
      problem: 'Убит из-за нехватки памяти (OOM)',
      problemLevel: 'error'
    }
  }

  if (state === 'dead') {
    return { problem: 'Контейнер в состоянии dead', problemLevel: 'error' }
  }

  if (state === 'restarting') {
    return {
      problem: `Перезапускается (${restartCount} перезапусков)`,
      problemLevel: 'warn'
    }
  }

  if (state === 'paused') {
    return { problem: 'Приостановлен', problemLevel: 'warn' }
  }

  if (state === 'exited') {
    let problem =
      exitCode === null ? 'Остановлен' : `Остановлен: код выхода ${exitCode}`
    if (errorText) problem += ` (${errorText})`
    return {
      problem,
      problemLevel: exitCode === null || exitCode === 0 ? 'warn' : 'error'
    }
  }

  if (state === 'created') {
    return { problem: 'Создан, но ещё не запущен', problemLevel: 'warn' }
  }

  if (state === 'removing') {
    return { problem: 'Контейнер удаляется', problemLevel: 'warn' }
  }

  if (state === 'running') {
    if (healthStatus === 'unhealthy') {
      const log = lastHealthLog(inspect)
      return {
        problem: log
          ? `Healthcheck не проходит: ${log}`
          : 'Healthcheck не проходит',
        problemLevel: 'error'
      }
    }
    if (healthStatus === 'starting') {
      return { problem: 'Healthcheck ещё не завершился', problemLevel: 'warn' }
    }
    return { problem: null, problemLevel: 'ok' }
  }

  return {
    problem: state
      ? `Неизвестное состояние: ${state}`
      : 'Состояние контейнера неизвестно',
    problemLevel: 'warn'
  }
}

export function describeContainer (
  inspect,
  info = {},
  { now = Date.now() } = {}
) {
  const state = asState(info?.State ?? inspect?.State?.Status)
  const stateInfo = inspect?.State || {}
  const startedAt = toIsoDate(stateInfo.StartedAt)
  const rawExitCode = stateInfo.ExitCode
  const exitCode = EXIT_STATES.has(state)
    ? Number.isFinite(rawExitCode)
      ? rawExitCode
      : parseExitCodeFromStatus(info?.Status)
    : null

  let uptimeSeconds = null
  if (state === 'running' && startedAt) {
    const startedMs = Date.parse(startedAt)
    if (Number.isFinite(startedMs)) {
      uptimeSeconds = Math.max(0, Math.floor((now - startedMs) / 1000))
    }
  }

  const { problem, problemLevel } = describeContainerProblem(inspect, info)

  return {
    healthStatus: healthStatusOf(inspect),
    restartCount: restartCountOf(inspect),
    startedAt,
    uptimeSeconds,
    exitCode,
    oomKilled: stateInfo.OOMKilled === true,
    error: truncateText(stateInfo.Error, MAX_ERROR_TEXT_LENGTH) || null,
    problem,
    problemLevel
  }
}

export function summarizeContainers (containers = []) {
  const summary = {
    available: true,
    ok: true,
    total: 0,
    running: 0,
    stopped: 0,
    unhealthy: 0,
    restarting: 0,
    healthy: 0,
    problems: 0
  }

  for (const container of Array.isArray(containers) ? containers : []) {
    const state = asState(container?.state)
    const problemLevel = container?.problemLevel

    summary.total += 1
    if (state === 'running') summary.running += 1
    else if (STOPPED_STATES.has(state)) summary.stopped += 1
    if (state === 'restarting') summary.restarting += 1
    if (container?.healthStatus === 'unhealthy') summary.unhealthy += 1
    if (problemLevel && problemLevel !== 'ok') summary.problems += 1
    if (state === 'running' && problemLevel === 'ok') summary.healthy += 1
  }

  summary.ok = summary.problems === 0
  return summary
}

export function dockerConfigProblem ({ dockerHost, statsEnabled } = {}) {
  if (
    String(statsEnabled ?? '')
      .trim()
      .toLowerCase() === 'false'
  )
    return 'disabled'
  if (!asString(dockerHost)) return 'not_configured'
  return null
}

export function dockerUnavailable (reason = 'unreachable', message) {
  const safeReason = DOCKER_UNAVAILABLE_REASONS.has(reason)
    ? reason
    : 'unreachable'
  return {
    available: false,
    reason: safeReason,
    message: asString(message) || DOCKER_UNAVAILABLE_MESSAGES[safeReason]
  }
}

/**
 *
 * @returns {{ ok: true, id: string, tail: number }|{ ok: false, error: string }}
 */
export function parseLogsQuery ({ id, tail } = {}) {
  const containerId = asString(id).toLowerCase()
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    return { ok: false, error: 'Некорректный идентификатор контейнера' }
  }

  let parsedTail = DEFAULT_LOGS_TAIL
  if (tail !== undefined && tail !== null && String(tail).trim() !== '') {
    parsedTail = Number(tail)
  }

  if (
    !Number.isInteger(parsedTail) ||
    parsedTail < 1 ||
    parsedTail > MAX_LOGS_TAIL
  ) {
    return {
      ok: false,
      error: `Параметр tail должен быть целым числом от 1 до ${MAX_LOGS_TAIL}`
    }
  }

  return { ok: true, id: containerId, tail: parsedTail }
}

export function stripAnsi (text) {
  return String(text ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_CHARS_PATTERN, '')
}

export function demuxDockerLogs (input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? '')
  if (buffer.length === 0) return ''

  let offset = 0
  let framed = false
  const chunks = []

  while (offset + DOCKER_LOG_HEADER_SIZE <= buffer.length) {
    const streamType = buffer[offset]
    const size = buffer.readUInt32BE(offset + 4)
    const isHeader =
      (streamType === 1 || streamType === 2) &&
      buffer[offset + 1] === 0 &&
      buffer[offset + 2] === 0 &&
      buffer[offset + 3] === 0 &&
      offset + DOCKER_LOG_HEADER_SIZE + size <= buffer.length

    if (!isHeader) {
      framed = false
      break
    }

    framed = true
    chunks.push(
      buffer.subarray(
        offset + DOCKER_LOG_HEADER_SIZE,
        offset + DOCKER_LOG_HEADER_SIZE + size
      )
    )
    offset += DOCKER_LOG_HEADER_SIZE + size
  }

  if (!framed || offset !== buffer.length) return buffer.toString('utf8')
  return Buffer.concat(chunks).toString('utf8')
}

export function normalizeDockerLogs (raw, maxLength = MAX_LOG_RESPONSE_LENGTH) {
  const text = stripAnsi(demuxDockerLogs(raw))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  const limit = Math.max(1, Number(maxLength) || MAX_LOG_RESPONSE_LENGTH)
  return text.length > limit ? `…${text.slice(-limit)}` : text
}
