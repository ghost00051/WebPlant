import test from 'node:test'
import assert from 'node:assert/strict'

import * as botConfig from './botConfig.js'

const ENV_KEYS = [
    'BOTS_ENABLED',
    'BOT_WEBHOOK_ENABLED',
    'BOT_POLLING_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME',
    'TELEGRAM_BOT_API_BASE',
    'TELEGRAM_BOT_WEBHOOK_SECRET',
    'MAX_BOT_TOKEN',
    'MAX_BOT_USERNAME',
    'MAX_BOT_API_BASE',
    'MAX_BOT_WEBHOOK_SECRET',
    'BOT_PUBLIC_BASE_URL',
    'BOT_LINK_CODE_TTL_MINUTES',
    'FRONTEND_URL'
]

function withEnv(overrides, fn) {
    const backup = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
    try {
        for (const [key, value] of Object.entries(overrides)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        return fn()
    } finally {
        for (const [key, value] of backup) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test('normalizeChannel: приводит регистр и отсекает неизвестные каналы', () => {
    assert.equal(botConfig.normalizeChannel('Telegram'), 'telegram')
    assert.equal(botConfig.normalizeChannel(' MAX '), 'max')
    assert.equal(botConfig.normalizeChannel('vk'), null)
    assert.equal(botConfig.normalizeChannel(null), null)
    assert.equal(botConfig.isKnownChannel('max'), true)
    assert.equal(botConfig.isKnownChannel('instagram'), false)
})

test('getChannelConfig: читает токены, базовые URL и секреты', () => {
    withEnv({
        TELEGRAM_BOT_TOKEN: 'tg-token',
        TELEGRAM_BOT_USERNAME: '@leyka_bot',
        TELEGRAM_BOT_API_BASE: 'https://tg.example/',
        TELEGRAM_BOT_WEBHOOK_SECRET: 'tg-secret',
        MAX_BOT_TOKEN: 'max-token',
        MAX_BOT_USERNAME: 'leyka_max_bot',
        MAX_BOT_API_BASE: '',
        MAX_BOT_WEBHOOK_SECRET: 'max-secret'
    }, () => {
        const telegram = botConfig.getChannelConfig('telegram')
        assert.equal(telegram.configured, true)
        assert.equal(telegram.apiBase, 'https://tg.example')
        assert.equal(telegram.token, 'tg-token')
        assert.equal(telegram.webhookSecret, 'tg-secret')
        assert.equal(telegram.title, 'Telegram')

        const max = botConfig.getChannelConfig('max')
        assert.equal(max.configured, true)
        assert.equal(max.apiBase, botConfig.MAX_API_BASE_DEFAULT)
        assert.equal(max.username, 'leyka_max_bot')
        assert.equal(botConfig.getConfiguredChannels().length, 2)
    })
})

test('getChannelConfig: без токена канал не настроен', () => {
    withEnv({ TELEGRAM_BOT_TOKEN: undefined, MAX_BOT_TOKEN: undefined }, () => {
        assert.equal(botConfig.isChannelConfigured('telegram'), false)
        assert.equal(botConfig.isChannelConfigured('max'), false)
        assert.deepEqual(botConfig.getConfiguredChannels(), [])
        assert.equal(botConfig.getChannelConfig('vk'), null)
    })
})

test('флаги BOTS/вебхуки/polling читаются терпимо', () => {
    withEnv({
        BOTS_ENABLED: 'true',
        BOT_WEBHOOK_ENABLED: '1',
        BOT_POLLING_ENABLED: 'no'
    }, () => {
        assert.equal(botConfig.isBotsEnabled(), true)
        assert.equal(botConfig.isWebhookEnabled(), true)
        assert.equal(botConfig.isPollingEnabled(), false)
    })
    withEnv({ BOTS_ENABLED: 'что-то', BOT_WEBHOOK_ENABLED: undefined }, () => {
        assert.equal(botConfig.isBotsEnabled(), false)
        assert.equal(botConfig.isWebhookEnabled(), false)
    })
})

test('TTL кода привязки: по умолчанию 15 минут, ограничен 1..1440', () => {
    withEnv({ BOT_LINK_CODE_TTL_MINUTES: undefined }, () => {
        assert.equal(botConfig.getLinkCodeTtlMinutes(), 15)
    })
    withEnv({ BOT_LINK_CODE_TTL_MINUTES: '30' }, () => {
        assert.equal(botConfig.getLinkCodeTtlMinutes(), 30)
    })
    withEnv({ BOT_LINK_CODE_TTL_MINUTES: '0' }, () => {
        assert.equal(botConfig.getLinkCodeTtlMinutes(), 15)
    })
    withEnv({ BOT_LINK_CODE_TTL_MINUTES: '99999' }, () => {
        assert.equal(botConfig.getLinkCodeTtlMinutes(), 15)
    })
})

test('ссылки: deep link, бот-URL и вебхук собираются из env', () => {
    withEnv({
        FRONTEND_URL: 'https://checktheplants.ru/,https://test.checktheplants.ru',
        BOT_PUBLIC_BASE_URL: 'https://api.example.com/'
    }, () => {
        assert.equal(botConfig.getFrontendUrl(), 'https://checktheplants.ru')
        assert.equal(botConfig.getOpenAppUrl(), 'https://checktheplants.ru/home')
        assert.equal(botConfig.getPublicBaseUrl(), 'https://api.example.com')
        assert.equal(
            botConfig.getWebhookUrl('telegram'),
            'https://api.example.com/api/bots/telegram/webhook'
        )
        assert.equal(botConfig.buildBotUrl('telegram', '@leyka_bot'), 'https://t.me/leyka_bot')
        assert.equal(botConfig.buildBotUrl('max', 'leyka_max_bot'), 'https://max.ru/leyka_max_bot')
        assert.equal(botConfig.buildBotUrl('telegram', ''), null)
        assert.equal(
            botConfig.buildDeepLink('telegram', 'leyka_bot', 'abc-1'),
            'https://t.me/leyka_bot?start=abc-1'
        )
        assert.equal(botConfig.buildDeepLink('telegram', null, 'abc'), null)
    })
    withEnv({ BOT_PUBLIC_BASE_URL: undefined, FRONTEND_URL: 'https://webplant.local' }, () => {
        assert.equal(botConfig.getPublicBaseUrl(), 'https://webplant.local')
        assert.equal(
            botConfig.getWebhookPath('max'),
            '/api/bots/max/webhook'
        )
    })
})

test('verifyWebhookSecret: сравнение секретов', () => {
    withEnv({
        TELEGRAM_BOT_WEBHOOK_SECRET: 'top-secret',
        MAX_BOT_WEBHOOK_SECRET: undefined
    }, () => {
        assert.deepEqual(botConfig.verifyWebhookSecret('telegram', 'top-secret'), { ok: true })
        assert.equal(botConfig.verifyWebhookSecret('telegram', 'nope').ok, false)
        assert.equal(botConfig.verifyWebhookSecret('telegram', undefined).reason, 'missing')
        assert.equal(botConfig.verifyWebhookSecret('max', 'x').reason, 'not_configured')
        assert.equal(botConfig.verifyWebhookSecret('vk', 'x').reason, 'unknown_channel')
    })
})

test('safeSecretEqual: постоянное по времени сравнение', () => {
    assert.equal(botConfig.safeSecretEqual('abc', 'abc'), true)
    assert.equal(botConfig.safeSecretEqual('abc', 'abd'), false)
    assert.equal(botConfig.safeSecretEqual('abc', 'ab'), false)
    assert.equal(botConfig.safeSecretEqual(null, 'abc'), false)
})

test('обычные ошибки ботов не содержат токен', () => {
    assert.equal(botConfig.trimErrorMessage(new Error('boom'), { token: 'secret-token' }), 'boom')
    assert.equal(
        botConfig.trimErrorMessage('bad secret-token here', { token: 'secret-token' }),
        'bad *** here'
    )
})
