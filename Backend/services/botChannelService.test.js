import test from 'node:test'
import assert from 'node:assert/strict'

import BotLink from '../models/BotLink.js'
import BotLinkCode from '../models/BotLinkCode.js'
import BotMessage from '../models/BotMessage.js'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import telegramBotService from './telegramBotService.js'
import maxBotService from './maxBotService.js'
import {
    BOT_TEXTS,
    BotChannelError,
    absoluteFrontendUrl,
    createLinkCode,
    deliverNotificationToMessengers,
    formatMessengerText,
    generateLinkCode,
    handleIncomingMessage,
    handleIncomingUpdate,
    linkCodeExpiry,
    listChannelsForUser,
    notificationKindFromTag,
    parseBotCommand,
    redeemLinkCode,
    registerWebhooks,
    resetDedupeMemory,
    resetWebhookState,
    setNotificationsEnabled,
    unlinkUser
} from './botChannelService.js'

process.env.BOTS_ENABLED = 'true'
process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token'
process.env.TELEGRAM_BOT_USERNAME = 'leyka_test_bot'
process.env.MAX_BOT_TOKEN = 'max-test-token'
process.env.MAX_BOT_USERNAME = 'leyka_max_test'
process.env.FRONTEND_URL = 'https://checktheplants.ru'
process.env.REDIS_URL = ''
process.env.REDIS_HOST = ''

