import { randomBytes } from 'node:crypto'
import { Op } from 'sequelize'

import BotLink from '../models/BotLink.js'
import BotLinkCode from '../models/BotLinkCode.js'
import BotMessage from '../models/BotMessage.js'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import telegramBotService from './telegramBotService.js'
import maxBotService from './maxBotService.js'
import * as botConfig from '../utils/botConfig.js'
import { getRedisClient, getRedisKeyPrefix, withTimeout } from '../redis.js'

export class BotChannelError extends Error {
    constructor(message, { status = 500, code = null } = {}) {
        super(message)
        this.name = 'BotChannelError'
        this.status = status
        this.code = code
    }
}

export const CHANNEL_SERVICES = Object.freeze({
    telegram: telegramBotService,
    max: maxBotService
})

export const MESSENGER_TEXT_MAX_LENGTH = 4000
export const LINK_CODE_TTL_MINUTES = botConfig.DEFAULT_LINK_CODE_TTL_MINUTES
const LINK_CODE_BYTES = 18
const DEDUPE_TTL_MS = 10 * 60 * 1000
const WARN_INTERVAL_MS = 60_000

export const NOTIFICATION_KIND_BY_TAG = Object.freeze({
    on_day: 'reminder',
    day_before: 'reminder',
    auto_skip: 'reminder',
    reminders_paused: 'reminder',
    'morning-summary': 'summary',
    weekly_recap: 'weekly_recap'
})

export function notificationKindFromTag(tag) {
    if (typeof tag !== 'string') return 'notification'
    return NOTIFICATION_KIND_BY_TAG[tag] || 'notification'
}

export const BOT_TEXTS = Object.freeze({
    welcome: [
        'Привет! Я бот «Лейки» 🌿',
        '',
        'Напоминаю, когда пора полить растения. Чтобы привязать аккаунт, откройте «Лейку» → «Настройки» → «Боты», получите код и отправьте его сюда командой:',
        '/start <код>',
        '',
        'Команды: /status, /stop, /help'
    ].join('\n'),
    alreadyLinked: [
        'Этот чат уже привязан к аккаунту «Лейки» ✅',
        '',
        'Проверить состояние — /status, отвязать — /stop.'
    ].join('\n'),
    linkSuccess: [
        'Готово! Аккаунт привязан ✅',
        '',
        'Теперь напоминания о поливе будут приходить и сюда. Отключить их можно в настройках «Лейки».'
    ].join('\n'),
    linkInvalid: [
        'Код не подошёл 😔',
        '',
        'Возможно, он устарел или уже использован. Получите новый код в «Лейке» → «Настройки» → «Боты» и отправьте /start <код>.'
    ].join('\n'),
    linkConflict: [
        'Не удалось привязать аккаунт.',
        '',
        'Попробуйте получить новый код в настройках «Лейки» и повторить ещё раз.'
    ].join('\n'),
    stopNotLinked: 'Этот чат ещё не привязан к аккаунту «Лейки». Получите код в настройках и отправьте /start <код>.',
    stopDone: [
        'Готово, отвязали этот чат 👋',
        '',
        'Напоминания больше не будут приходить сюда. Вернуться можно в любой момент — новым кодом из настроек «Лейки».'
    ].join('\n'),
    statusNotLinked: 'Аккаунт не привязан. Получите код в «Лейке» → «Настройки» → «Боты» и отправьте /start <код>.',
    help: [
        'Что я умею:',
        '',
        '/start <код> — привязать аккаунт «Лейки»',
        '/status — аккаунт, число растений и ближайший полив',
        '/stop — отвязать этот чат',
        '/help — эта справка'
    ].join('\n'),
    unknownCommand: [
        'Не понял команду 🤔',
        '',
        'Доступно: /start <код>, /status, /stop, /help.'
    ].join('\n'),
    temporaryProblem: 'Что-то пошло не так. Попробуйте ещё раз через минуту.'
})

const warnTimestamps = new Map()

function warnThrottled(scope, message) {
    const now = Date.now()
    if (now - (warnTimestamps.get(scope) || 0) < WARN_INTERVAL_MS) return
    warnTimestamps.set(scope, now)
    console.warn(`⚠️ Боты (${scope}): ${message}`)
}

export function resetBotChannelWarnings() {
    warnTimestamps.clear()
}


const dedupeMemory = new Map()

function cleanupDedupeMemory(now) {
    if (dedupeMemory.size < 500) return
    for (const [key, expiresAt] of dedupeMemory) {
        if (expiresAt <= now) dedupeMemory.delete(key)
    }
}

