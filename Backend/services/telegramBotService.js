import * as botConfig from '../utils/botConfig.js'

const CHANNEL = 'telegram'
const TEXT_LIMIT = 4096
const BUTTON_TEXT = 'Открыть Лейку'

function retryAfterFromPayload(payload) {
    const seconds = Number(payload?.parameters?.retry_after)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return Math.min(Math.round(seconds * 1000), botConfig.MAX_RETRY_DELAY_MS)
}

function retryAfterFromHeaders(headers) {
    try {
        const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : null
        const seconds = Number(raw)
        if (!Number.isFinite(seconds) || seconds < 0) return null
        return Math.min(Math.round(seconds * 1000), botConfig.MAX_RETRY_DELAY_MS)
    } catch {
        return null
    }
}

export class TelegramBotService {
    constructor() {
        this.fetchImpl = null
        this.sleepFn = null
        this.state = {
            info: null,
            fetchedAt: 0,
            checkedAt: null,
            lastError: null
        }
    }

    getConfig() {
        return botConfig.getChannelConfig(CHANNEL)
    }

    isConfigured() {
        return Boolean(this.getConfig()?.configured)
    }

    get fetch() {
        return this.fetchImpl || globalThis.fetch
    }

    get sleep() {
        return this.sleepFn || botConfig.defaultSleep
    }

    getCachedInfo() {
        if (!this.state.info) return null
        return { ...this.state.info, checkedAt: this.state.checkedAt }
    }

    resetState() {
        this.state = { info: null, fetchedAt: 0, checkedAt: null, lastError: null }
    }

    buildMethodUrl(method) {
        const config = this.getConfig()
        if (!config?.configured) {
            throw new botConfig.BotApiError('Токен Telegram-бота не задан', {
                channel: CHANNEL,
                code: 'not_configured'
            })
        }
        return `${config.apiBase}/bot${config.token}/${method}`
    }

