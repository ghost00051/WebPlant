import { truncateText } from './dockerHealth.js'

export const POD_ID_PREFIX = 'pod:'

const FAILING_WAITING_REASONS = new Set([
  'ErrImageNeverPull',
  'ErrImagePull',
  'ImagePullBackOff',
  'InvalidImageName',
  'CrashLoopBackOff',
  'CreateContainerError',
  'CreateContainerConfigError',
  'RunContainerError',
  'ContainerCannotRun',
  'StartError'
])

const WAITING_ONLY_REASONS = new Set(['ContainerCreating', 'PodInitializing'])

export function podResourceId (name) {
  return `${POD_ID_PREFIX}${name}`
}

export function isPodResourceId (id) {
  return String(id ?? '').trim().toLowerCase().startsWith(POD_ID_PREFIX)
}

export function podNameFromResourceId (id) {
  const text = String(id ?? '').trim()
  if (!isPodResourceId(text)) return ''
  const name = text.slice(POD_ID_PREFIX.length).trim()
  return /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i.test(name) ? name : ''
}

function asString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toIsoDate (value) {
  const text = asString(value)
  if (!text) return null
  const time = Date.parse(text)
  if (!Number.isFinite(time) || time <= 0) return null
  return new Date(time).toISOString()
}

function ownerOf (pod) {
  const owner = pod?.metadata?.ownerReferences?.[0]
  if (!owner) return null
  const kind = asString(owner.kind).toLowerCase()
  const name = asString(owner.name)
  if (!kind || !name) return null
  // ReplicaSet — это Deployment с хешем в имени: в панели полезнее исходное имя.
  if (kind === 'replicaset') {
    const deployment = name.replace(/-[a-z0-9]{6,10}$/i, '')
    return deployment && deployment !== name ? `deployment/${deployment}` : `replicaset/${name}`
  }
  return `${kind}/${name}`
}

function containerStatusesOf (status = {}) {
  const main = Array.isArray(status.containerStatuses) ? status.containerStatuses : []
  const init = Array.isArray(status.initContainerStatuses) ? status.initContainerStatuses : []
  return { main, init, all: [...init, ...main] }
}

function failingWaiting (statuses) {
  for (const container of statuses) {
    const waiting = container?.state?.waiting
    const reason = asString(waiting?.reason)
    if (reason && FAILING_WAITING_REASONS.has(reason)) {
      return { container: asString(container.name), reason, message: asString(waiting?.message) }
    }
  }
  return null
}

function waitingReason (statuses) {
  for (const container of statuses) {
    const waiting = container?.state?.waiting
    const reason = asString(waiting?.reason)
    if (reason) return { container: asString(container.name), reason, message: asString(waiting?.message) }
  }
  return null
}

function lastTermination (statuses) {
  let worst = null
  for (const container of statuses) {
    const terminated = container?.state?.terminated || container?.lastState?.terminated
    if (!terminated) continue
    const exitCode = Number(terminated.exitCode)
    if (!Number.isFinite(exitCode)) continue
    const candidate = {
      container: asString(container.name),
      exitCode,
      reason: asString(terminated.reason),
      message: asString(terminated.message),
      oomKilled: terminated.reason === 'OOMKilled'
    }
    if (!worst || candidate.exitCode > worst.exitCode) worst = candidate
  }
  return worst
}

function conditionOf (status, type) {
  const conditions = Array.isArray(status?.conditions) ? status.conditions : []
  return conditions.find(condition => condition.type === type) || null
}

function podState (phase) {
  if (phase === 'Running') return 'running'
  if (phase === 'Pending') return 'pending'
  if (phase === 'Succeeded') return 'completed'
  if (phase === 'Failed') return 'exited'
  return 'unknown'
}