export const dedupeStore = {
    async claim(key) {
        const now = Date.now()
        try {
            const redis = await withTimeout(getRedisClient(), 300)
            if (redis) {
                const redisKey = `${getRedisKeyPrefix()}:bot:dedupe:${key}`
                const reply = await withTimeout(
                    redis.sendCommand([
                        'SET', redisKey, '1', 'NX', 'PX', String(DEDUPE_TTL_MS)
                    ]),
                    300
                )
                if (reply === 'OK') {
                    dedupeMemory.set(key, now + DEDUPE_TTL_MS)
                    cleanupDedupeMemory(now)
                    return true
                }
                if (reply === null) return false
            }
        } catch (error) {
            if (process.env.REDIS_DEBUG === 'true') {
                warnThrottled('dedupe-redis', error?.message || error)
            }
        }

        const expiresAt = dedupeMemory.get(key)
        if (expiresAt && expiresAt > now) return false
        dedupeMemory.set(key, now + DEDUPE_TTL_MS)
        cleanupDedupeMemory(now)
        return true
    }
}

export function resetDedupeMemory() {
    dedupeMemory.clear()
}


export async function logBotMessage(entry = {}) {
    if (!entry || !entry.channel || !entry.status) return null
    const payload = {
        channel: String(entry.channel).slice(0, 16),
        direction: entry.direction === 'in' ? 'in' : 'out',
        status: String(entry.status).slice(0, 16),
        user_id: Number.isInteger(entry.user_id) ? entry.user_id : null,
        bot_link_id: Number.isInteger(entry.bot_link_id) ? entry.bot_link_id : null,
        external_user_id: entry.external_user_id === undefined || entry.external_user_id === null
            ? null
            : String(entry.external_user_id).slice(0, 64),
        notification_id: Number.isInteger(entry.notification_id) ? entry.notification_id : null,
        kind: entry.kind ? String(entry.kind).slice(0, 32) : null,
        error: entry.error ? String(entry.error).slice(0, 1000) : null,
        attempts: Number.isInteger(entry.attempts) && entry.attempts > 0 ? entry.attempts : 1,
        latency_ms: Number.isFinite(entry.latency_ms) ? Math.max(0, Math.round(entry.latency_ms)) : null,
        command: entry.command ? String(entry.command).slice(0, 64) : null,
        payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
        sent_at: entry.sent_at ?? (entry.status === 'sent' ? new Date() : null)
    }

    try {
        return await BotMessage.create(payload)
    } catch (error) {
        warnThrottled('log-message', `не удалось записать bot_messages: ${error?.message || error}`)
        return null
    }
}


export function formatMessengerText({ title, body } = {}) {
    const cleanTitle = typeof title === 'string' ? title.trim() : ''
    const cleanBody = typeof body === 'string' ? body.trim() : ''
    const text = [cleanTitle, cleanBody].filter(Boolean).join('\n\n')
    return botConfig.truncateBotText(text || 'Новое уведомление от «Лейки» 🌿', MESSENGER_TEXT_MAX_LENGTH)
}

export function absoluteFrontendUrl(value) {
    if (typeof value !== 'string' || !value) return botConfig.getOpenAppUrl()
    if (/^https?:\/\//i.test(value)) return value
    const base = botConfig.getFrontendUrl()
    return `${base}${value.startsWith('/') ? '' : '/'}${value}`
}

export const messengerDelivery = {
    async deliver(payload) {
        return deliverNotificationToMessengers(payload)
    }
}

export async function deliverNotificationToMessengers({
    userId,
    title,
    body,
    url = '/home',
    kind = null,
    notificationId = null
} = {}) {
    const summary = {
        enabled: botConfig.isBotsEnabled(),
        delivered: 0,
        failed: 0,
        skipped: 0,
        channels: []
    }
    if (!summary.enabled) return summary
    if (!Number.isInteger(userId) || userId < 1) return summary

    let links = []
    try {
        links = await BotLink.findAll({
            where: {
                user_id: userId,
                is_active: true,
                notifications_enabled: true
            }
        })
    } catch (error) {
        warnThrottled(
            'delivery-links',
            `не удалось прочитать привязки пользователя ${userId}: ${error?.message || error}`
        )
        return summary
    }

    if (!Array.isArray(links) || links.length === 0) return summary

    const text = formatMessengerText({ title, body })
    const buttonUrl = absoluteFrontendUrl(url)
    const resolvedKind = typeof kind === 'string' && kind ? kind.slice(0, 32) : 'notification'

    for (const link of links) {
        const channel = botConfig.normalizeChannel(link?.channel)
        if (!channel) {
            summary.skipped += 1
            continue
        }
        if (!botConfig.isChannelConfigured(channel)) {
            summary.skipped += 1
            continue
        }

        const startedAt = Date.now()
        let outcome
        try {
            outcome = channel === 'telegram'
                ? await telegramBotService.sendMessage({
                    chatId: link.external_user_id,
                    text,
                    buttonUrl
                })
                : await maxBotService.sendMessage({
                    userId: link.external_user_id,
                    text,
                    buttonUrl
                })
        } catch (error) {
            outcome = {
                ok: false,
                error: botConfig.trimErrorMessage(error, {
                    token: botConfig.getChannelConfig(channel)?.token
                })
            }
        }

        const ok = Boolean(outcome?.ok)
        await logBotMessage({
            channel,
            direction: 'out',
            user_id: userId,
            bot_link_id: Number.isInteger(link.id) ? link.id : null,
            external_user_id: link.external_user_id ?? null,
            notification_id: notificationId,
            kind: resolvedKind,
            status: ok ? 'sent' : 'failed',
            error: ok ? null : (outcome?.error || 'unknown error'),
            latency_ms: Date.now() - startedAt,
            payload: {
                title: botConfig.truncateBotText(title || '', 120),
                url: buttonUrl
            }
        })

        if (ok) summary.delivered += 1
        else summary.failed += 1
        summary.channels.push({
            channel,
            ok,
            error: ok ? null : (outcome?.error || null)
        })
    }

    return summary
}


export function generateLinkCode() {
    return randomBytes(LINK_CODE_BYTES).toString('base64url')
}

export function linkCodeExpiry(now = new Date(), ttlMinutes = botConfig.getLinkCodeTtlMinutes()) {
    const ttl = Number.isInteger(ttlMinutes) && ttlMinutes > 0
        ? ttlMinutes
        : LINK_CODE_TTL_MINUTES
    return new Date(now.getTime() + ttl * 60 * 1000)
}

export async function resolveBotUsername(channel, { allowFetch = false } = {}) {
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) return null
    const config = botConfig.getChannelConfig(normalized)
    if (!config) return null
    if (config.username) return config.username
    const cached = CHANNEL_SERVICES[normalized]?.getCachedInfo?.()
    if (cached?.username) return cached.username
    if (!allowFetch) return null
    try {
        const info = await CHANNEL_SERVICES[normalized].getMe()
        return info?.username ?? null
    } catch (error) {
        warnThrottled('bot-username', error?.message || error)
        return null
    }
}

