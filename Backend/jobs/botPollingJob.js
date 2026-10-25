import * as botConfig from '../utils/botConfig.js'
import telegramBotService from '../services/telegramBotService.js'
import maxBotService from '../services/maxBotService.js'
import botChannelService from '../services/botChannelService.js'

const POLL_TIMEOUT_SECONDS = 25
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const EMPTY_POLL_DELAY_MS = 500
const EMPTY_POLL_THRESHOLD_MS = 400
const WEBHOOK_REFRESH_MS = 10 * 60 * 1000

const state = {
    running: false,
    controllers: [],
    tasks: [],
    webhookTimer: null,
    telegramOffset: 0,
    maxMarker: null
}

function log(...args) {
    console.log('🤖 Боты:', ...args)
}

function warn(...args) {
    console.warn('⚠️ Боты:', ...args)
}

function sleep(ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) {
            resolve()
            return
        }
        let timer = null
        const done = () => {
            if (timer) clearTimeout(timer)
            signal?.removeEventListener?.('abort', done)
            resolve()
        }
        timer = setTimeout(done, ms)
        timer.unref?.()
        signal?.addEventListener?.('abort', done, { once: true })
    })
}

async function handleUpdates(channel, updates) {
    for (const update of updates) {
        try {
            await botChannelService.handleIncomingUpdate(channel, update)
        } catch (error) {
            warn(`не удалось обработать обновление ${channel}: ${error?.message || error}`)
        }
    }
}

async function pollTelegram(signal) {
    let backoff = INITIAL_BACKOFF_MS

    while (!signal.aborted) {
        const startedAt = Date.now()
        const response = await telegramBotService.getUpdates({
            offset: state.telegramOffset > 0 ? state.telegramOffset : null,
            timeout: POLL_TIMEOUT_SECONDS,
            limit: 50
        })
        if (signal.aborted) return

        if (!response.ok) {
            if (response.status === 409) {
                warn('Telegram: getUpdates запрещён, пока установлен вебхук — polling остановлен')
                return
            }
            warn(`Telegram polling: ${response.error || 'ошибка'}; пауза ${backoff} мс`)
            await sleep(backoff, signal)
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
            continue
        }

        backoff = INITIAL_BACKOFF_MS
        const updates = Array.isArray(response.updates) ? response.updates : []

        if (updates.length > 0) {
            const updateIds = updates
                .map(update => Number(update?.update_id))
                .filter(Number.isFinite)
            if (updateIds.length > 0) {
                state.telegramOffset = Math.max(...updateIds) + 1
            }
            await handleUpdates('telegram', updates)
            continue
        }

        if (Date.now() - startedAt < EMPTY_POLL_THRESHOLD_MS) {
            await sleep(EMPTY_POLL_DELAY_MS, signal)
        }
    }
}

async function pollMax(signal) {
    let backoff = INITIAL_BACKOFF_MS

    while (!signal.aborted) {
        const startedAt = Date.now()
        const response = await maxBotService.getUpdates({
            marker: state.maxMarker,
            timeout: POLL_TIMEOUT_SECONDS,
            limit: 100
        })
        if (signal.aborted) return

        if (!response.ok) {
            warn(`MAX polling: ${response.error || 'ошибка'}; пауза ${backoff} мс`)
            await sleep(backoff, signal)
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
            continue
        }

        backoff = INITIAL_BACKOFF_MS
        if (response.marker !== undefined && response.marker !== null) {
            state.maxMarker = response.marker
        }

        const updates = Array.isArray(response.updates) ? response.updates : []
        if (updates.length > 0) {
            await handleUpdates('max', updates)
            continue
        }

        if (Date.now() - startedAt < EMPTY_POLL_THRESHOLD_MS) {
            await sleep(EMPTY_POLL_DELAY_MS, signal)
        }
    }
}

export function start() {
    if (state.running) return true
    if (!botConfig.isBotsEnabled()) {
        log('BOTS_ENABLED=false — боты не запускаются')
        return false
    }

    void botChannelService.warmBotIdentities()
        .then(results => {
            for (const [channel, info] of Object.entries(results)) {
                if (info.available) {
                    log(`${channel}: бот @${info.username || '?'} доступен`)
                } else {
                    warn(`${channel}: недоступен (${info.error || 'нет ответа API'})`)
                }
            }
        })
        .catch(error => warn(`прогрев кэша ботов не удался: ${error?.message || error}`))

    if (botConfig.isWebhookEnabled()) {
        void botChannelService.registerWebhooks()
            .catch(error => warn(`регистрация вебхуков не удалась: ${error?.message || error}`))
        if (!state.webhookTimer) {
            state.webhookTimer = setInterval(() => {
                void botChannelService.registerWebhooks()
                    .catch(error => warn(`обновление вебхуков не удалось: ${error?.message || error}`))
            }, WEBHOOK_REFRESH_MS)
            state.webhookTimer.unref?.()
        }
    }

    if (!botConfig.isPollingEnabled()) {
        log('long polling отключён (BOT_POLLING_ENABLED=false) — используем вебхуки')
        return false
    }
    if (botConfig.isWebhookEnabled()) {
        warn('включены и вебхуки, и long polling — polling не запускаю (вебхуки приоритетнее)')
        return false
    }

    const channels = botConfig.getConfiguredChannels()
    if (channels.length === 0) {
        warn('ни один канал не настроен — polling не запускаю')
        return false
    }

    for (const channel of channels) {
        const controller = new AbortController()
        state.controllers.push(controller)
        const task = (channel === 'telegram'
            ? pollTelegram(controller.signal)
            : pollMax(controller.signal))
            .catch(error => warn(`polling ${channel} остановлен: ${error?.message || error}`))
        state.tasks.push(task)
    }

    state.running = true
    log(`long polling запущен: ${channels.join(', ')}`)
    return true
}

export async function stop() {
    if (state.webhookTimer) {
        clearInterval(state.webhookTimer)
        state.webhookTimer = null
    }
    const tasks = state.tasks.slice()
    const controllers = state.controllers.slice()
    state.tasks = []
    state.controllers = []
    state.running = false

    for (const controller of controllers) {
        try {
            controller.abort()
        } catch {
        }
    }

    await Promise.allSettled(tasks)
    if (tasks.length > 0) log('long polling остановлен')
}

export function isRunning() {
    return state.running
}

export function resetPollingState() {
    state.telegramOffset = 0
    state.maxMarker = null
}

export function getPollingState() {
    return {
        running: state.running,
        channels: state.controllers.length,
        telegramOffset: state.telegramOffset,
        maxMarker: state.maxMarker
    }
}

const botPollingJob = {
    start,
    stop,
    isRunning,
    resetPollingState,
    getPollingState
}

export default botPollingJob