const ENV_KEYS = [
    'BOTS_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME',
    'MAX_BOT_TOKEN',
    'MAX_BOT_USERNAME',
    'FRONTEND_URL',
    'BOT_LINK_CODE_TTL_MINUTES'
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

async function withStubs(entries, fn) {
    const restores = []
    for (const [target, methods] of entries) {
        for (const [key, value] of Object.entries(methods)) {
            const original = target[key]
            target[key] = value
            restores.push(() => {
                target[key] = original
            })
        }
    }
    try {
        return await fn()
    } finally {
        for (const restore of restores.reverse()) restore()
    }
}

function createLink(overrides = {}) {
    const link = {
        id: 1,
        user_id: 7,
        channel: 'telegram',
        external_user_id: '42',
        username: 'tester',
        display_name: null,
        notifications_enabled: true,
        is_active: true,
        linked_at: new Date('2026-10-01T10:00:00Z'),
        unlinked_at: null,
        metadata: {},
        async update(values) {
            Object.assign(this, values)
            return this
        },
        ...overrides
    }
    return link
}

function createTransaction({ onCommit = null } = {}) {
    const transaction = {
        LOCK: { UPDATE: 'UPDATE' },
        finished: false,
        async commit() {
            transaction.finished = true
            if (onCommit) await onCommit()
        },
        async rollback() {
            transaction.finished = true
        }
    }
    return transaction
}

function telegramSendSpy(outcome = { ok: true }) {
    const calls = []
    telegramBotService.sendMessage = async payload => {
        calls.push(payload)
        return outcome
    }
    return calls
}

function maxSendSpy(outcome = { ok: true }) {
    const calls = []
    maxBotService.sendMessage = async payload => {
        calls.push(payload)
        return outcome
    }
    return calls
}


test('notificationKindFromTag: теги напоминаний, сводки и recap', () => {
    assert.equal(notificationKindFromTag('on_day'), 'reminder')
    assert.equal(notificationKindFromTag('day_before'), 'reminder')
    assert.equal(notificationKindFromTag('auto_skip'), 'reminder')
    assert.equal(notificationKindFromTag('reminders_paused'), 'reminder')
    assert.equal(notificationKindFromTag('morning-summary'), 'summary')
    assert.equal(notificationKindFromTag('weekly_recap'), 'weekly_recap')
    assert.equal(notificationKindFromTag('care-tip'), 'notification')
    assert.equal(notificationKindFromTag(undefined), 'notification')
})

test('formatMessengerText и absoluteFrontendUrl', () => {
    assert.equal(
        formatMessengerText({ title: 'Заголовок', body: 'Тело' }),
        'Заголовок\n\nТело'
    )
    assert.equal(formatMessengerText({ title: '', body: '' }), 'Новое уведомление от «Лейки» 🌿')
    assert.equal(absoluteFrontendUrl('/home'), 'https://checktheplants.ru/home')
    assert.equal(absoluteFrontendUrl('home'), 'https://checktheplants.ru/home')
    assert.equal(absoluteFrontendUrl('https://example.com/x'), 'https://example.com/x')
    assert.equal(absoluteFrontendUrl(''), 'https://checktheplants.ru/home')
})

test('generateLinkCode: url-safe, уникальный', () => {
    const first = generateLinkCode()
    const second = generateLinkCode()
    assert.notEqual(first, second)
    assert.match(first, /^[A-Za-z0-9_-]{16,64}$/)
    assert.equal(first.length <= 64, true)
})

test('linkCodeExpiry: TTL из параметров и окружения', () => {
    const now = new Date('2026-10-25T12:00:00Z')
    assert.equal(
        linkCodeExpiry(now, 15).toISOString(),
        '2026-10-25T12:15:00.000Z'
    )
    withEnv({ BOT_LINK_CODE_TTL_MINUTES: '30' }, () => {
        assert.equal(
            linkCodeExpiry(now).toISOString(),
            '2026-10-25T12:30:00.000Z'
        )
    })
})

test('deliverNotificationToMessengers: BOTS_ENABLED=false — ничего не делаем', async () => {
    await withEnv({ BOTS_ENABLED: 'false' }, async () => {
        const summary = await deliverNotificationToMessengers({
            userId: 1,
            title: 't',
            body: 'b'
        })
        assert.equal(summary.enabled, false)
        assert.equal(summary.delivered, 0)
    })
})

test('deliverNotificationToMessengers: шлёт в оба канала и логирует bot_messages', async () => {
    const logs = []
    const telegramCalls = telegramSendSpy()
    const maxCalls = maxSendSpy()
    const links = [
        createLink({ id: 1, channel: 'telegram', external_user_id: '42' }),
        createLink({ id: 2, channel: 'max', external_user_id: '99' })
    ]

    await withStubs([
        [BotLink, { findAll: async () => links }],
        [BotMessage, {
            create: async entry => {
                logs.push(entry)
                return { id: logs.length }
            }
        }]
    ], async () => {
        const summary = await deliverNotificationToMessengers({
            userId: 7,
            title: '💧 Пора полить!',
            body: 'Фикус ждёт воды',
            url: '/home',
            kind: 'reminder',
            notificationId: 55
        })

        assert.equal(summary.delivered, 2)
        assert.equal(summary.failed, 0)
        assert.equal(telegramCalls.length, 1)
        assert.equal(maxCalls.length, 1)
        assert.equal(telegramCalls[0].chatId, '42')
        assert.equal(maxCalls[0].userId, '99')
        assert.equal(telegramCalls[0].text, '💧 Пора полить!\n\nФикус ждёт воды')
        assert.equal(telegramCalls[0].buttonUrl, 'https://checktheplants.ru/home')

        assert.equal(logs.length, 2)
        assert.equal(logs[0].direction, 'out')
        assert.equal(logs[0].kind, 'reminder')
        assert.equal(logs[0].notification_id, 55)
        assert.equal(logs[0].status, 'sent')
        assert.equal(logs[0].channel, 'telegram')
        assert.equal(logs[1].channel, 'max')
    })
})

test('deliverNotificationToMessengers: сбой одного канала не мешает второму и не бросает', async () => {
    const logs = []
    telegramBotService.sendMessage = async () => {
        throw new Error('boom')
    }
    const maxCalls = maxSendSpy()

    await withStubs([
        [BotLink, {
            findAll: async () => [
                createLink({ id: 1, channel: 'telegram', external_user_id: '42' }),
                createLink({ id: 2, channel: 'max', external_user_id: '99' })
            ]
        }],
        [BotMessage, {
            create: async entry => {
                logs.push(entry)
                return { id: logs.length }
            }
        }]
    ], async () => {
        const summary = await deliverNotificationToMessengers({
            userId: 7,
            title: 't',
            body: 'b'
        })
        assert.equal(summary.delivered, 1)
        assert.equal(summary.failed, 1)
        assert.equal(maxCalls.length, 1)
        assert.equal(logs.find(entry => entry.channel === 'telegram').status, 'failed')
    })
})

test('deliverNotificationToMessengers: ошибка БД при чтении связей не пробрасывается', async () => {
    await withStubs([
        [BotLink, {
            findAll: async () => {
                throw new Error('db is down')
            }
        }]
    ], async () => {
        const summary = await deliverNotificationToMessengers({
            userId: 7,
            title: 't',
            body: 'b'
        })
        assert.equal(summary.delivered, 0)
        assert.equal(summary.failed, 0)
    })
})

test('deliverNotificationToMessengers: не настроенный канал пропускается', async () => {
    await withEnv({ MAX_BOT_TOKEN: undefined }, async () => {
        const telegramCalls = telegramSendSpy()
        await withStubs([
            [BotLink, {
                findAll: async () => [
                    createLink({ id: 1, channel: 'telegram', external_user_id: '42' }),
                    createLink({ id: 2, channel: 'max', external_user_id: '99' })
                ]
            }],
            [BotMessage, { create: async () => ({ id: 1 }) }]
        ], async () => {
            const summary = await deliverNotificationToMessengers({
                userId: 7,
                title: 't',
                body: 'b'
            })
            assert.equal(telegramCalls.length, 1)
            assert.equal(summary.skipped, 1)
            assert.equal(summary.delivered, 1)
        })
    })
})

test('createLinkCode: неизвестный канал — 400', async () => {
    await assert.rejects(
        () => createLinkCode(7, 'vk'),
        error => error instanceof BotChannelError && error.status === 400
    )
})

test('createLinkCode: канал без токена — 503', async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: undefined }, async () => {
        await assert.rejects(
            () => createLinkCode(7, 'telegram'),
            error => error instanceof BotChannelError && error.status === 503
        )
    })
})