export async function createLinkCode(userId, channel) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new BotChannelError('Не авторизован', { status: 401, code: 'unauthorized' })
    }
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) {
        throw new BotChannelError(
            'Неизвестный канал. Доступны: telegram, max',
            { status: 400, code: 'unknown_channel' }
        )
    }
    if (!botConfig.isBotsEnabled()) {
        throw new BotChannelError('Привязка ботов сейчас отключена', {
            status: 503,
            code: 'bots_disabled'
        })
    }

    const config = botConfig.getChannelConfig(normalized)
    if (!config?.configured) {
        throw new BotChannelError(`${config?.title || 'Канал'} не настроен на сервере`, {
            status: 503,
            code: 'channel_not_configured'
        })
    }

    const username = await resolveBotUsername(normalized, { allowFetch: true })
    if (!username) {
        throw new BotChannelError(
            `Не удалось получить имя бота ${config.title}. Попробуйте позже.`,
            { status: 503, code: 'bot_username_unknown' }
        )
    }

    const now = new Date()
    const ttlMinutes = botConfig.getLinkCodeTtlMinutes()
    const expiresAt = linkCodeExpiry(now, ttlMinutes)
    const code = generateLinkCode()

    try {
        await BotLinkCode.update(
            { expires_at: now },
            {
                where: {
                    user_id: userId,
                    channel: normalized,
                    used_at: null,
                    expires_at: { [Op.gt]: now }
                }
            }
        )
        await BotLinkCode.create({
            code,
            user_id: userId,
            channel: normalized,
            expires_at: expiresAt
        })
    } catch (error) {
        warnThrottled('create-code', error?.message || error)
        throw new BotChannelError('Не удалось создать код привязки. Попробуйте позже.', {
            status: 500,
            code: 'code_create_failed'
        })
    }

    return {
        channel: normalized,
        code,
        deepLink: botConfig.buildDeepLink(normalized, username, code),
        botUsername: username,
        expiresAt: expiresAt.toISOString()
    }
}

