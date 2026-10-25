import * as botConfig from '../utils/botConfig.js'

const CHANNEL = 'max'
const TEXT_LIMIT = 4000
const BUTTON_TEXT = 'Открыть Лейку'
const LONG_POLL_EXTRA_MS = 5_000

function retryAfterFromPayload(payload) {
    const seconds = Number(payload?.retry_after ?? payload?.parameters?.retry_after)
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

function buildUrl(base, path, query) {
    const url = new URL(`${base}${path}`)
    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === '') continue
            url.searchParams.set(key, String(value))
        }
    }
    return url.toString()
}

function normalizeBotInfo(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const name = data.name ?? data.first_name ?? data.title ?? null
    return {
        botId: data.user_id !== undefined && data.user_id !== null ? String(data.user_id) : null,
        username: typeof data.username === 'string' && data.username ? data.username : null,
        name: typeof name === 'string' && name ? name : null
    }
}

export class MaxBotService {
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

    async performRequest({
        method = 'GET',
        path = '/me',
        query = null,
        body = null,
        timeoutMs = botConfig.HTTP_TIMEOUT_MS
    } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            throw new botConfig.BotApiError('Токен MAX-бота не задан', {
                channel: CHANNEL,
                code: 'not_configured'
            })
        }

        const url = buildUrl(config.apiBase, path, query)
        const startedAt = Date.now()
        const headers = { authorization: config.token }
        if (body !== null && body !== undefined) headers['content-type'] = 'application/json'

        let response
        try {
            response = await this.fetch(url, {
                method,
                headers,
                body: body === null || body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            })
        } catch (error) {
            throw new botConfig.BotApiError(
                `Сеть недоступна: ${botConfig.trimErrorMessage(error, { token: config.token })}`,
                { channel: CHANNEL, retryable: true, code: 'network_error' }
            )
        }

        let data = null
        try {
            data = await response.json()
        } catch {
            data = null
        }

        const failed = !response.ok || data?.success === false
        if (failed) {
            const status = Number(response.status) || null
            const description = data?.message ||
                data?.error?.message ||
                (typeof data?.error === 'string' ? data.error : null) ||
                `HTTP ${status ?? 'error'}`
            throw new botConfig.BotApiError(
                botConfig.trimErrorMessage(description, { token: config.token }),
                {
                    channel: CHANNEL,
                    status,
                    retryable: botConfig.isRetryableStatus(status),
                    retryAfterMs: retryAfterFromPayload(data) ?? retryAfterFromHeaders(response.headers),
                    code: data?.code != null ? String(data.code) : null
                }
            )
        }

        return {
            data: data ?? {},
            latencyMs: Date.now() - startedAt
        }
    }

    async request(options, { retry = true } = {}) {
        try {
            return await this.performRequest(options)
        } catch (error) {
            if (!retry || !error?.retryable) throw error
            const delay = Number.isFinite(error.retryAfterMs)
                ? error.retryAfterMs
                : botConfig.DEFAULT_RETRY_DELAY_MS
            await this.sleep(Math.min(delay, botConfig.MAX_RETRY_DELAY_MS))
            return this.performRequest(options)
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
                lastError: 'Токен MAX-бота не задан'
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
            const { data } = await this.request({ path: '/me' })
            const normalized = normalizeBotInfo(data)
            const info = {
                botId: normalized.botId,
                username: normalized.username || config.username || null,
                name: normalized.name || 'Лейка'
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
        userId,
        text,
        buttonUrl = null,
        buttonText = BUTTON_TEXT
    } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, configured: false, error: 'Токен MAX-бота не задан' }
        }

        const recipient = userId === undefined || userId === null
            ? ''
            : String(userId).trim()
        if (!recipient) return { ok: false, error: 'Не указан получатель сообщения' }

        const body = {
            text: botConfig.truncateBotText(text, TEXT_LIMIT)
        }
        if (typeof buttonUrl === 'string' && buttonUrl) {
            body.attachments = [{
                type: 'inline_keyboard',
                payload: {
                    buttons: [[{ type: 'link', text: buttonText, url: buttonUrl }]]
                }
            }]
        }

        try {
            const { data, latencyMs } = await this.request({
                method: 'POST',
                path: '/messages',
                query: { user_id: recipient },
                body
            })
            return {
                ok: true,
                messageId: data?.message?.body?.mid ?? data?.message?.mid ?? null,
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
            return { ok: false, error: 'Токен MAX-бота не задан' }
        }
        const secret = secretToken || config.webhookSecret
        if (!secret) return { ok: false, error: 'Не задан MAX_BOT_WEBHOOK_SECRET' }
        try {
            await this.request({
                method: 'POST',
                path: '/subscriptions',
                body: {
                    url,
                    update_types: [...botConfig.MAX_UPDATE_TYPES],
                    secret
                }
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

    async deleteWebhook({ url = botConfig.getWebhookUrl(CHANNEL) } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, error: 'Токен MAX-бота не задан' }
        }
        try {
            await this.request({
                method: 'DELETE',
                path: '/subscriptions',
                query: { url }
            })
            return { ok: true }
        } catch (error) {
            return {
                ok: false,
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async getUpdates({ marker = null, timeout = 30, limit = 100 } = {}) {
        const config = this.getConfig()
        if (!config?.configured) {
            return { ok: false, updates: [], marker: marker ?? null, error: 'Токен MAX-бота не задан' }
        }

        const safeTimeout = Math.max(1, Math.min(90, Number(timeout) || 30))
        const query = {
            timeout: safeTimeout,
            limit,
            types: botConfig.MAX_UPDATE_TYPES.join(',')
        }
        if (marker !== undefined && marker !== null && marker !== '') {
            query.marker = String(marker)
        }

        try {
            const { data } = await this.request({
                path: '/updates',
                query,
                timeoutMs: (safeTimeout * 1000) + LONG_POLL_EXTRA_MS
            })
            return {
                ok: true,
                updates: Array.isArray(data?.updates) ? data.updates : [],
                marker: data?.marker ?? marker ?? null
            }
        } catch (error) {
            return {
                ok: false,
                updates: [],
                marker: marker ?? null,
                error: botConfig.trimErrorMessage(error, { token: config.token }),
                status: error?.status ?? null
            }
        }
    }

    async health() {
        return this.getBotInfo()
    }
}

const maxBotService = new MaxBotService()

export default maxBotService