    async performRequest(method, payload, { timeoutMs = botConfig.HTTP_TIMEOUT_MS } = {}) {
        const config = this.getConfig()
        const url = this.buildMethodUrl(method)
        const startedAt = Date.now()

        let response
        try {
            response = await this.fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload ?? {}),
                signal: AbortSignal.timeout(timeoutMs)
            })
        } catch (error) {
            throw new botConfig.BotApiError(
                `Сеть недоступна: ${botConfig.trimErrorMessage(error, { token: config?.token })}`,
                { channel: CHANNEL, retryable: true, code: 'network_error' }
            )
        }

        let data = null
        try {
            data = await response.json()
        } catch {
            data = null
        }

        if (!response.ok || data?.ok === false) {
            const status = Number(response.status) || null
            const description = typeof data?.description === 'string' && data.description
                ? data.description
                : `HTTP ${status ?? 'error'}`
            throw new botConfig.BotApiError(
                botConfig.trimErrorMessage(description, { token: config?.token }),
                {
                    channel: CHANNEL,
                    status,
                    retryable: botConfig.isRetryableStatus(status),
                    retryAfterMs: retryAfterFromPayload(data) ?? retryAfterFromHeaders(response.headers),
                    code: data?.error_code != null ? String(data.error_code) : null
                }
            )
        }

        return {
            result: data?.result ?? null,
            latencyMs: Date.now() - startedAt
        }
    }

    async request(method, payload, { retry = true, ...options } = {}) {
        try {
            return await this.performRequest(method, payload, options)
        } catch (error) {
            if (!retry || !error?.retryable) throw error
            const delay = Number.isFinite(error.retryAfterMs)
                ? error.retryAfterMs
                : botConfig.DEFAULT_RETRY_DELAY_MS
            await this.sleep(Math.min(delay, botConfig.MAX_RETRY_DELAY_MS))
            return this.performRequest(method, payload, options)
        }
    }

    async getMe({ force = false } = {}) {
        const config = this.getConfig()
        const now = Date.now()

        if (!config?.configured) {
            this.state = {
                info: null,
                fetchedAt: 0,
                checkedAt: now,
                lastError: 'Токен Telegram-бота не задан'
            }
            return {
                ok: false,
                configured: false,
                botId: null,
                username: config?.username ?? null,
                name: null,
                error: this.state.lastError
            }
        }

        if (!force && this.state.info && now - this.state.fetchedAt < botConfig.INFO_CACHE_TTL_MS) {
            return { ok: true, configured: true, ...this.state.info, cached: true }
        }

        if (!force &&
            this.state.lastError &&
            Number.isFinite(this.state.checkedAt) &&
            now - this.state.checkedAt < botConfig.ERROR_CACHE_TTL_MS
        ) {
            return {
                ok: false,
                configured: true,
                botId: null,
                username: config.username,
                name: null,
                error: this.state.lastError,
                cached: true
            }
        }

        try {
            const { result } = await this.request('getMe', {}, { retry: true })
            const info = {
                botId: result?.id != null ? String(result.id) : null,
                username: result?.username ?? config.username ?? null,
                name: result?.first_name ?? 'Лейка'
            }
            this.state = {
                info,
                fetchedAt: Date.now(),
                checkedAt: Date.now(),
                lastError: null
            }
            return { ok: true, configured: true, ...info, cached: false }
        } catch (error) {
            const message = botConfig.trimErrorMessage(error, { token: config.token })
            this.state = {
                info: null,
                fetchedAt: 0,
                checkedAt: Date.now(),
                lastError: message
            }
            return {
                ok: false,
                configured: true,
                botId: null,
                username: config.username,
                name: null,
                error: message,
                status: error?.status ?? null,
                cached: false
            }
        }
    }

    async getBotInfo() {
        const info = await this.getMe()
        return {
            channel: CHANNEL,
            configured: info.configured,
            available: Boolean(info.ok),
            botId: info.botId ?? null,
            username: info.username ?? null,
            name: info.name ?? null,
            botUrl: botConfig.buildBotUrl(CHANNEL, info.username),
            lastError: info.ok ? null : (info.error || null),
            checkedAt: new Date(this.state.checkedAt || Date.now()).toISOString()
        }
    }

    async sendMessage({
        chatId,
        text,
        buttonUrl = null,
        buttonText = BUTTON_TEXT
    } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, configured: false, error: 'Токен Telegram-бота не задан' }
        }

        const recipient = chatId === undefined || chatId === null
            ? ''
            : String(chatId).trim()
        if (!recipient) return { ok: false, error: 'Не указан получатель сообщения' }

        const payload = {
            chat_id: recipient,
            text: botConfig.truncateBotText(text, TEXT_LIMIT),
            disable_web_page_preview: true
        }
        if (typeof buttonUrl === 'string' && buttonUrl) {
            payload.reply_markup = {
                inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
            }
        }

        try {
            const { result, latencyMs } = await this.request('sendMessage', payload)
            return {
                ok: true,
                messageId: result?.message_id ?? null,
                latencyMs
            }
        } catch (error) {
            return {
                ok: false,
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async setWebhook({ url = botConfig.getWebhookUrl(CHANNEL), secretToken = null } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, error: 'Токен Telegram-бота не задан' }
        }
        const secret = secretToken || config.webhookSecret
        if (!secret) return { ok: false, error: 'Не задан TELEGRAM_BOT_WEBHOOK_SECRET' }
        try {
            await this.request('setWebhook', {
                url,
                secret_token: secret,
                allowed_updates: ['message'],
                drop_pending_updates: false
            })
            return { ok: true, url }
        } catch (error) {
            return {
                ok: false,
                url,
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async deleteWebhook({ dropPendingUpdates = false } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, error: 'Токен Telegram-бота не задан' }
        }
        try {
            await this.request('deleteWebhook', { drop_pending_updates: dropPendingUpdates })
            return { ok: true }
        } catch (error) {
            return {
                ok: false,
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async getUpdates({ offset = null, timeout = 25, limit = 50 } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, updates: [], error: 'Токен Telegram-бота не задан' }
        }
        const payload = {
            timeout,
            limit,
            allowed_updates: ['message']
        }
        if (Number.isInteger(offset) && offset > 0) payload.offset = offset

        try {
            const { result } = await this.request('getUpdates', payload, {
                timeoutMs: Math.max(
                    botConfig.HTTP_TIMEOUT_MS,
                    (Math.max(1, Number(timeout) || 0) + 5) * 1000
                )
            })
            return { ok: true, updates: Array.isArray(result) ? result : [] }
        } catch (error) {
            return {
                ok: false,
                updates: [],
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async health() {
        return this.getBotInfo()
    }
}

const telegramBotService = new TelegramBotService()

export default telegramBotService
