import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import Docker from 'dockerode'
import sequelize from '../db.js'
import { requireAdmin } from '../middleware/admin.js'
import { optionalAuth } from '../middleware/auth.js'
import { getHttpMetrics } from '../middleware/accessLog.js'
import visitController from '../controllers/visitController.js'
import GardenShare from '../models/GardenShare.js'
import { getSocialFeatureState } from '../utils/featureFlags.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'
import {
    MAX_LOG_RESPONSE_LENGTH,
    describeContainer,
    dockerConfigProblem,
    dockerUnavailable,
    filterByComposeProject,
    markExpectedStopped,
    normalizeDockerLogs,
    parseExpectedStopped,
    parseLogsQuery,
    parseLogsTail,
    summarizeContainers
} from '../utils/dockerHealth.js'
import {
    describePods,
    isPodResourceId,
    podNameFromResourceId
} from '../utils/k8sHealth.js'
import { kubernetesConfig, listPods, podLogs } from '../utils/k8sClient.js'
import { backupScheduleFromEnv, summarizeBackupStatus } from '../utils/backupStatus.js'

const router = express.Router()

const LOGS_REQUEST_TIMEOUT_MS = 5000

const BACKUP_HISTORY_LIMIT = 20

const MISSING_TABLE_CODE = '42P01'

const visitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 180,
    message: { counted: false },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('system-visit')
})

const dockerHost = process.env.DOCKER_HOST?.trim()
const dockerConfigReason = dockerConfigProblem({
    dockerHost,
    statsEnabled: process.env.DOCKER_STATS_ENABLED
})
const expectedStopped = parseExpectedStopped(process.env.DOCKER_EXPECTED_STOPPED)
const composeProject = process.env.DOCKER_COMPOSE_PROJECT?.trim() || ''

const docker = dockerConfigReason === null ? new Docker({
  host: dockerHost.replace('tcp://', '').split(':')[0],
  port: Number(dockerHost.split(':').pop()) || 2375,
}) : null

const isDockerUnavailable = error =>
  ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error?.code)

function calcCpuPercent(stats) {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage

  const systemDelta =
    stats.cpu_stats.system_cpu_usage -
    stats.precpu_stats.system_cpu_usage

  const onlineCpus =
    stats.cpu_stats.online_cpus ||
    stats.cpu_stats.cpu_usage.percpu_usage?.length ||
    1

  if (systemDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemDelta) * onlineCpus * 100
  }

  return 0
}

function emptyResourceStats() {
  return {
    statsAvailable: false,
    cpu: null,
    memory: {
      usage: null,
      limit: null,
      percent: null,
    },
    network: {
      rx: null,
      tx: null,
    },
    block: {
      read: null,
      write: null,
    },
    pids: null,
  }
}

function buildResourceStats(stats) {
  const memUsage = stats.memory_stats.usage || 0
  const memLimit = stats.memory_stats.limit || 0
  const cacheMem = stats.memory_stats.stats?.cache || 0
  const memUsed = Math.max(0, memUsage - cacheMem)
  const memPercent = memLimit ? (memUsed / memLimit) * 100 : 0

  const networks = stats.networks || {}
  let rx = 0
  let tx = 0

  for (const n of Object.values(networks)) {
    rx += n.rx_bytes || 0
    tx += n.tx_bytes || 0
  }

  const blk = stats.blkio_stats?.io_service_bytes_recursive || []
  let read = 0
  let write = 0

  for (const item of blk) {
    if (item.op === 'Read') read += item.value || 0
    if (item.op === 'Write') write += item.value || 0
  }

  return {
    statsAvailable: true,
    cpu: Number(calcCpuPercent(stats).toFixed(2)),
    memory: {
      usage: memUsed,
      limit: memLimit,
      percent: Number(memPercent.toFixed(2)),
    },
    network: {
      rx,
      tx,
    },
    block: {
      read,
      write,
    },
    pids: stats.pids_stats?.current || 0,
  }
}

