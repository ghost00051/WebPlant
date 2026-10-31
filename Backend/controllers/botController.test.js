import test from 'node:test'
import assert from 'node:assert/strict'

import botController from './botController.js'
import botChannelService, { BotChannelError } from '../services/botChannelService.js'

const ENV_KEYS = [
    'BOTS_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_WEBHOOK_SECRET',
    'MAX_BOT_WEBHOOK_SECRET',
    'FRONTEND_URL'
]

process.env.BOTS_ENABLED = 'true'
process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token'
process.env.TELEGRAM_BOT_WEBHOOK_SECRET = 'tg-header-secret'
process.env.MAX_BOT_TOKEN = 'max-test-token'
process.env.MAX_BOT_WEBHOOK_SECRET = 'max-header-secret'

async function withEnv(overrides, fn) {
    const backup = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
    try {
        for (const [key, value] of Object.entries(overrides)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        return await fn()
    } finally {
        for (const [key, value] of backup) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

function createRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        }
    }
}

function stubService(methods) {
    const restores = []
    for (const [key, value] of Object.entries(methods)) {
        const original = botChannelService[key]
        botChannelService[key] = value
        restores.push(() => {
            botChannelService[key] = original
        })
    }
    return () => {
        for (const restore of restores.reverse()) restore()
    }
}

async function flushBackgroundTasks() {
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
}

test('listChannels: отдаёт данные сервиса', async () => {
    const restore = stubService({
        listChannelsForUser: async userId => ({ channels: [{ channel: 'telegram' }], userId })
    })
    try {
        const res = createRes()
        await botController.listChannels({ user: { id: 5 } }, res)
        assert.equal(res.statusCode, 200)
        assert.equal(res.body.userId, 5)
        assert.equal(res.body.channels.length, 1)
    } finally {
        restore()
    }
})

test('createLinkCode: пустой channel — 400', async () => {
    const res = createRes()
    await botController.createLinkCode({ user: { id: 5 }, body: {} }, res)
    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, /Укажите канал/)
})

test('createLinkCode: ошибка сервиса 503 отдаётся как {message}', async () => {
    const restore = stubService({
        createLinkCode: async () => {
            throw new BotChannelError('Telegram не настроен', { status: 503 })
        }
    })
    try {
        const res = createRes()
        await botController.createLinkCode({ user: { id: 5 }, body: { channel: 'telegram' } }, res)
        assert.equal(res.statusCode, 503)
        assert.deepEqual(res.body, { message: 'Telegram не настроен' })
    } finally {
        restore()
    }
})

test('createLinkCode: успех — 200 и контрактные поля', async () => {
    const payload = {
        channel: 'telegram',
        code: 'abc',
        deepLink: 'https://t.me/leyka?start=abc',
        botUsername: 'leyka',
        expiresAt: '2026-10-25T12:15:00.000Z'
    }
    const restore = stubService({ createLinkCode: async () => payload })
    try {
        const res = createRes()
        await botController.createLinkCode({ user: { id: 5 }, body: { channel: 'telegram' } }, res)
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, payload)
    } finally {
        restore()
    }
})

test('unlink: возвращает {channel, linked:false}', async () => {
    const restore = stubService({
        unlinkUser: async () => ({ channel: 'max', linked: false, unlinked: 1 })
    })
    try {
        const res = createRes()
        await botController.unlink({ user: { id: 5 }, body: { channel: 'max' } }, res)
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, { channel: 'max', linked: false })
    } finally {
        restore()
    }
})

test('preferences: невалидный notificationsEnabled — 400', async () => {
    const res = createRes()
    await botController.updatePreferences({
        user: { id: 5 },
        body: { channel: 'telegram', notificationsEnabled: 'yes' }
    }, res)
    assert.equal(res.statusCode, 400)
})

test('preferences: сохраняет тумблер', async () => {
    const restore = stubService({
        setNotificationsEnabled: async (userId, channel, enabled) => ({
            channel,
            notificationsEnabled: enabled
        })
    })
    try {
        const res = createRes()
        await botController.updatePreferences({
            user: { id: 5 },
            body: { channel: 'telegram', notificationsEnabled: false }
        }, res)
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, { channel: 'telegram', notificationsEnabled: false })
    } finally {
        restore()
    }
})

test('telegramWebhook: неверный секрет — 401, обработки нет', async () => {
    let processed = false
    const restore = stubService({
        handleIncomingUpdate: async () => {
            processed = true
        }
    })
    try {
        const res = createRes()
        await botController.telegramWebhook({
            headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
            body: { update_id: 1 }
        }, res)
        await flushBackgroundTasks()
        assert.equal(res.statusCode, 401)
        assert.equal(processed, false)
    } finally {
        restore()
    }
})

test('telegramWebhook: верный секрет — быстрый 200 и фоновая обработка', async () => {
    let processed = null
    const restore = stubService({
        handleIncomingUpdate: async (channel, update) => {
            processed = { channel, update }
            return { handled: true }
        }
    })
    try {
        const res = createRes()
        await botController.telegramWebhook({
            headers: { 'x-telegram-bot-api-secret-token': 'tg-header-secret' },
            body: { update_id: 11 }
        }, res)
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, { ok: true })
        await flushBackgroundTasks()
        assert.deepEqual(processed, { channel: 'telegram', update: { update_id: 11 } })
    } finally {
        restore()
    }
})

test('maxWebhook: секрет сервера не задан — 503', async () => {
    await withEnv({ MAX_BOT_WEBHOOK_SECRET: undefined }, async () => {
        const res = createRes()
        await botController.maxWebhook({
            headers: { 'x-max-bot-api-secret': 'whatever' },
            body: {}
        }, res)
        assert.equal(res.statusCode, 503)
    })
})

test('maxWebhook: неверный секрет — 401', async () => {
    const res = createRes()
    await botController.maxWebhook({
        headers: { 'x-max-bot-api-secret': 'wrong' },
        body: {}
    }, res)
    assert.equal(res.statusCode, 401)
})
