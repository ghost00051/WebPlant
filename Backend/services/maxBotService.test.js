import test from 'node:test'
import assert from 'node:assert/strict'

import maxBotService from './maxBotService.js'

const TOKEN = 'max-test-token-not-real'
const API_BASE = 'https://max.example'

function jsonResponse(status, payload, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: name => headers[String(name).toLowerCase()] ?? null
        },
        json: async () => payload
    }
}

function installFetch(handler) {
    const calls = []
    maxBotService.fetchImpl = async (url, options = {}) => {
        calls.push({ url: String(url), options })
        return handler(String(url), options, calls.length)
    }
    maxBotService.sleepFn = async () => {}
    return calls
}

function withMaxEnv(fn) {
    const backup = {
        token: process.env.MAX_BOT_TOKEN,
        base: process.env.MAX_BOT_API_BASE,
        username: process.env.MAX_BOT_USERNAME,
        webhookSecret: process.env.MAX_BOT_WEBHOOK_SECRET,
        frontend: process.env.FRONTEND_URL
    }
    process.env.MAX_BOT_TOKEN = TOKEN
    process.env.MAX_BOT_API_BASE = API_BASE
    process.env.MAX_BOT_USERNAME = 'leyka_max_test'
    process.env.MAX_BOT_WEBHOOK_SECRET = 'max-webhook-secret'
    process.env.FRONTEND_URL = 'https://checktheplants.ru'
    maxBotService.resetState()
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            process.env.MAX_BOT_TOKEN = backup.token
            process.env.MAX_BOT_API_BASE = backup.base
            process.env.MAX_BOT_USERNAME = backup.username
            process.env.MAX_BOT_WEBHOOK_SECRET = backup.webhookSecret
            process.env.FRONTEND_URL = backup.frontend
            maxBotService.fetchImpl = null
            maxBotService.sleepFn = null
            maxBotService.resetState()
        })
}

test('getMe: GET /me с Authorization без Bearer, кэширование', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, {
            user_id: 123456789,
            username: 'leyka_max_bot',
            name: 'Лейка',
            is_bot: true
        }))

        const first = await maxBotService.getMe()
        const second = await maxBotService.getMe()

        assert.equal(first.ok, true)
        assert.equal(first.botId, '123456789')
        assert.equal(first.username, 'leyka_max_bot')
        assert.equal(first.name, 'Лейка')
        assert.equal(second.cached, true)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].url, `${API_BASE}/me`)
        assert.equal(calls[0].options.method, 'GET')
        assert.equal(calls[0].options.headers.authorization, TOKEN)
    })
})

test('getMe: ответ без имени — безопасные значения и fallback username из env', async () => {
    await withMaxEnv(async () => {
        installFetch(() => jsonResponse(200, { user_id: 1 }))
        const info = await maxBotService.getMe()
        assert.equal(info.ok, true)
        assert.equal(info.name, 'Лейка')
        assert.equal(info.username, 'leyka_max_test')
    })
})

test('sendMessage: POST /messages?user_id=, текст и inline-кнопка', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, {
            message: { body: { mid: 'mid-42' } }
        }))

        const result = await maxBotService.sendMessage({
            userId: 9001,
            text: 'Пора полить 🌿',
            buttonUrl: 'https://checktheplants.ru/home'
        })

        assert.equal(result.ok, true)
        assert.equal(result.messageId, 'mid-42')

        const url = new URL(calls[0].url)
        assert.equal(url.pathname, '/messages')
        assert.equal(url.searchParams.get('user_id'), '9001')

        const payload = JSON.parse(calls[0].options.body)
        assert.equal(payload.text, 'Пора полить 🌿')
        assert.equal(payload.attachments[0].type, 'inline_keyboard')
        assert.equal(payload.attachments[0].payload.buttons[0][0].type, 'link')
        assert.equal(payload.attachments[0].payload.buttons[0][0].text, 'Открыть Лейку')
        assert.equal(
            payload.attachments[0].payload.buttons[0][0].url,
            'https://checktheplants.ru/home'
        )
        assert.equal(calls[0].options.headers.authorization, TOKEN)
    })
})

test('sendMessage: ошибка сети -> ok:false, токен не раскрывается', async () => {
    await withMaxEnv(async () => {
        installFetch(() => {
            throw new Error('fetch failed: ETIMEDOUT')
        })
        const result = await maxBotService.sendMessage({ userId: '1', text: 'x' })
        assert.equal(result.ok, false)
        assert.match(result.error, /Сеть недоступна/)
        assert.equal(result.error.includes(TOKEN), false)
    })
})

test('sendMessage: 429 -> повтор, затем успех', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch((url, options, attempt) => attempt === 1
            ? jsonResponse(429, { code: 'too_many_requests', message: 'slow down' }, { 'retry-after': '0' })
            : jsonResponse(200, { message: { body: { mid: 'm1' } } }))

        const result = await maxBotService.sendMessage({ userId: '1', text: 'x' })
        assert.equal(result.ok, true)
        assert.equal(calls.length, 2)
    })
})

test('sendMessage: 5xx повторяется один раз и возвращает ошибку', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(502, { message: 'Bad Gateway' }))
        const result = await maxBotService.sendMessage({ userId: '1', text: 'x' })
        assert.equal(result.ok, false)
        assert.equal(calls.length, 2)
        assert.match(result.error, /Bad Gateway/)
    })
})

test('getUpdates: marker, timeout, types', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, {
            updates: [{ update_type: 'message_created' }],
            marker: 55
        }))

        const result = await maxBotService.getUpdates({ marker: 42, timeout: 2, limit: 10 })
        assert.equal(result.ok, true)
        assert.equal(result.updates.length, 1)
        assert.equal(result.marker, 55)

        const url = new URL(calls[0].url)
        assert.equal(url.pathname, '/updates')
        assert.equal(url.searchParams.get('marker'), '42')
        assert.equal(url.searchParams.get('timeout'), '2')
        assert.equal(url.searchParams.get('limit'), '10')
        assert.match(url.searchParams.get('types'), /bot_started/)
    })
})

test('setWebhook: POST /subscriptions c secret и update_types', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, { success: true }))
        const result = await maxBotService.setWebhook({ url: 'https://example.com/max' })
        assert.equal(result.ok, true)

        const url = new URL(calls[0].url)
        assert.equal(url.pathname, '/subscriptions')
        const payload = JSON.parse(calls[0].options.body)
        assert.equal(payload.url, 'https://example.com/max')
        assert.equal(payload.secret, 'max-webhook-secret')
        assert.ok(payload.update_types.includes('message_created'))
        assert.ok(payload.update_types.includes('bot_started'))
    })
})

test('deleteWebhook: DELETE /subscriptions?url=', async () => {
    await withMaxEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, { success: true }))
        const result = await maxBotService.deleteWebhook()
        assert.equal(result.ok, true)
        assert.equal(calls[0].options.method, 'DELETE')
        assert.match(calls[0].url, /\/subscriptions\?url=/)
    })
})

test('getUpdates: без токена — не настроен, без запроса', async () => {
    const backup = process.env.MAX_BOT_TOKEN
    delete process.env.MAX_BOT_TOKEN
    try {
        maxBotService.resetState()
        const result = await maxBotService.getUpdates()
        assert.equal(result.ok, false)
        assert.deepEqual(result.updates, [])
        const health = await maxBotService.health()
        assert.equal(health.configured, false)
        assert.equal(health.available, false)
    } finally {
        process.env.MAX_BOT_TOKEN = backup
        maxBotService.resetState()
    }
})