test('createLinkCode: создаёт код, инвалидирует прежние и отдаёт deep link', async () => {
    const updates = []
    const created = []

    await withStubs([
        [BotLinkCode, {
            update: async (values, options) => {
                updates.push({ values, options })
                return [1]
            },
            create: async values => {
                created.push(values)
                return values
            }
        }]
    ], async () => {
        const result = await createLinkCode(7, 'telegram')

        assert.equal(result.channel, 'telegram')
        assert.equal(result.botUsername, 'leyka_test_bot')
        assert.match(result.deepLink, /^https:\/\/t\.me\/leyka_test_bot\?start=/)
        assert.ok(result.code.length >= 16)
        assert.equal(updates.length, 1)
        assert.equal(updates[0].options.where.user_id, 7)
        assert.equal(updates[0].options.where.channel, 'telegram')
        assert.equal(created.length, 1)
        assert.equal(created[0].user_id, 7)
        assert.equal(created[0].channel, 'telegram')
        assert.ok(created[0].expires_at instanceof Date)
        assert.ok(created[0].expires_at.getTime() > Date.now())
        assert.equal(new Date(result.expiresAt) > new Date(), true)
    })
})

test('unlinkUser: деактивирует связь', async () => {
    const updates = []
    await withStubs([
        [BotLink, {
            update: async (values, options) => {
                updates.push({ values, options })
                return [1]
            }
        }]
    ], async () => {
        const result = await unlinkUser(7, 'max')
        assert.equal(result.channel, 'max')
        assert.equal(result.linked, false)
        assert.equal(result.unlinked, 1)
        assert.equal(updates[0].values.is_active, false)
        assert.ok(updates[0].values.unlinked_at instanceof Date)
    })
})

test('unlinkUser: неизвестный канал — 400', async () => {
    await assert.rejects(
        () => unlinkUser(7, 'vk'),
        error => error instanceof BotChannelError && error.status === 400
    )
})

test('setNotificationsEnabled: переключатель и ошибки', async () => {
    await withStubs([
        [BotLink, { update: async () => [1] }]
    ], async () => {
        assert.deepEqual(
            await setNotificationsEnabled(7, 'telegram', false),
            { channel: 'telegram', notificationsEnabled: false }
        )
    })

    await withStubs([
        [BotLink, { update: async () => [0] }]
    ], async () => {
        await assert.rejects(
            () => setNotificationsEnabled(7, 'telegram', true),
            error => error instanceof BotChannelError && error.status === 404
        )
    })

    await assert.rejects(
        () => setNotificationsEnabled(7, 'telegram', 'yes'),
        error => error instanceof BotChannelError && error.status === 400
    )
})