function containerNameOf(info = {}) {
  return info.Names?.[0]?.replace(/^\//, '') || info.Id?.slice(0, 12) || 'unknown'
}

function containerServiceOf(info = {}) {
  return info.Labels?.['com.docker.compose.service'] || null
}

function emptyContainerFallback(info, error) {
  return {
    id: info?.Id || '',
    name: containerNameOf(info),
    state: info?.State || 'unknown',
    status: info?.Status || '',
    image: info?.Image || '',
    service: containerServiceOf(info),
    healthStatus: 'none',
    restartCount: 0,
    startedAt: null,
    uptimeSeconds: null,
    exitCode: null,
    oomKilled: false,
    error: null,
    problem: `Не удалось получить сведения о контейнере: ${
      error?.message || error?.code || 'неизвестная ошибка'
    }`,
    problemLevel: 'error',
    ...emptyResourceStats(),
  }
}

function logsError(message) {
  const error = new Error(message)
  error.code = 'DOCKER_LOGS_ERROR'
  return error
}

async function readContainerLogs(container, tail) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOGS_REQUEST_TIMEOUT_MS)

  try {
    const raw = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
      follow: false,
      abortSignal: controller.signal,
    })

    if (Buffer.isBuffer(raw) || typeof raw === 'string') return normalizeDockerLogs(raw)

    if (raw && typeof raw.on === 'function') {
      return await new Promise((resolve, reject) => {
        const chunks = []
        raw.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
        raw.on('end', () => resolve(normalizeDockerLogs(Buffer.concat(chunks))))
        raw.on('error', reject)
      })
    }

    if (raw && typeof raw === 'object') return normalizeDockerLogs(JSON.stringify(raw))

    return normalizeDockerLogs('')
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      throw logsError(`Таймаут: логи не получены за ${LOGS_REQUEST_TIMEOUT_MS / 1000} с`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function podLogsHandler(req, res) {
  const podName = podNameFromResourceId(req.params.id)
  if (!podName) {
    return res.status(400).json({ message: 'Некорректное имя пода' })
  }

  const tail = parseLogsTail(req.query.tail)
  if (!tail.ok) {
    return res.status(400).json({ message: tail.error })
  }

  const config = kubernetesConfig()
  if (!config) {
    return res.status(503).json(dockerUnavailable('not_configured', 'Kubernetes недоступен: нет ServiceAccount'))
  }

  try {
    const logs = await podLogs(podName, { tail: tail.tail, config })
    return res.json({
      id: req.params.id,
      name: podName,
      tail: tail.tail,
      logs: logs.slice(-MAX_LOG_RESPONSE_LENGTH),
    })
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ message: 'Под не найден' })
    }
    console.warn(`⚠️ Логи пода ${podName} недоступны:`, error?.message || error)
    return res.status(error?.statusCode === 403 ? 403 : 500).json({
      message: error?.message || 'Не удалось получить логи пода',
    })
  }
}

async function collectContainer(info) {
  const name = containerNameOf(info)

  try {
    const container = docker.getContainer(info.Id)

    let inspect = null
    let inspectError = null
    try {
      inspect = await container.inspect()
    } catch (error) {
      inspectError = error
    }

    let stats = null
    if (info.State === 'running') {
      try {
        stats = await container.stats({ stream: false })
      } catch (error) {
        console.warn(`Docker stats недоступна для контейнера ${name}: ${error?.code || error?.message || 'unknown'}`)
      }
    }

    const status = describeContainer(inspect, info)
    if (inspectError) {
      status.problem = `Не удалось получить сведения о контейнере: ${
        inspectError?.message || inspectError?.code || 'неизвестная ошибка'
      }`
      status.problemLevel = 'error'
    }

    return {
      id: info.Id,
      name,
      state: info.State,
      status: info.Status,
      image: info.Image,
      service: containerServiceOf(info),
      ...status,
      ...(stats ? buildResourceStats(stats) : emptyResourceStats()),
    }
  } catch (error) {
    console.error(`Docker: не удалось собрать данные контейнера ${name}: ${error?.message || error?.code || 'unknown'}`)
    return emptyContainerFallback(info, error)
  }
}

let cache = {
  data: null,
  ts: 0,
}

const CACHE_TTL = 3000

async function collectDockerStats() {
  if (dockerConfigReason) {
    return dockerUnavailable(dockerConfigReason)
  }

  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return cache.data
  }

  const containers = filterByComposeProject(
    await docker.listContainers({ all: true }),
    composeProject
  )
  const result = markExpectedStopped(
    await Promise.all(containers.map(collectContainer)),
    expectedStopped
  )

  const payload = {
    available: true,
    timestamp: new Date().toISOString(),
    summary: summarizeContainers(result),
    containers: result,
  }

  cache = {
    data: payload,
    ts: Date.now(),
  }

  return payload
}

async function collectKubernetesStats() {
  const config = kubernetesConfig()
  if (!config) {
    return {
      containers: null,
      summary: null,
      error: {
        reason: 'not_configured',
        message: 'Backend запущен не в Kubernetes: нет KUBERNETES_SERVICE_HOST',
      },
    }
  }

  try {
    const containers = describePods(await listPods(config))
    return {
      containers,
      summary: summarizeContainers(containers),
      error: null,
    }
  } catch (error) {
    console.warn('⚠️ Kubernetes API недоступен:', error?.reason || error?.message || error)
    return {
      containers: null,
      summary: null,
      error: {
        reason: error?.reason || 'unreachable',
        message: error?.message || 'Не удалось получить поды Kubernetes',
      },
    }
  }
}

