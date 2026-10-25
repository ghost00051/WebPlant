import test from 'node:test'
import assert from 'node:assert/strict'

import botPollingJob, {
    getPollingState,
    isRunning,
    resetPollingState,
    start,
    stop
} from './botPollingJob.js'
import botChannelService from '../services/botChannelService.js'

const ENV_KEYS = [
    'BOTS_ENABLED',
    'BOT_POLLING_ENABLED',
    'BOT_WEBHOOK_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'MAX_BOT_TOKEN',
    'TELEGRAM_BOT_WEBHOOK_SECRET',
    'MAX_BOT_WEBHOOK_SECRET'
]

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

test('start: BOTS_ENABLED=false — polling не запускается', async () => {
    await stop()
    resetPollingState()
    await withEnv({
        BOTS_ENABLED: 'false',
        BOT_POLLING_ENABLED: 'true'
    }, async () => {
        assert.equal(start(), false)
        assert.equal(isRunning(), false)
    })
})

test('start: polling выключен — вебхуки приоритетнее', async () => {
    await stop()
    resetPollingState()
    const restore = stubService({
        warmBotIdentities: async () => ({}),
        registerWebhooks: async () => ({})
    })
    try {
        await withEnv({
            BOTS_ENABLED: 'true',
            BOT_POLLING_ENABLED: 'false',
            BOT_WEBHOOK_ENABLED: 'true',
            TELEGRAM_BOT_TOKEN: undefined,
            MAX_BOT_TOKEN: undefined
        }, async () => {
            assert.equal(start(), false)
        })
    } finally {
        restore()
    }
})

test('start: при включённых вебхуках регистрирует их best-effort', async () => {
    await stop()
    resetPollingState()
    let registered = 0
    const restore = stubService({
        warmBotIdentities: async () => ({}),
        registerWebhooks: async () => {
            registered += 1
            return { telegram: { ok: true } }
        }
    })
    try {
        await withEnv({
            BOTS_ENABLED: 'true',
            BOT_POLLING_ENABLED: 'false',
            BOT_WEBHOOK_ENABLED: 'true',
            TELEGRAM_BOT_TOKEN: undefined,
            MAX_BOT_TOKEN: undefined
        }, async () => {
            start()
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(registered, 1)
        })
    } finally {
        restore()
    }
})

test('start/stop: идемпотентны и безопасны без запущенных циклов', async () => {
    await stop()
    resetPollingState()
    assert.equal(isRunning(), false)
    assert.deepEqual(
        Object.keys(getPollingState()).sort(),
        ['channels', 'maxMarker', 'running', 'telegramOffset']
    )
    await stop()
    assert.equal(botPollingJob.isRunning(), false)
})

test('resetPollingState: сбрасывает offset и marker', () => {
    resetPollingState()
    assert.deepEqual(getPollingState(), {
        running: false,
        channels: 0,
        telegramOffset: 0,
        maxMarker: null
    })
})
