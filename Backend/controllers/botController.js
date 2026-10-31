import botChannelService, { BotChannelError } from '../services/botChannelService.js'
import * as botConfig from '../utils/botConfig.js'

const WEBHOOK_HEADERS = botConfig.WEBHOOK_HEADER

function requestHeader(req, name) {
    const direct = req?.headers?.[name]
    if (typeof direct === 'string') return direct
    if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0]
    try {
        const viaGet = typeof req?.get === 'function' ? req.get(name) : undefined
        return typeof viaGet === 'string' ? viaGet : null
    } catch {
        return null
    }
}

function fail(res, error, label) {
    if (error instanceof BotChannelError) {
        return res.status(error.status || 500).json({ message: error.message })
    }
    console.error(`❌ Боты (${label}):`, error)
    return res.status(500).json({ message: 'Не удалось выполнить запрос. Попробуйте позже.' })
}

function readChannel(body) {
    const channel = body?.channel
    if (typeof channel !== 'string' || !channel.trim()) return null
    return channel.trim()
}

function handleWebhook(channel, req, res) {
    const verification = botConfig.verifyWebhookSecret(
        channel,
        requestHeader(req, WEBHOOK_HEADERS[channel])
    )

    if (!verification.ok) {
        if (verification.reason === 'not_configured') {
            return res.status(503).json({ message: `Вебхук ${channel} не настроен на сервере` })
        }
        return res.status(401).json({ message: 'Неверный секрет вебхука' })
    }

    const update = req.body
    res.status(200).json({ ok: true })

    if (!botConfig.isBotsEnabled()) return
    setImmediate(() => {
        botChannelService.handleIncomingUpdate(channel, update)
            .catch(error => {
                console.warn(
                    `⚠️ Боты: ошибка обработки вебхука ${channel}:`,
                    error?.message || error
                )
            })
    })
}

export class BotController {
    async listChannels(req, res) {
        try {
            const payload = await botChannelService.listChannelsForUser(req.user.id)
            return res.json(payload)
        } catch (error) {
            return fail(res, error, 'listChannels')
        }
    }

    async createLinkCode(req, res) {
        const channel = readChannel(req.body)
        if (!channel) {
            return res.status(400).json({ message: 'Укажите канал: telegram или max' })
        }
        try {
            const payload = await botChannelService.createLinkCode(req.user.id, channel)
            return res.json(payload)
        } catch (error) {
            return fail(res, error, 'createLinkCode')
        }
    }

    async unlink(req, res) {
        const channel = readChannel(req.body)
        if (!channel) {
            return res.status(400).json({ message: 'Укажите канал: telegram или max' })
        }
        try {
            const result = await botChannelService.unlinkUser(req.user.id, channel)
            return res.json({ channel: result.channel, linked: false })
        } catch (error) {
            return fail(res, error, 'unlink')
        }
    }

    async updatePreferences(req, res) {
        const channel = readChannel(req.body)
        if (!channel) {
            return res.status(400).json({ message: 'Укажите канал: telegram или max' })
        }
        if (typeof req.body?.notificationsEnabled !== 'boolean') {
            return res.status(400).json({
                message: 'Поле notificationsEnabled должно быть true или false'
            })
        }
        try {
            const payload = await botChannelService.setNotificationsEnabled(
                req.user.id,
                channel,
                req.body.notificationsEnabled
            )
            return res.json(payload)
        } catch (error) {
            return fail(res, error, 'updatePreferences')
        }
    }

    async telegramWebhook(req, res) {
        return handleWebhook('telegram', req, res)
    }

    async maxWebhook(req, res) {
        return handleWebhook('max', req, res)
    }
}

const botController = new BotController()

export default botController