function isUniqueViolation(error) {
    return error?.name === 'SequelizeUniqueConstraintError' ||
        error?.parent?.code === '23505'
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function attachLink({
    userId,
    channel,
    externalUserId,
    username = null,
    displayName = null,
    metadata = {},
    transaction,
    now = new Date()
}) {
    const externalId = String(externalUserId)
    const existingExternal = await BotLink.findOne({
        where: { channel, external_user_id: externalId },
        transaction,
        lock: transaction.LOCK.UPDATE
    })
    const existingUserActive = await BotLink.findOne({
        where: { user_id: userId, channel, is_active: true },
        transaction,
        lock: transaction.LOCK.UPDATE
    })

    const mergedMetadata = {
        ...normalizeMetadata(existingExternal?.metadata),
        ...normalizeMetadata(metadata)
    }
    const profileFields = {}
    if (username) profileFields.username = String(username).slice(0, 128)
    if (displayName) profileFields.display_name = String(displayName).slice(0, 128)

    if (existingExternal) {
        if (existingUserActive && existingUserActive.id !== existingExternal.id) {
            await existingUserActive.update({ is_active: false, unlinked_at: now }, { transaction })
        }
        const sameUser = Number(existingExternal.user_id) === Number(userId)
        const updates = {
            ...profileFields,
            is_active: true,
            unlinked_at: null,
            metadata: mergedMetadata
        }
        if (!sameUser) {
            updates.user_id = userId
            updates.linked_at = now
            updates.notifications_enabled = true
        } else if (!existingExternal.is_active) {
            updates.linked_at = now
        }
        const link = await existingExternal.update(updates, { transaction })
        return { link, created: false, rebound: !sameUser }
    }

    if (existingUserActive) {
        await existingUserActive.update({ is_active: false, unlinked_at: now }, { transaction })
    }

    const link = await BotLink.create({
        user_id: userId,
        channel,
        external_user_id: externalId,
        username: profileFields.username ?? null,
        display_name: profileFields.display_name ?? null,
        notifications_enabled: true,
        is_active: true,
        linked_at: now,
        unlinked_at: null,
        metadata: mergedMetadata
    }, { transaction })

    return { link, created: true, rebound: false }
}

export async function redeemLinkCode({
    channel,
    code,
    externalUserId,
    username = null,
    displayName = null,
    metadata = {}
} = {}) {
    const normalized = botConfig.normalizeChannel(channel)
    const cleanCode = typeof code === 'string' ? code.trim() : ''
    const externalId = externalUserId === undefined || externalUserId === null
        ? ''
        : String(externalUserId).trim()
    if (!normalized || !cleanCode || !externalId) {
        return { ok: false, reason: 'invalid' }
    }

    let transaction = null
    try {
        transaction = await BotLink.sequelize.transaction()
        const now = new Date()
        const linkCode = await BotLinkCode.findOne({
            where: {
                code: cleanCode,
                channel: normalized,
                used_at: null,
                expires_at: { [Op.gt]: now }
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (!linkCode) {
            await transaction.rollback()
            transaction = null
            return { ok: false, reason: 'invalid' }
        }

        const [marked] = await BotLinkCode.update(
            { used_at: now },
            { where: { id: linkCode.id, used_at: null }, transaction }
        )
        if (!marked) {
            await transaction.rollback()
            transaction = null
            return { ok: false, reason: 'used' }
        }

        const outcome = await attachLink({
            userId: linkCode.user_id,
            channel: normalized,
            externalUserId: externalId,
            username,
            displayName,
            metadata: { ...normalizeMetadata(metadata), source: 'link_code' },
            transaction,
            now
        })

        await transaction.commit()
        transaction = null

        return {
            ok: true,
            userId: linkCode.user_id,
            channel: normalized,
            link: outcome.link,
            created: outcome.created,
            rebound: outcome.rebound
        }
    } catch (error) {
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback()
            } catch {
            }
        }
        if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' }
        warnThrottled('redeem-code', `не удалось погасить код: ${error?.message || error}`)
        return { ok: false, reason: 'error', error: botConfig.trimErrorMessage(error) }
    }
}


export async function unlinkUser(userId, channel) {
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) {
        throw new BotChannelError('Неизвестный канал. Доступны: telegram, max', {
            status: 400,
            code: 'unknown_channel'
        })
    }
    if (!Number.isInteger(userId) || userId < 1) {
        throw new BotChannelError('Не авторизован', { status: 401, code: 'unauthorized' })
    }

    let count = 0
    try {
        [count] = await BotLink.update(
            { is_active: false, unlinked_at: new Date() },
            { where: { user_id: userId, channel: normalized, is_active: true } }
        )
    } catch (error) {
        warnThrottled('unlink', error?.message || error)
        throw new BotChannelError('Не удалось отвязать канал. Попробуйте позже.', {
            status: 500,
            code: 'unlink_failed'
        })
    }

    return { channel: normalized, linked: false, unlinked: Number(count) || 0 }
}

export async function setNotificationsEnabled(userId, channel, enabled) {
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) {
        throw new BotChannelError('Неизвестный канал. Доступны: telegram, max', {
            status: 400,
            code: 'unknown_channel'
        })
    }
    if (typeof enabled !== 'boolean') {
        throw new BotChannelError('Поле notificationsEnabled должно быть true или false', {
            status: 400,
            code: 'invalid_notifications_enabled'
        })
    }

    let count = 0
    try {
        [count] = await BotLink.update(
            { notifications_enabled: enabled },
            { where: { user_id: userId, channel: normalized, is_active: true } }
        )
    } catch (error) {
        warnThrottled('preferences', error?.message || error)
        throw new BotChannelError('Не удалось сохранить настройки. Попробуйте позже.', {
            status: 500,
            code: 'preferences_failed'
        })
    }

    if (!count) {
        throw new BotChannelError('Канал не привязан к аккаунту', {
            status: 404,
            code: 'not_linked'
        })
    }

    return { channel: normalized, notificationsEnabled: enabled }
}