function describeProblem ({ phase, statuses, failing, terminated, scheduled }) {
  if (failing) {
    const details = failing.message ? `: ${failing.message}` : ''
    return {
      problem: `${failing.reason} (${failing.container})${details}`,
      problemLevel: 'error'
    }
  }

  if (phase === 'Succeeded') return { problem: null, problemLevel: 'ok' }

  if (terminated && terminated.exitCode !== 0) {
    const reason = terminated.reason ? ` (${terminated.reason})` : ''
    return {
      problem: `Контейнер ${terminated.container} завершился: код ${terminated.exitCode}${reason}`,
      problemLevel: 'error'
    }
  }

  if (terminated?.oomKilled) {
    return {
      problem: `Контейнер ${terminated.container} убит из-за нехватки памяти (OOM)`,
      problemLevel: 'error'
    }
  }

  if (phase === 'Failed') {
    return { problem: 'Под завершился с ошибкой', problemLevel: 'error' }
  }

  if (phase === 'Pending') {
    if (scheduled && asString(scheduled.status) === 'False') {
      const message = asString(scheduled.message) || asString(scheduled.reason) || 'нет свободных ресурсов'
      return { problem: `Не запланирован: ${message}`, problemLevel: 'error' }
    }
    const waiting = waitingReason(statuses)
    if (waiting && !WAITING_ONLY_REASONS.has(waiting.reason)) {
      return { problem: `Ожидает запуска: ${waiting.reason}`, problemLevel: 'warn' }
    }
    return { problem: 'Ожидает запуска (планирование или загрузка образа)', problemLevel: 'warn' }
  }

  if (phase === 'Running') {
    const notReady = statuses.find(container => container?.ready !== true)
    if (notReady) {
      const reason = asString(notReady?.state?.waiting?.reason)
      return {
        problem: reason ? `Не готов: ${reason}` : `Не готов (${notReady.name || 'контейнер'})`,
        problemLevel: 'warn'
      }
    }
    return { problem: null, problemLevel: 'ok' }
  }

  return { problem: 'Состояние пода неизвестно', problemLevel: 'warn' }
}

/**
 * Приводит под Kubernetes к той же строке, что отдаёт Docker-статистика:
 * админка рисует поды и контейнеры одной таблицей.
 */
export function describePod (pod, { now = Date.now() } = {}) {
  const metadata = pod?.metadata || {}
  const status = pod?.status || {}
  const spec = pod?.spec || {}
  const name = asString(metadata.name) || 'pod'
  const phase = asString(status.phase) || 'Unknown'
  const { main, all } = containerStatusesOf(status)

  const containerCount = main.length || (Array.isArray(spec.containers) ? spec.containers.length : 0)
  const readyCount = main.filter(container => container?.ready === true).length
  const restartCount = all.reduce((sum, container) => sum + (Number(container?.restartCount) || 0), 0)

  const failing = failingWaiting(all)
  const terminated = lastTermination(all)
  const scheduled = conditionOf(status, 'PodScheduled')

  const state = podState(phase)
  const startedAt = toIsoDate(status.startTime)
  const startedMs = startedAt ? Date.parse(startedAt) : NaN
  const uptimeSeconds = state === 'running' && Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((now - startedMs) / 1000))
    : null

  let healthStatus = 'none'
  if (state === 'running') {
    if (failing) healthStatus = 'unhealthy'
    else if (containerCount > 0 && readyCount === containerCount) healthStatus = 'healthy'
    else healthStatus = 'starting'
  }

  const { problem, problemLevel } = describeProblem({ phase, statuses: all, failing, terminated, scheduled })

  const image = asString(spec.containers?.[0]?.image)
  const exitCode = state === 'completed'
    ? 0
    : state === 'exited'
      ? (terminated ? terminated.exitCode : null)
      : null

  return {
    id: podResourceId(name),
    name,
    service: ownerOf(pod),
    state,
    status: `${phase} ${readyCount}/${containerCount}`.trim(),
    image,
    node: asString(spec.nodeName) || null,
    healthStatus,
    restartCount,
    startedAt,
    uptimeSeconds,
    exitCode,
    oomKilled: Boolean(terminated?.oomKilled),
    error: truncateText(terminated?.message || failing?.message) || null,
    problem,
    problemLevel,
    statsAvailable: false,
    cpu: null,
    memory: { usage: null, limit: null, percent: null },
    network: { rx: null, tx: null },
    block: { read: null, write: null },
    pids: null
  }
}

export function describePods (items = [], options = {}) {
  return (Array.isArray(items) ? items : []).map(pod => describePod(pod, options))
}