test('listChannelsForUser: отдаёт оба канала по контракту', async () => {
    const link = createLink({ id: 3 })
    const sentAt = new Date('2026-10-24T18:00:00Z')

    await withStubs([
        [BotLink, { findAll: async () => [link] }],
        [BotMessage, {
            findOne: async ({ where }) => where.status === 'sent'
                ? { sent_at: sentAt, created_at: sentAt }
                : { error: 'timeout' }
        }]
    ], async () => {
        const payload = await listChannelsForUser(7)
        assert.equal(payload.channels.length, 2)
        assert.equal(payload.linkCodeTtlMinutes, 15)

        const telegram = payload.channels.find(channel => channel.channel === 'telegram')
        assert.equal(telegram.linked, true)
        assert.equal(telegram.title, 'Telegram')
        assert.equal(telegram.configured, true)
        assert.equal(telegram.botUsername, 'leyka_test_bot')
        assert.equal(telegram.botUrl, 'https://t.me/leyka_test_bot')
        assert.equal(telegram.externalUsername, 'tester')
        assert.equal(telegram.notificationsEnabled, true)
        assert.equal(telegram.lastDeliveryAt, sentAt.toISOString())
        assert.equal(telegram.lastError, 'timeout')
        assert.equal(telegram.linkedAt, link.linked_at.toISOString())

        const max = payload.channels.find(channel => channel.channel === 'max')
        assert.equal(max.linked, false)
        assert.equal(max.linkedAt, null)
        assert.equal(max.lastDeliveryAt, null)
    })
})

test('parseBotCommand: /start, /start <code>, /start@bot <code>', () => {
    assert.deepEqual(parseBotCommand('/start'), { command: 'start', args: '' })
    assert.deepEqual(parseBotCommand('/start abc123'), { command: 'start', args: 'abc123' })
    assert.deepEqual(
        parseBotCommand('/start@leyka_bot abc123'),
        { command: 'start', args: 'abc123' }
    )
    assert.deepEqual(parseBotCommand('привет'), { command: null, args: '' })
    assert.deepEqual(parseBotCommand(''), { command: null, args: '' })
})

test('redeemLinkCode: неизвестный код — invalid и откат транзакции', async () => {
    const transaction = createTransaction()
    await withStubs([
        [BotLink, { sequelize: { transaction: async () => transaction } }],
        [BotLinkCode, { findOne: async () => null }]
    ], async () => {
        const result = await redeemLinkCode({
            channel: 'telegram',
            code: 'nope',
            externalUserId: '42'
        })
        assert.deepEqual(result, { ok: false, reason: 'invalid' })
        assert.equal(transaction.finished, true)
    })
})

test('redeemLinkCode: погашает код и привязывает пользователя', async () => {
    const transaction = createTransaction()
    const linkUpdates = []
    const createdLinks = []

    await withStubs([
        [BotLink, {
            sequelize: { transaction: async () => transaction },
            findOne: async () => null,
            create: async values => {
                createdLinks.push(values)
                return createLink({ id: 11, user_id: values.user_id })
            }
        }],
        [BotLinkCode, {
            findOne: async () => ({ id: 5, user_id: 7, channel: 'telegram' }),
            update: async () => [1]
        }]
    ], async () => {
        const result = await redeemLinkCode({
            channel: 'telegram',
            code: 'good-code',
            externalUserId: '42',
            username: 'tester'
        })

        assert.equal(result.ok, true)
        assert.equal(result.userId, 7)
        assert.equal(result.created, true)
        assert.equal(transaction.finished, true)
        assert.equal(createdLinks.length, 1)
        assert.equal(createdLinks[0].external_user_id, '42')
        assert.equal(createdLinks[0].is_active, true)
        assert.equal(createdLinks[0].notifications_enabled, true)
        assert.equal(linkUpdates.length, 0)
    })
})

test('redeemLinkCode: код уже использован — used и откат', async () => {
    const transaction = createTransaction()
    await withStubs([
        [BotLink, { sequelize: { transaction: async () => transaction } }],
        [BotLinkCode, {
            findOne: async () => ({ id: 5, user_id: 7 }),
            update: async () => [0]
        }]
    ], async () => {
        const result = await redeemLinkCode({
            channel: 'telegram',
            code: 'used-code',
            externalUserId: '42'
        })
        assert.deepEqual(result, { ok: false, reason: 'used' })
        assert.equal(transaction.finished, true)
    })
})