function toIsoOrNull(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

async function readLinkMessages(linkId) {
    let lastDeliveryAt = null
    let lastError = null
    if (!Number.isInteger(linkId)) return { lastDeliveryAt, lastError }

    try {
        const lastSent = await BotMessage.findOne({
            where: { bot_link_id: linkId, direction: 'out', status: 'sent' },
            order: [['created_at', 'DESC']],
            attributes: ['created_at', 'sent_at']
        })
        lastDeliveryAt = toIsoOrNull(lastSent?.sent_at ?? lastSent?.created_at)
    } catch (error) {
        warnThrottled('last-delivery', error?.message || error)
    }

    try {
        const lastFailed = await BotMessage.findOne({
            where: { bot_link_id: linkId, direction: 'out', status: 'failed' },
            order: [['created_at', 'DESC']],
            attributes: ['error']
        })
        lastError = lastFailed?.error ? String(lastFailed.error) : null
    } catch (error) {
        warnThrottled('last-error', error?.message || error)
    }

    return { lastDeliveryAt, lastError }
}

export async function listChannelsForUser(userId) {
    let links = []
    try {
        links = await BotLink.findAll({
            where: { user_id: userId, is_active: true }
        })
    } catch (error) {
        warnThrottled('list-links', error?.message || error)
        links = []
    }

    const byChannel = new Map(
        (Array.isArray(links) ? links : [])
            .filter(link => link && link.channel)
            .map(link => [link.channel, link])
    )

    const channels = []
    for (const channel of botConfig.BOT_CHANNELS) {
        const config = botConfig.getChannelConfig(channel)
        const link = byChannel.get(channel) || null
        const botUsername = await resolveBotUsername(channel, { allowFetch: false })
        const cached = CHANNEL_SERVICES[channel]?.getCachedInfo?.()
        const { lastDeliveryAt, lastError } = link
            ? await readLinkMessages(Number(link.id))
            : { lastDeliveryAt: null, lastError: null }

        channels.push({
            channel,
            title: config.title,
            configured: Boolean(config.configured),
            botUsername: botUsername || null,
            botName: cached?.name || null,
            botUrl: botConfig.buildBotUrl(channel, botUsername),
            linked: Boolean(link),
            externalUsername: link?.username || null,
            linkedAt: toIsoOrNull(link?.linked_at),
            notificationsEnabled: link ? Boolean(link.notifications_enabled) : false,
            lastDeliveryAt,
            lastError
        })
    }

    return {
        channels,
        linkCodeTtlMinutes: botConfig.getLinkCodeTtlMinutes()
    }
}


const COMMAND_PATTERN = /^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/

export function parseBotCommand(text) {
    const raw = typeof text === 'string' ? text.trim() : ''
    if (!raw) return { command: null, args: '' }
    const match = raw.match(COMMAND_PATTERN)
    if (!match) return { command: null, args: '' }
    return {
        command: match[1].toLowerCase(),
        args: (match[2] || '').trim()
    }
}

function joinDisplayName(first, last) {
    return [first, last].filter(part => typeof part === 'string' && part.trim()).join(' ').trim() || null
}

export function normalizeTelegramUpdate(update) {
    if (!update || typeof update !== 'object') return null
    const updateId = update.update_id !== undefined && update.update_id !== null
        ? String(update.update_id)
        : null
    const message = update.message || update.edited_message
    if (!message || typeof message !== 'object') return { unsupported: true, updateId }

    const from = message.from || {}
    if (from.is_bot) return { ignore: true, updateId }

    const externalUserId = message.chat?.id ?? from.id
    if (externalUserId === undefined || externalUserId === null) {
        return { ignore: true, updateId }
    }

    return {
        updateId,
        externalUserId: String(externalUserId),
        username: typeof from.username === 'string' ? from.username : null,
        displayName: joinDisplayName(from.first_name, from.last_name),
        text: typeof message.text === 'string' ? message.text : ''
    }
}

export function maxUpdateDedupeKey(update) {
    const type = typeof update?.update_type === 'string' ? update.update_type : 'update'
    const mid = update?.message?.body?.mid
    if (mid !== undefined && mid !== null) return `${type}:${String(mid)}`
    const userId = update?.user?.user_id ?? update?.message?.sender?.user_id ?? ''
    const timestamp = update?.timestamp ?? ''
    if (!userId && !timestamp) return null
    return `${type}:${String(timestamp)}:${String(userId)}`
}

export function normalizeMaxUpdate(update) {
    if (!update || typeof update !== 'object') return null
    const type = typeof update.update_type === 'string' ? update.update_type : ''
    const updateId = maxUpdateDedupeKey(update)

    if (type === 'bot_started') {
        const user = update.user || {}
        const externalUserId = user.user_id ?? update.chat_id
        if (externalUserId === undefined || externalUserId === null) {
            return { ignore: true, updateId }
        }
        const payload = typeof update.payload === 'string' ? update.payload.trim() : ''
        return {
            updateId,
            externalUserId: String(externalUserId),
            username: typeof user.username === 'string' ? user.username : null,
            displayName: joinDisplayName(user.first_name, user.last_name),
            text: payload ? `/start ${payload}` : '/start'
        }
    }

    if (type !== 'message_created') return { unsupported: true, updateId }

    const message = update.message || {}
    const sender = message.sender || {}
    if (sender.is_bot) return { ignore: true, updateId }

    const recipient = message.recipient || {}
    if (recipient.chat_type && recipient.chat_type !== 'dialog') {
        return { ignore: true, updateId }
    }

    const externalUserId = sender.user_id ?? recipient.user_id
    if (externalUserId === undefined || externalUserId === null) {
        return { ignore: true, updateId }
    }

    return {
        updateId,
        externalUserId: String(externalUserId),
        username: typeof sender.username === 'string' ? sender.username : null,
        displayName: joinDisplayName(sender.first_name, sender.last_name),
        text: typeof message.body?.text === 'string' ? message.body.text : ''
    }
}


function formatMoment(value) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) return null
    try {
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).format(date)
    } catch {
        return date.toISOString()
    }
}