async function countActiveGardenShares() {
  try {
    return await GardenShare.count({ where: { revoked_at: null } })
  } catch (error) {
    console.warn(
      '⚠️ /api/system/features: не удалось посчитать шаринги сада:',
      error?.message || error
    )
    return null
  }
}

router.get('/features', async (req, res) => {
  const shareCount = await countActiveGardenShares()
  return res.json(getSocialFeatureState({ shareCount }))
})

router.get('/metrics', requireAdmin, (req, res) => {
  res.json(getHttpMetrics())
})

async function loadBackupRuns(limit) {
  return sequelize.query(
    `SELECT id, source, status, started_at, finished_at, database_bytes, uploads_bytes, files, error
       FROM backup_runs
      ORDER BY finished_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    { bind: [limit], type: sequelize.QueryTypes.SELECT }
  )
}

router.get('/backup', requireAdmin, async (req, res) => {
  const schedule = backupScheduleFromEnv(process.env)
  const base = { times: schedule.times, timeZone: schedule.timeZone }

  try {
    const runs = await loadBackupRuns(BACKUP_HISTORY_LIMIT)
    return res.json(summarizeBackupStatus({ runs, ...base }))
  } catch (error) {
    const code = error?.original?.code || error?.parent?.code || error?.code

    if (code === MISSING_TABLE_CODE) {
      return res.json({
        ...summarizeBackupStatus({ runs: [], ...base }),
        available: false,
        reason: 'not_migrated',
        message: 'Таблица backup_runs не создана — примените миграции: ' +
          'powershell -File Backend/scripts/apply-migrations.ps1'
      })
    }

    console.warn('⚠️ /api/system/backup: не удалось прочитать журнал бэкапов:', error?.message || error)
    return res.status(500).json({ message: 'Не удалось прочитать журнал бэкапов' })
  }
})

router.get('/docker-stats', requireAdmin, async (req, res) => {
  const kubernetes = await collectKubernetesStats()

  let dockerPart
  try {
    dockerPart = await collectDockerStats()
  } catch (err) {
    if (isDockerUnavailable(err)) {
      console.warn('⚠️ Docker stats недоступны:', err.code)
      dockerPart = dockerUnavailable('unreachable')
    } else {
      console.error('Docker stats error:', err?.message || err)
      dockerPart = dockerUnavailable('unreachable', 'Не удалось получить статистику Docker')
    }
  }

  if (kubernetes.containers) {
    return res.json({
      timestamp: new Date().toISOString(),
      source: 'kubernetes',
      summary: kubernetes.summary,
      containers: kubernetes.containers,
      docker: dockerPart,
    })
  }

  if (dockerPart.available) {
    const kubernetesError = kubernetes.error && kubernetes.error.reason !== 'not_configured'
      ? kubernetes.error
      : null
    return res.json({
      ...dockerPart,
      source: 'docker',
      ...(kubernetesError ? { kubernetes: kubernetesError } : {}),
    })
  }

  return res.status(503).json({
    ...dockerUnavailable(dockerPart.reason, dockerPart.message),
    kubernetes: kubernetes.error,
  })
})

router.get('/docker-stats/:id/logs', requireAdmin, async (req, res) => {
  if (isPodResourceId(req.params.id)) {
    return podLogsHandler(req, res)
  }

  if (dockerConfigReason) {
    return res.status(503).json(dockerUnavailable(dockerConfigReason))
  }

  const query = parseLogsQuery({ id: req.params.id, tail: req.query.tail })
  if (!query.ok) {
    return res.status(400).json({ message: query.error })
  }

  try {
    const container = docker.getContainer(query.id)
    const inspect = await container.inspect()
    const name = inspect?.Name?.replace(/^\//, '') || query.id.slice(0, 12)
    const logs = await readContainerLogs(container, query.tail)

    res.json({
      id: query.id,
      name,
      tail: query.tail,
      logs: logs.slice(-MAX_LOG_RESPONSE_LENGTH),
    })
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ message: 'Контейнер не найден' })
    }

    if (isDockerUnavailable(error)) {
      console.warn('⚠️ Docker logs недоступны:', error.code)
      return res.status(503).json(dockerUnavailable('unreachable'))
    }

    if (error?.code === 'DOCKER_LOGS_ERROR') {
      return res.status(500).json({ message: error.message })
    }

    console.error('Docker logs error:', error?.message || error?.code || error)
    res.status(500).json({ message: 'Не удалось получить логи контейнера' })
  }
})

router.post('/visit', visitLimiter, optionalAuth, visitController.track)

export default router
