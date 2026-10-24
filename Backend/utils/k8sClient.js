import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'
const DEFAULT_NAMESPACE = 'webplant'
const DEFAULT_TIMEOUT_MS = 5000

function readFileOrEmpty (file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Конфигурация доступа к API кластера из пода. Возвращает null, если backend запущен
 * не в Kubernetes (нет адреса API или токена ServiceAccount).
 */
export function kubernetesConfig () {
  const host = String(process.env.KUBERNETES_SERVICE_HOST ?? '').trim()
  if (!host) return null

  const token = readFileOrEmpty(path.join(SERVICE_ACCOUNT_DIR, 'token')).trim()
  if (!token) return null

  let ca = null
  try {
    ca = fs.readFileSync(path.join(SERVICE_ACCOUNT_DIR, 'ca.crt'))
  } catch {
    ca = null
  }

  const namespace =
    String(process.env.K8S_NAMESPACE ?? '').trim() ||
    readFileOrEmpty(path.join(SERVICE_ACCOUNT_DIR, 'namespace')).trim() ||
    DEFAULT_NAMESPACE

  return {
    host,
    port: Number(process.env.KUBERNETES_SERVICE_PORT) || 443,
    token,
    ca,
    namespace
  }
}

function request (config, requestPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: config.host,
        port: config.port,
        path: requestPath,
        method: 'GET',
        ca: config.ca ?? undefined,
        // servername не задаём: KUBERNETES_SERVICE_HOST — это IP сервиса, а IP в SNI
        // запрещён RFC 6066 (Node отбрасывает его с warning'ом). Сертификат API
        // содержит 10.96.0.1 и kubernetes.default.svc в SAN, проверка проходит.
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json'
        }
      },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: Number(res.statusCode) || 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )

    req.on('timeout', () => req.destroy(Object.assign(new Error('Таймаут запроса к API Kubernetes'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    req.end()
  })
}

export class KubernetesError extends Error {
  constructor (message, { statusCode = 0, reason = 'unreachable', cause = null } = {}) {
    super(message)
    this.name = 'KubernetesError'
    this.statusCode = statusCode
    this.reason = reason
    this.cause = cause
  }
}

function parseError (response) {
  try {
    const payload = JSON.parse(response.body)
    return {
      message: String(payload?.message ?? '').trim(),
      reason: String(payload?.reason ?? '').trim()
    }
  } catch {
    return { message: '', reason: '' }
  }
}

/**
 * Список подов namespace. Возвращает массив объектов Pod из API.
 */
export async function listPods (config = kubernetesConfig(), options = {}) {
  if (!config) throw new KubernetesError('Kubernetes недоступен: нет ServiceAccount', { reason: 'not_configured' })

  const namespace = encodeURIComponent(config.namespace)
  let response
  try {
    response = await request(config, `/api/v1/namespaces/${namespace}/pods`, options)
  } catch (error) {
    throw new KubernetesError(
      `Не удалось подключиться к API Kubernetes: ${error?.code || error?.message || 'unknown'}`,
      { reason: 'unreachable', cause: error }
    )
  }

  if (response.statusCode !== 200) {
    const { message, reason } = parseError(response)
    throw new KubernetesError(
      message || `API Kubernetes ответил ${response.statusCode}`,
      { statusCode: response.statusCode, reason: reason || 'forbidden' }
    )
  }

  try {
    const payload = JSON.parse(response.body)
    return Array.isArray(payload?.items) ? payload.items : []
  } catch (error) {
    throw new KubernetesError('Не удалось разобрать ответ API Kubernetes', { cause: error })
  }
}

/**
 * Логи контейнера пода: plain text, как у docker logs.
 */
export async function podLogs (podName, { tail = 100, config = kubernetesConfig(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!config) throw new KubernetesError('Kubernetes недоступен: нет ServiceAccount', { reason: 'not_configured' })

  const namespace = encodeURIComponent(config.namespace)
  const name = encodeURIComponent(podName)
  const query = `tailLines=${Number(tail) > 0 ? Number(tail) : 100}&timestamps=false`
  const response = await request(config, `/api/v1/namespaces/${namespace}/pods/${name}/log?${query}`, { timeoutMs })

  if (response.statusCode === 404) {
    throw new KubernetesError('Под не найден', { statusCode: 404, reason: 'not_found' })
  }
  if (response.statusCode !== 200) {
    const { message, reason } = parseError(response)
    throw new KubernetesError(
      message || `API Kubernetes ответил ${response.statusCode}`,
      { statusCode: response.statusCode, reason: reason || 'error' }
    )
  }

  return response.body
}
