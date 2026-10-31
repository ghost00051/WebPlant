import test from 'node:test'
import assert from 'node:assert/strict'

import telegramBotService from './telegramBotService.js'

const TOKEN = '123456:TEST_TOKEN_NOT_REAL'
const API_BASE = 'https://telegram.example'

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
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url: String(url), options })
        return handler(String(url), options, calls.length)
    }
    telegramBotService.fetchImpl = fetchImpl
    telegramBotService.sleepFn = async () => {}
    return calls
}

function withTelegramEnv(fn) {
    const backup = {
        token: process.env.TELEGRAM_BOT_TOKEN,
        base: process.env.TELEGRAM_BOT_API_BASE,
        username: process.env.TELEGRAM_BOT_USERNAME,
        webhookSecret: process.env.TELEGRAM_BOT_WEBHOOK_SECRET,
        frontend: process.env.FRONTEND_URL
    }
    process.env.TELEGRAM_BOT_TOKEN = TOKEN
    process.env.TELEGRAM_BOT_API_BASE = API_BASE
    process.env.TELEGRAM_BOT_USERNAME = 'leyka_test_bot'
    process.env.TELEGRAM_BOT_WEBHOOK_SECRET = 'webhook-secret'
    process.env.FRONTEND_URL = 'https://checktheplants.ru'
    telegramBotService.resetState()
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            process.env.TELEGRAM_BOT_TOKEN = backup.token
            process.env.TELEGRAM_BOT_API_BASE = backup.base
            process.env.TELEGRAM_BOT_USERNAME = backup.username
            process.env.TELEGRAM_BOT_WEBHOOK_SECRET = backup.webhookSecret
            process.env.FRONTEND_URL = backup.frontend
            telegramBotService.fetchImpl = null
            telegramBotService.sleepFn = null
            telegramBotService.resetState()
        })
}

test('getMe: успешный ответ и кэширование (один запрос на два вызова)', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, {
            ok: true,
            result: { id: 777, is_bot: true, first_name: 'Лейка', username: 'leyka_test_bot' }
        }))

        const first = await telegramBotService.getMe()
        const second = await telegramBotService.getMe()

        assert.equal(first.ok, true)
        assert.equal(first.username, 'leyka_test_bot')
        assert.equal(first.name, 'Лейка')
        assert.equal(first.botId, '777')
        assert.equal(second.cached, true)
        assert.equal(calls.length, 1)
        assert.match(calls[0].url, /\/bot123456:TEST_TOKEN_NOT_REAL\/getMe$/)
        assert.equal(calls[0].options.method, 'POST')
    })
})

test('getMe: сетевая ошибка не бросает исключение и не раскрывает токен', async () => {
    await withTelegramEnv(async () => {
        installFetch(() => {
            throw new Error('connect ECONNREFUSED')
        })

        const info = await telegramBotService.getMe()
        assert.equal(info.ok, false)
        assert.equal(info.configured, true)
        assert.match(info.error, /Сеть недоступна/)
        assert.equal(info.error.includes(TOKEN), false)

        const health = await telegramBotService.health()
        assert.equal(health.configured, true)
        assert.equal(health.available, false)
        assert.equal(String(health.lastError).includes(TOKEN), false)
    })
})

test('getMe: без токена канал не настроен', async () => {
    const backup = process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_BOT_TOKEN
    try {
        telegramBotService.resetState()
        const info = await telegramBotService.getMe()
        assert.equal(info.configured, false)
        assert.equal(info.ok, false)
        assert.match(info.error, /не задан/)
    } finally {
        process.env.TELEGRAM_BOT_TOKEN = backup
        telegramBotService.resetState()
    }
})

test('sendMessage: chat_id, текст и inline-кнопка «Открыть Лейку»', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, {
            ok: true,
            result: { message_id: 42 }
        }))

        const result = await telegramBotService.sendMessage({
            chatId: 9001,
            text: 'Пора полить 🌿',
            buttonUrl: 'https://checktheplants.ru/home'
        })

        assert.equal(result.ok, true)
        assert.equal(result.messageId, 42)
        assert.equal(calls.length, 1)

        const payload = JSON.parse(calls[0].options.body)
        assert.equal(payload.chat_id, '9001')
        assert.equal(payload.text, 'Пора полить 🌿')
        assert.equal(payload.disable_web_page_preview, true)
        assert.equal(payload.reply_markup.inline_keyboard[0][0].text, 'Открыть Лейку')
        assert.equal(
            payload.reply_markup.inline_keyboard[0][0].url,
            'https://checktheplants.ru/home'
        )
    })
})

test('sendMessage: 429 -> одна повторная попытка по retry_after', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch((url, options, attempt) => {
            if (attempt === 1) {
                return jsonResponse(429, {
                    ok: false,
                    error_code: 429,
                    description: 'Too Many Requests: retry after 1',
                    parameters: { retry_after: 0 }
                })
            }
            return jsonResponse(200, { ok: true, result: { message_id: 5 } })
        })

        const result = await telegramBotService.sendMessage({ chatId: '1', text: 'привет' })
        assert.equal(result.ok, true)
        assert.equal(calls.length, 2)
    })
})

test('sendMessage: две ошибки 500 не бросают наружу', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch(() => jsonResponse(500, {
            ok: false,
            description: 'Internal Server Error'
        }))

        const result = await telegramBotService.sendMessage({ chatId: '1', text: 'привет' })
        assert.equal(result.ok, false)
        assert.equal(calls.length, 2)
        assert.match(result.error, /Internal Server Error/)
    })
})

test('sendMessage: сеть недоступна -> ok:false, токен не утекает', async () => {
    await withTelegramEnv(async () => {
        installFetch(() => {
            throw new Error('The operation was aborted due to timeout')
        })
        const result = await telegramBotService.sendMessage({ chatId: '1', text: 'привет' })
        assert.equal(result.ok, false)
        assert.match(result.error, /Сеть недоступна/)
        assert.equal(result.error.includes(TOKEN), false)
    })
})

test('sendMessage: пустой получатель — ошибка без запроса', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, { ok: true, result: {} }))
        const result = await telegramBotService.sendMessage({ chatId: '', text: 'x' })
        assert.equal(result.ok, false)
        assert.equal(calls.length, 0)
    })
})

test('setWebhook: url + secret_token', async () => {
    await withTelegramEnv(async () => {
        const calls = installFetch(() => jsonResponse(200, { ok: true, result: true }))
        const result = await telegramBotService.setWebhook({ url: 'https://example.com/hook' })
        assert.equal(result.ok, true)

        const payload = JSON.parse(calls[0].options.body)
        assert.equal(payload.url, 'https://example.com/hook')
        assert.equal(payload.secret_token, 'webhook-secret')
        assert.deepEqual(payload.allowed_updates, ['message'])
    })
})

test('deleteWebhook и getUpdates', async () => {
    await withTelegramEnv(async () => {
        let method = null
        installFetch(url => {
            method = url.split('/').pop()
            if (method === 'getUpdates') {
                return jsonResponse(200, {
                    ok: true,
                    result: [{ update_id: 10, message: { text: '/start' } }]
                })
            }
            return jsonResponse(200, { ok: true, result: true })
        })

        const deleted = await telegramBotService.deleteWebhook()
        assert.equal(deleted.ok, true)

        const updates = await telegramBotService.getUpdates({ offset: 9, timeout: 1 })
        assert.equal(updates.ok, true)
        assert.equal(updates.updates.length, 1)
        assert.equal(method, 'getUpdates')
    })
})