test('handleIncomingUpdate: дедупликация одинаковых update_id', async () => {
    resetDedupeMemory()
    const sent = telegramSendSpy()

    await withStubs([
        [BotLink, { findOne: async () => null }],
        [BotMessage, { create: async () => ({ id: 1 }) }]
    ], async () => {
        const update = {
            update_id: 777,
            message: {
                message_id: 1,
                from: { id: 42, is_bot: false, first_name: 'Тест', username: 'tester' },
                chat: { id: 42, type: 'private' },
                text: '/help'
            }
        }

        const first = await handleIncomingUpdate('telegram', update)
        const second = await handleIncomingUpdate('telegram', update)

        assert.equal(first.handled, true)
        assert.equal(second.duplicate, true)
        assert.equal(sent.length, 1)
        assert.match(sent[0].text, /Что я умею/)
    })
})

test('handleIncomingUpdate: MAX bot_started с payload запускает привязку', async () => {
    resetDedupeMemory()
    const transaction = createTransaction()
    const sent = maxSendSpy()

    await withStubs([
        [BotLink, {
            sequelize: { transaction: async () => transaction },
            findOne: async () => null,
            create: async values => createLink({ id: 12, user_id: values.user_id })
        }],
        [BotLinkCode, {
            findOne: async () => ({ id: 6, user_id: 7, channel: 'max' }),
            update: async () => [1]
        }],
        [BotMessage, { create: async () => ({ id: 1 }) }]
    ], async () => {
        const result = await handleIncomingUpdate('max', {
            update_type: 'bot_started',
            timestamp: 1700000000000,
            chat_id: 99,
            user: { user_id: 99, first_name: 'Тест', username: 'max_tester' },
            payload: 'link-code-1'
        })

        assert.equal(result.handled, true)
        assert.equal(sent.length, 1)
        assert.equal(sent[0].text, BOT_TEXTS.linkSuccess)
        assert.equal(sent[0].buttonUrl, 'https://checktheplants.ru/home')
    })
})

test('handleIncomingUpdate: игнорирует сообщения от ботов и группы', async () => {
    resetDedupeMemory()
    const result = await handleIncomingUpdate('telegram', {
        update_id: 1,
        message: {
            from: { id: 1, is_bot: true },
            chat: { id: 1 },
            text: '/start'
        }
    })
    assert.equal(result.handled, false)
    assert.equal(result.reason, 'ignored')

    const maxResult = await handleIncomingUpdate('max', {
        update_type: 'message_created',
        timestamp: 1,
        message: {
            sender: { user_id: 5 },
            recipient: { chat_type: 'chat' },
            body: { text: '/start' }
        }
    })
    assert.equal(maxResult.handled, false)
    assert.equal(maxResult.reason, 'ignored')
})

test('handleIncomingMessage: /status показывает аккаунт, растения и ближайший полив', async () => {
    resetDedupeMemory()
    const sent = telegramSendSpy()
    const link = createLink()

    await withStubs([
        [BotLink, { findOne: async () => link }],
        [BotMessage, { create: async () => ({ id: 1 }) }],
        [User, { findByPk: async () => ({ id: 7, name: 'Аня', username: 'anya' }) }],
        [Plant, {
            count: async () => 3,
            findOne: async () => ({
                id: 1,
                name: 'Фикус',
                next_watering_at: new Date('2026-10-26T09:00:00Z')
            })
        }]
    ], async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/status'
        })

        assert.equal(result.handled, true)
        assert.equal(result.linked, true)
        assert.equal(sent.length, 1)
        assert.match(sent[0].text, /Аккаунт: Аня/)
        assert.match(sent[0].text, /Растений: 3/)
        assert.match(sent[0].text, /Ближайший полив: «Фикус»/)
        assert.match(sent[0].text, /Уведомления: включены/)
    })
})

test('handleIncomingMessage: /stop отвязывает и подтверждает', async () => {
    resetDedupeMemory()
    const sent = telegramSendSpy()
    const link = createLink()
    let unlinkedWhere = null

    await withStubs([
        [BotLink, {
            findOne: async () => link,
            update: async (values, options) => {
                unlinkedWhere = options.where
                return [1]
            }
        }],
        [BotMessage, { create: async () => ({ id: 1 }) }]
    ], async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/stop'
        })
        assert.equal(result.handled, true)
        assert.equal(sent[0].text, BOT_TEXTS.stopDone)
        assert.equal(unlinkedWhere.user_id, 7)
        assert.equal(unlinkedWhere.channel, 'telegram')
    })
})

