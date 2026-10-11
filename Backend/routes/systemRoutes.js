import 'dotenv/config'
import express from 'express'
import Docker from 'dockerode'
import { requireAdmin } from '../middleware/admin.js'

const router = express.Router()

const dockerHost = process.env.DOCKER_HOST?.trim()
const dockerEnabled = process.env.DOCKER_STATS_ENABLED !== 'false' && Boolean(dockerHost)

const docker = dockerEnabled ? new Docker({
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

let cache = {
  data: null,
  ts: 0,
}

const CACHE_TTL = 3000

router.get('/docker-stats', requireAdmin, async (req, res) => {
  try {
    if (!docker) {
      return res.status(503).json({
        error: 'Docker stats недоступны: DOCKER_HOST не задан для этого окружения'
      })
    }

    if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
      return res.json(cache.data)
    }

    const containers = await docker.listContainers({ all: true })

    const result = await Promise.all(
      containers.map(async (info) => {
        const name = info.Names?.[0]?.replace(/^\//, '') || info.Id.slice(0, 12)

        let stats = null

        try {
          const container = docker.getContainer(info.Id)
          stats = await container.stats({ stream: false })
        } catch (error) {
          console.error(`Docker stats unavailable for container ${info.Id}:`, error)
        }

        if (!stats) {
          return {
            id: info.Id,
            name,
            state: info.State,
            status: info.Status,
            image: info.Image,
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
          id: info.Id,
          name,
          state: info.State,
          status: info.Status,
          image: info.Image,
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
      })
    )

    const payload = {
      timestamp: new Date().toISOString(),
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
      return res.status(503).json({ error: 'Docker недоступен в этом окружении' })
    }

    console.error('Docker stats error:', err)
    res.status(500).json({ error: 'Failed to get docker stats' })
  }
})

export default router