export async function buildStatusText(link) {
    if (!link) return BOT_TEXTS.statusNotLinked

    const userId = Number(link.user_id)
    let userName = null
    let plantsCount = 0
    let nearestPlant = null

    try {
        const [user, count, nearest] = await Promise.all([
            User.findByPk(userId, { attributes: ['id', 'name', 'username'] }),
            Plant.count({ where: { user_id: userId, is_active: true } }),
            Plant.findOne({
                where: {
                    user_id: userId,
                    is_active: true,
                    next_watering_at: { [Op.ne]: null }
                },
                order: [['next_watering_at', 'ASC']],
                attributes: ['id', 'name', 'next_watering_at']
            })
        ])
        userName = user?.name || user?.username || null
        plantsCount = Number(count) || 0
        nearestPlant = nearest || null
    } catch (error) {
        warnThrottled('status', error?.message || error)
        return BOT_TEXTS.temporaryProblem
    }

    const lines = [`Аккаунт: ${userName || 'аккаунт «Лейки»'}`, `Растений: ${plantsCount}`]
    if (nearestPlant?.next_watering_at) {
        const moment = formatMoment(nearestPlant.next_watering_at)
        const name = nearestPlant.name || 'Растение'
        lines.push(`Ближайший полив: «${botConfig.truncateBotText(name, 60)}»${moment ? ` — ${moment}` : ''}`)
    } else {
        lines.push('Ближайший полив: не запланирован')
    }
    lines.push(`Уведомления: ${link.notifications_enabled ? 'включены' : 'выключены'}`)
    return lines.join('\n')
}

async function buildCommandReply({ channel, command, args, link, externalUserId, username, displayName }) {
    const openAppUrl = botConfig.getOpenAppUrl()

    if (command === 'start') {
        if (args) {
            const result = await redeemLinkCode({
                channel,
                code: args,
                externalUserId,
                username,
                displayName,
                metadata: { source: 'start_command' }
            })
            if (result.ok) return { text: BOT_TEXTS.linkSuccess, buttonUrl: openAppUrl }
            return {
                text: result.reason === 'conflict' ? BOT_TEXTS.linkConflict : BOT_TEXTS.linkInvalid,
                buttonUrl: openAppUrl
            }
        }
        return {
            text: link ? BOT_TEXTS.alreadyLinked : BOT_TEXTS.welcome,
            buttonUrl: openAppUrl
        }
    }

    if (command === 'stop') {
        if (!link) return { text: BOT_TEXTS.stopNotLinked }
        await unlinkUser(link.user_id, channel)
        return { text: BOT_TEXTS.stopDone }
    }

    if (command === 'status') {
        return {
            text: await buildStatusText(link),
            buttonUrl: link ? null : openAppUrl
        }
    }

    if (command === 'help') {
        return { text: BOT_TEXTS.help, buttonUrl: openAppUrl }
    }

    return { text: BOT_TEXTS.unknownCommand, buttonUrl: openAppUrl }
}

