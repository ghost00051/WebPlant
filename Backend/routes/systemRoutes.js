import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import Docker from 'dockerode'
import { requireAdmin } from '../middleware/admin.js'
import { optionalAuth } from '../middleware/auth.js'
import { getHttpMetrics } from '../middleware/accessLog.js'
import visitController from '../controllers/visitController.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'
import {
    MAX_LOG_RESPONSE_LENGTH,
    describeContainer,
    dockerConfigProblem,
    dockerUnavailable,
    normalizeDockerLogs,
    parseLogsQuery,
    summarizeContainers
} from '../utils/dockerHealth.js'

const router = express.Router()

const LOGS_REQUEST_TIMEOUT_MS = 5000

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

    // На случай stream-режима (некоторые версии dockerode): собираем чанки с тем же таймаутом.
    if (raw && typeof raw.on === 'function') {
      return await new Promise((resolve, reject) => {
        const chunks = []
        raw.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
        raw.on('end', () => resolve(normalizeDockerLogs(Buffer.concat(chunks))))
        raw.on('error', reject)
      })
    }

    // dockerode пытается распарсить тело как JSON; для контейнера с JSON-only выводом вернём текст.
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

    // Для остановленных контейнеров stats() не запрашиваем: это лишняя нагрузка и шум в логах.
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
    // Ошибка одного контейнера не должна ронять весь ответ.
    console.error(`Docker: не удалось собрать данные контейнера ${name}: ${error?.message || error?.code || 'unknown'}`)
    return emptyContainerFallback(info, error)
  }
}

let cache = {
  data: null,
  ts: 0,
}

const CACHE_TTL = 3000

router.get('/metrics', requireAdmin, (req, res) => {
  res.json(getHttpMetrics())
})

router.get('/docker-stats', requireAdmin, async (req, res) => {
  if (dockerConfigReason) {
    return res.status(503).json(dockerUnavailable(dockerConfigReason))
  }

  try {
    if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
      return res.json(cache.data)
    }

    const containers = await docker.listContainers({ all: true })

    const result = await Promise.all(containers.map(collectContainer))

    const payload = {
      timestamp: new Date().toISOString(),
      summary: summarizeContainers(result),
      containers: result,
    }

    cache = {
      data: payload,
      ts: Date.now(),
    }

    res.json(payload)
  } catch (err) {
    if (isDockerUnavailable(err)) {
      console.warn('⚠️ Docker stats недоступны:', err.code)
      return res.status(503).json(dockerUnavailable('unreachable'))
    }

    console.error('Docker stats error:', err?.message || err)
    res.status(500).json({ message: 'Не удалось получить статистику Docker' })
  }
})

router.get('/docker-stats/:id/logs', requireAdmin, async (req, res) => {
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