test('handleIncomingMessage: неизвестная команда подсказывает доступные', async () => {
    resetDedupeMemory()
    const sent = telegramSendSpy()

    await withStubs([
        [BotLink, { findOne: async () => null }],
        [BotMessage, { create: async () => ({ id: 1 }) }]
    ], async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/unknown'
        })
        assert.equal(result.handled, true)
        assert.equal(sent[0].text, BOT_TEXTS.unknownCommand)
    })
})

test('handleIncomingMessage: /start без кода — приветствие', async () => {
    resetDedupeMemory()
    const sent = telegramSendSpy()

    await withStubs([
        [BotLink, { findOne: async () => null }],
        [BotMessage, { create: async () => ({ id: 1 }) }]
    ], async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/start'
        })
        assert.equal(result.handled, true)
        assert.equal(sent[0].text, BOT_TEXTS.welcome)
        assert.match(sent[0].buttonUrl, /\/home$/)
    })
})

test('handleIncomingMessage: ошибка БД при чтении связи — handled:false без исключения', async () => {
    resetDedupeMemory()
    await withStubs([
        [BotLink, {
            findOne: async () => {
                throw new Error('db is down')
            }
        }]
    ], async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/start'
        })
        assert.equal(result.handled, false)
        assert.equal(result.reason, 'storage_unavailable')
    })
})

test('registerWebhooks: регистрирует вебхуки обоих каналов через сервисы', async () => {
    resetWebhookState()
    const telegramCalls = []
    const maxCalls = []

    await withEnv({
        BOT_WEBHOOK_ENABLED: 'true',
        BOT_PUBLIC_BASE_URL: 'https://api.example.com',
        TELEGRAM_BOT_WEBHOOK_SECRET: 'tg-secret',
        MAX_BOT_WEBHOOK_SECRET: 'max-secret'
    }, async () => {
        await withStubs([
            [telegramBotService, {
                setWebhook: async payload => {
                    telegramCalls.push(payload)
                    return { ok: true }
                }
            }],
            [maxBotService, {
                setWebhook: async payload => {
                    maxCalls.push(payload)
                    return { ok: true }
                }
            }]
        ], async () => {
            const results = await registerWebhooks({ force: true })

            assert.equal(results.telegram.ok, true)
            assert.equal(results.max.ok, true)
            assert.equal(telegramCalls.length, 1)
            assert.equal(maxCalls.length, 1)
            assert.equal(
                telegramCalls[0].url,
                'https://api.example.com/api/bots/telegram/webhook'
            )
            assert.equal(
                maxCalls[0].url,
                'https://api.example.com/api/bots/max/webhook'
            )
        })
    })
})

test('registerWebhooks: без секрета/при выключенных вебхуках — понятный ответ, без падения', async () => {
    resetWebhookState()

    await withEnv({ BOT_WEBHOOK_ENABLED: 'false' }, async () => {
        const results = await registerWebhooks({ force: true })
        assert.equal(results.telegram.skipped, true)
        assert.equal(results.max.skipped, true)
        assert.match(results.telegram.error, /BOT_WEBHOOK_ENABLED/)
    })

    await withEnv({
        BOT_WEBHOOK_ENABLED: 'true',
        MAX_BOT_WEBHOOK_SECRET: undefined
    }, async () => {
        await withStubs([
            [telegramBotService, { setWebhook: async () => ({ ok: true }) }]
        ], async () => {
            const results = await registerWebhooks({ force: true })
            assert.equal(results.telegram.ok, true)
            assert.equal(results.max.ok, false)
            assert.equal(results.max.skipped, true)
            assert.match(results.max.error, /секрет/)
        })
    })
    resetWebhookState()
})

test('handleIncomingMessage: BOTS_ENABLED=false — сообщения не обрабатываются', async () => {
    await withEnv({ BOTS_ENABLED: 'false' }, async () => {
        const result = await handleIncomingMessage({
            channel: 'telegram',
            externalUserId: '42',
            text: '/start'
        })
        assert.equal(result.handled, false)
        assert.equal(result.reason, 'bots_disabled')
    })
})