async function sendChannelMessage(channel, externalUserId, { text, buttonUrl = null }) {
    const config = botConfig.getChannelConfig(channel)
    if (!config?.configured) {
        return { ok: false, error: `${config?.title || 'Канал'} не настроен` }
    }
    try {
        return channel === 'telegram'
            ? await telegramBotService.sendMessage({ chatId: externalUserId, text, buttonUrl })
            : await maxBotService.sendMessage({ userId: externalUserId, text, buttonUrl })
    } catch (error) {
        return { ok: false, error: botConfig.trimErrorMessage(error) }
    }
}

export async function handleIncomingUpdate(channel, update) {
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) return { handled: false, reason: 'unknown_channel' }
    if (!botConfig.isBotsEnabled()) return { handled: false, reason: 'bots_disabled' }

    const parsed = normalized === 'telegram'
        ? normalizeTelegramUpdate(update)
        : normalizeMaxUpdate(update)

    if (!parsed) return { handled: false, reason: 'empty_update' }
    if (parsed.unsupported) return { handled: false, reason: 'unsupported_update' }
    if (parsed.ignore) return { handled: false, reason: 'ignored' }

    return handleIncomingMessage({ channel: normalized, ...parsed })
}

export async function handleIncomingMessage({
    channel,
    externalUserId,
    username = null,
    displayName = null,
    text = '',
    updateId = null
} = {}) {
    const normalized = botConfig.normalizeChannel(channel)
    if (!normalized) return { handled: false, reason: 'unknown_channel' }
    if (!botConfig.isBotsEnabled()) return { handled: false, reason: 'bots_disabled' }

    const externalId = externalUserId === undefined || externalUserId === null
        ? ''
        : String(externalUserId).trim()
    if (!externalId) return { handled: false, reason: 'no_external_user' }

    if (updateId) {
        const fresh = await dedupeStore.claim(`${normalized}:${String(updateId)}`)
        if (!fresh) return { handled: false, duplicate: true }
    }

    let link = null
    try {
        link = await BotLink.findOne({
            where: { channel: normalized, external_user_id: externalId, is_active: true }
        })
    } catch (error) {
        warnThrottled(
            'inbound-link',
            `не удалось прочитать привязку ${normalized}/${externalId}: ${error?.message || error}`
        )
        return { handled: false, reason: 'storage_unavailable' }
    }

    const parsed = parseBotCommand(text)
    const command = parsed.command

    await logBotMessage({
        channel: normalized,
        direction: 'in',
        status: 'received',
        user_id: link?.user_id ?? null,
        bot_link_id: Number.isInteger(link?.id) ? link.id : null,
        external_user_id: externalId,
        command: command || (typeof text === 'string' && text.trim() ? 'text' : 'empty'),
        payload: { text: botConfig.truncateBotText(text || '', 500) }
    })

    if (link && typeof link.update === 'function') {
        const updates = { last_inbound_at: new Date() }
        if (username) updates.username = String(username).slice(0, 128)
        if (displayName) updates.display_name = String(displayName).slice(0, 128)
        try {
            await link.update(updates)
        } catch (error) {
            warnThrottled('inbound-touch', error?.message || error)
        }
    }

    let reply
    try {
        reply = await buildCommandReply({
            channel: normalized,
            command,
            args: parsed.args,
            link,
            externalUserId: externalId,
            username,
            displayName
        })
    } catch (error) {
        warnThrottled('command-reply', error?.message || error)
        reply = { text: BOT_TEXTS.temporaryProblem, buttonUrl: botConfig.getOpenAppUrl() }
    }

    const startedAt = Date.now()
    const outcome = await sendChannelMessage(normalized, externalId, reply)
    await logBotMessage({
        channel: normalized,
        direction: 'out',
        status: outcome.ok ? 'sent' : 'failed',
        user_id: link?.user_id ?? null,
        bot_link_id: Number.isInteger(link?.id) ? link.id : null,
        external_user_id: externalId,
        kind: 'command',
        command: command || 'text',
        error: outcome.ok ? null : (outcome.error || 'unknown error'),
        latency_ms: Date.now() - startedAt,
        payload: { text: botConfig.truncateBotText(reply.text || '', 500) }
    })

    return {
        handled: true,
        command: command || null,
        linked: Boolean(link),
        delivered: Boolean(outcome.ok)
    }
}


const webhookState = new Map()
const WEBHOOK_REREGISTER_MS = 10 * 60 * 1000

export function resetWebhookState() {
    webhookState.clear()
}

export function getWebhookState() {
    const result = {}
    for (const channel of botConfig.BOT_CHANNELS) {
        const config = botConfig.getChannelConfig(channel)
        const cached = webhookState.get(channel)
        if (cached?.result) {
            result[channel] = {
                ...cached.result,
                cached: true,
                checkedAt: new Date(cached.at).toISOString()
            }
            continue
        }
        result[channel] = {
            ok: false,
            configured: Boolean(config?.configured),
            url: botConfig.getWebhookUrl(channel),
            skipped: true,
            reason: 'not_registered',
            error: botConfig.isWebhookEnabled()
                ? 'регистрация вебхука ещё не выполнялась'
                : 'BOT_WEBHOOK_ENABLED выключен'
        }
    }
    return result
}

export async function registerWebhooks({ force = false } = {}) {
    const results = {}

    if (!botConfig.isBotsEnabled()) {
        for (const channel of botConfig.BOT_CHANNELS) {
            results[channel] = {
                ok: false,
                configured: botConfig.isChannelConfigured(channel),
                skipped: true,
                error: 'BOTS_ENABLED выключен'
            }
        }
        return results
    }

    if (!botConfig.isWebhookEnabled()) {
        for (const channel of botConfig.BOT_CHANNELS) {
            results[channel] = {
                ok: false,
                configured: botConfig.isChannelConfigured(channel),
                skipped: true,
                error: 'BOT_WEBHOOK_ENABLED выключен'
            }
        }
        return results
    }

    for (const channel of botConfig.BOT_CHANNELS) {
        const config = botConfig.getChannelConfig(channel)
        const url = botConfig.getWebhookUrl(channel)
        const cached = webhookState.get(channel)

        if (!force && cached && Date.now() - cached.at < WEBHOOK_REREGISTER_MS) {
            results[channel] = { ...cached.result, cached: true }
            continue
        }

        if (!config.configured) {
            results[channel] = {
                ok: false,
                configured: false,
                url,
                skipped: true,
                error: `${config.title}: не настроен токен`
            }
            webhookState.set(channel, { at: Date.now(), result: results[channel] })
            continue
        }
        if (!config.webhookSecret) {
            results[channel] = {
                ok: false,
                configured: true,
                url,
                skipped: true,
                error: `${config.title}: не задан секрет вебхука`
            }
            webhookState.set(channel, { at: Date.now(), result: results[channel] })
            continue
        }

        try {
            const outcome = await CHANNEL_SERVICES[channel].setWebhook({ url })
            results[channel] = {
                ok: Boolean(outcome?.ok),
                configured: true,
                url,
                error: outcome?.ok ? null : (outcome?.error || 'не удалось зарегистрировать вебхук')
            }
            if (outcome?.ok) {
                console.log(`🤖 Боты: вебхук ${config.title} зарегистрирован (${url})`)
            } else {
                warnThrottled('webhook-register', `${config.title}: ${results[channel].error}`)
            }
        } catch (error) {
            results[channel] = {
                ok: false,
                configured: true,
                url,
                error: botConfig.trimErrorMessage(error)
            }
            warnThrottled('webhook-register', `${config.title}: ${results[channel].error}`)
        }

        webhookState.set(channel, { at: Date.now(), result: results[channel] })
    }

    return results
}

export async function warmBotIdentities() {
    const results = {}
    for (const channel of botConfig.getConfiguredChannels()) {
        try {
            const info = await CHANNEL_SERVICES[channel].getMe()
            results[channel] = {
                available: Boolean(info.ok),
                username: info.username ?? null,
                error: info.ok ? null : (info.error || null)
            }
        } catch (error) {
            results[channel] = {
                available: false,
                username: null,
                error: botConfig.trimErrorMessage(error)
            }
        }
    }
    return results
}

export async function getChannelHealth() {
    const channels = {}
    for (const channel of botConfig.BOT_CHANNELS) {
        const config = botConfig.getChannelConfig(channel)
        let health = {
            channel,
            configured: Boolean(config.configured),
            available: false,
            username: config.username,
            name: null,
            lastError: null
        }
        try {
            const probed = await CHANNEL_SERVICES[channel].health()
            health = { ...health, ...probed }
        } catch (error) {
            health.lastError = botConfig.trimErrorMessage(error)
        }
        channels[channel] = {
            ...health,
            title: config.title,
            botUrl: botConfig.buildBotUrl(channel, health.username)
        }
    }

    return {
        enabled: botConfig.isBotsEnabled(),
        webhookEnabled: botConfig.isWebhookEnabled(),
        pollingEnabled: botConfig.isPollingEnabled(),
        channels
    }
}

const botChannelService = {
    BotChannelError,
    notificationKindFromTag,
    formatMessengerText,
    absoluteFrontendUrl,
    generateLinkCode,
    linkCodeExpiry,
    resolveBotUsername,
    createLinkCode,
    redeemLinkCode,
    attachLink,
    unlinkUser,
    setNotificationsEnabled,
    listChannelsForUser,
    parseBotCommand,
    normalizeTelegramUpdate,
    normalizeMaxUpdate,
    buildStatusText,
    handleIncomingUpdate,
    handleIncomingMessage,
    logBotMessage,
    deliverNotificationToMessengers,
    registerWebhooks,
    getWebhookState,
    resetWebhookState,
    warmBotIdentities,
    getChannelHealth,
    resetDedupeMemory
}

export default botChannelService
