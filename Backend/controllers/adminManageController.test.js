import assert from 'node:assert/strict'
import test from 'node:test'

import { AdminManageController } from './adminManageController.js'

const CHAT_PHOTO_A = `https://server.checktheplants.ru/uploads/chat/${'a'.repeat(32)}.jpg`
const CHAT_PHOTO_B = `https://server.checktheplants.ru/uploads/chat/${'b'.repeat(32)}.jpg`
const PLANT_PHOTO = `https://server.checktheplants.ru/uploads/plants/${'c'.repeat(32)}.jpg`
const SESSION_ID = '11111111-2222-3333-4444-555555555555'

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

function createChatLogModel(calls, { metadataRows = [], deleted = 1 } = {}) {
    return {
        async findAll(options) {
            calls.push('ChatLog.findAll')
            assert.deepEqual(options.attributes, ['metadata'], 'из chat_logs читаем только metadata')
            return metadataRows
        },
        async count() {
            calls.push('ChatLog.count')
            return 1
        },
        async destroy() {
            calls.push('ChatLog.destroy')
            return deleted
        }
    }
}

function createTestContext({
    user = { id: 42, email: 'leaf@example.com', role: 'USER' },
    chatMetadataRows = [],
    filesRemoved = 1,
    chatPhotoFilesRemoved = 1,
    removeChatPhotoFiles
} = {}) {
    const calls = []

    const models = {
        User: {
            async findByPk() {
                calls.push('User.findByPk')
                return { ...user, destroy: async () => { calls.push('User.row.destroy') } }
            },
            async count() {
                calls.push('User.count')
                return 2
            }
        },
        Plant: {
            async findAll() {
                calls.push('Plant.findAll')
                return [{ id: 11 }]
            },
            async destroy() {
                calls.push('Plant.destroy')
                return 1
            }
        },
        PlantPhoto: {
            async count() { return 1 },
            async destroy() { calls.push('PlantPhoto.destroy'); return 1 }
        },
        WateringLog: {
            async count() { return 1 },
            async destroy() { calls.push('WateringLog.destroy'); return 1 }
        },
        ChatLog: createChatLogModel(calls, { metadataRows: chatMetadataRows }),
        PushSubscription: {
            async count() { return 0 },
            async destroy() { calls.push('PushSubscription.destroy'); return 0 }
        },
        PushBroadcastRecipient: {
            async destroy() { return 0 }
        },
        Notification: {
            async count() { return 0 },
            async destroy() { return 0 }
        },
        NotificationPreference: {
            async destroy() { return 0 }
        },
        UserCookieConsent: {
            async count() { return 0 },
            async destroy() { return 0 }
        },
        UserLegalConsent: {
            async count() { return 0 },
            async destroy() { return 0 }
        },
        AuthSession: {
            async count() { return 0 },
            async destroy() { calls.push('AuthSession.destroy'); return 0 }
        },
        Passkey: {
            async count() { return 0 },
            async destroy() { calls.push('Passkey.destroy'); return 0 }
        }
    }

    const db = {
        async transaction(callback) {
            calls.push('db.transaction')
            return callback({ id: 'tx' })
        },
        async query(sql) {
            calls.push(/push_broadcasts/.test(sql) ? 'db.query:push_broadcasts' : 'db.query:other')
            return [[], 0]
        }
    }

    const controller = new AdminManageController({
        models,
        db,
        select: async () => {
            calls.push('select:photos')
            return [{ url: PLANT_PHOTO }]
        },
        hasSiteVisitDays: async () => false,
        removePlantPhotoFiles: async urls => {
            calls.push(`removePlantPhotoFiles:${urls.length}`)
            return filesRemoved
        },
        removeChatPhotoFiles: removeChatPhotoFiles || (async urls => {
            calls.push(`removeChatPhotoFiles:${urls.length}`)
            return chatPhotoFilesRemoved
        }),
        recordAdminAction: async () => {
            calls.push('audit')
            return true
        }
    })

    return { controller, calls }
}

test('deleteUser: фото чата собираются до транзакции и удаляются после коммита', async () => {
    const { controller, calls } = createTestContext({
        chatMetadataRows: [
            { metadata: { photoUrl: CHAT_PHOTO_A, photoUrls: [CHAT_PHOTO_A, CHAT_PHOTO_B] } },
            { metadata: { photoUrl: CHAT_PHOTO_A } },
            { metadata: { guestToken: 'guest-token' } }
        ],
        chatPhotoFilesRemoved: 2
    })
    const res = createResponse()

    await controller.deleteUser({ params: { id: '42' }, user: { id: 1 }, requestId: 'req-1' }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.deleted, true)
    assert.equal(res.body.removed.photoFiles, 1)
    assert.equal(res.body.removed.chatPhotoFiles, 2)
    assert.ok(calls.includes('audit'), 'удаление пользователя попадает в аудит')

    const indexOf = marker => calls.indexOf(marker)
    assert.ok(indexOf('ChatLog.findAll') < indexOf('db.transaction'), 'metadata читаем до удаления')
    assert.ok(indexOf('db.transaction') < indexOf('removeChatPhotoFiles:2'), 'файлы удаляем после коммита')
    assert.ok(indexOf('User.row.destroy') < indexOf('removeChatPhotoFiles:2'), 'только после удаления строки')
    assert.ok(indexOf('audit') < indexOf('removeChatPhotoFiles:2'), 'аудит пишется до удаления файлов')
})

test('deleteUser: ошибка удаления фото чата не ломает ответ', async t => {
    t.mock.method(console, 'warn', () => {})
    const { controller, calls } = createTestContext({
        chatMetadataRows: [{ metadata: { photoUrl: CHAT_PHOTO_A } }],
        removeChatPhotoFiles: async () => {
            throw new Error('EACCES')
        }
    })
    const res = createResponse()

    await controller.deleteUser({ params: { id: '42' }, user: { id: 1 } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.deleted, true)
    assert.equal(res.body.removed.chatPhotoFiles, 0)
    assert.ok(calls.includes('removePlantPhotoFiles:1'), 'фото растений удаляются дальше')
})

test('deleteChat: фото сообщения удаляются после удаления строки', async () => {
    const calls = []
    const message = {
        id: 5,
        session_id: 's-1',
        role: 'user',
        metadata: { photoUrl: CHAT_PHOTO_A },
        async destroy() {
            calls.push('message.destroy')
            return 1
        }
    }

    const controller = new AdminManageController({
        models: {
            ChatLog: {
                async findByPk() {
                    calls.push('ChatLog.findByPk')
                    return message
                }
            }
        },
        recordAdminAction: async () => {
            calls.push('audit')
            return true
        },
        removeChatPhotoFiles: async urls => {
            calls.push(`removeChatPhotoFiles:${urls.length}`)
            return 1
        }
    })
    const res = createResponse()

    await controller.deleteChat({ params: { id: '5' }, user: { id: 1 } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.chatPhotoFiles, 1)
    assert.ok(calls.indexOf('ChatLog.findByPk') < calls.indexOf('message.destroy'))
    assert.ok(calls.indexOf('message.destroy') < calls.indexOf('removeChatPhotoFiles:1'))
})

test('deleteChatSession: фото всей переписки удаляются после удаления строк', async () => {
    const calls = []
    let destroyed = false

    const controller = new AdminManageController({
        models: {
            ChatLog: {
                async findAll(options) {
                    calls.push('ChatLog.findAll')
                    assert.deepEqual(options.where, { session_id: SESSION_ID })
                    assert.deepEqual(options.attributes, ['metadata'])
                    return [
                        { metadata: { photoUrl: CHAT_PHOTO_A } },
                        { metadata: { photoUrls: [CHAT_PHOTO_B] } }
                    ]
                },
                async destroy() {
                    calls.push('ChatLog.destroy')
                    destroyed = true
                    return 2
                }
            }
        },
        recordAdminAction: async () => {
            calls.push('audit')
            return true
        },
        removeChatPhotoFiles: async urls => {
            calls.push(`removeChatPhotoFiles:${urls.length}`)
            assert.equal(destroyed, true, 'файлы нельзя удалять до строк в БД')
            return 2
        }
    })
    const res = createResponse()

    await controller.deleteChatSession({ params: { sessionId: SESSION_ID }, user: { id: 1 } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.removed, 2)
    assert.equal(res.body.chatPhotoFiles, 2)
    assert.ok(calls.indexOf('ChatLog.findAll') < calls.indexOf('ChatLog.destroy'))
    assert.ok(calls.indexOf('ChatLog.destroy') < calls.indexOf('removeChatPhotoFiles:2'))
})

const VISIT_AT = '2026-10-27T08:02:11.354Z'
const CHAT_AT = '2026-10-17T12:00:00.000Z'

function createUserRow(overrides = {}) {
    return {
        id: 3,
        email: 'ilya@example.com',
        name: 'Илья',
        username: 'ilya',
        phone: null,
        role: 'USER',
        privilege_level: 'free',
        created_at: '2026-09-01T10:00:00.000Z',
        plants: 1,
        active_plants: 1,
        waterings: 0,
        photos: 0,
        chat_messages: 2,
        push_subscriptions: 0,
        last_activity_at: VISIT_AT,
        last_visit_at: VISIT_AT,
        ...overrides
    }
}

function createStatsRow(overrides = {}) {
    return {
        plants: 1,
        active_plants: 1,
        waterings: 0,
        skipped: 0,
        photos: 0,
        chat_messages: 2,
        chat_sessions: 1,
        push_subscriptions: 0,
        passkeys: 0,
        active_sessions: 0,
        last_watering_at: null,
        last_chat_at: CHAT_AT,
        last_visit_at: VISIT_AT,
        last_activity_at: VISIT_AT,
        ...overrides
    }
}

function createQueryContext({
    visitsTracked = true,
    userRows = [createUserRow()],
    baseUserRow = userRows[0],
    statsRow = createStatsRow()
} = {}) {
    const queries = []

    const select = async (sql, params = []) => {
        queries.push({ sql, params })

        if (/AS last_watering_at/.test(sql)) return [statsRow]
        if (/LIMIT \$\d+/.test(sql) && /GREATEST\(/.test(sql)) return userRows
        if (/count\(\*\)::int AS total FROM users u/.test(sql)) {
            return [{ total: userRows.length }]
        }
        if (/FROM users u/.test(sql) && /u\.id = \$1/.test(sql)) return [baseUserRow]
        if (/FROM plants p/.test(sql)) return []
        if (/FROM watering_logs w/.test(sql)) return []
        if (/FROM chat_logs c/.test(sql)) return []
        if (/FROM auth_sessions/.test(sql)) return []
        if (/FROM passkeys/.test(sql)) return []
        if (/FROM push_subscriptions/.test(sql)) return []
        if (/FROM user_legal_consents/.test(sql)) return []
        if (/FROM user_cookie_consents/.test(sql)) return []
        return []
    }

    const controller = new AdminManageController({
        select,
        hasSiteVisitDays: async () => visitsTracked,
        hasUsersCreatedAt: async () => true
    })

    const userQueries = () => queries.map(query => query.sql)
    return { controller, queries, userQueries }
}

test('listUsers: активность учитывает последний заход из site_visit_days', async () => {
    const { controller, queries } = createQueryContext({ visitsTracked: true })
    const res = createResponse()

    await controller.listUsers({ query: { sort: 'activity', order: 'desc' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.items.length, 1)
    assert.equal(res.body.items[0].lastActivityAt, VISIT_AT)
    assert.equal(res.body.items[0].lastVisitAt, VISIT_AT)

    const mainQuery = queries.find(query => /LIMIT \$\d+/.test(query.sql))
    assert.ok(mainQuery, 'запрос списка пользователей выполнен')
    assert.match(mainQuery.sql, /site_visit_days/, 'активность берёт заходы из site_visit_days')
    assert.match(
        mainQuery.sql,
        /GREATEST\(pl\.last_at, wl\.last_at, ch\.last_at, sv\.last_at\) AS last_activity_at/,
        'GREATEST включает визиты'
    )
    assert.match(mainQuery.sql, /sv\.last_at AS last_visit_at/, 'payload списка знает последний заход')
    assert.match(mainQuery.sql, /ORDER BY last_activity_at DESC/, 'сортировка по активности сохраняется')
})

test('listUsers: без таблицы site_visit_days SQL её не упоминает, lastVisitAt = null', async () => {
    const { controller, queries } = createQueryContext({
        visitsTracked: false,
        userRows: [createUserRow({ last_activity_at: CHAT_AT, last_visit_at: undefined })]
    })
    const res = createResponse()

    await controller.listUsers({ query: { sort: 'activity', order: 'desc' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.items[0].lastActivityAt, CHAT_AT)
    assert.equal(res.body.items[0].lastVisitAt, null)
    assert.ok(
        queries.every(query => !/site_visit_days/.test(query.sql)),
        'без таблицы визитов запросы её не трогают'
    )

    const mainQuery = queries.find(query => /LIMIT \$\d+/.test(query.sql))
    assert.match(
        mainQuery.sql,
        /GREATEST\(pl\.last_at, wl\.last_at, ch\.last_at\) AS last_activity_at/,
        'старое выражение активности остаётся рабочим'
    )
})

test('getUser: статистика содержит последний заход и согласованную активность', async () => {
    const { controller, queries } = createQueryContext({ visitsTracked: true })
    const res = createResponse()

    await controller.getUser({ params: { id: '3' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.stats.lastWateringAt, null)
    assert.equal(res.body.stats.lastChatAt, CHAT_AT)
    assert.equal(res.body.stats.lastVisitAt, VISIT_AT)
    assert.equal(res.body.stats.lastActivityAt, VISIT_AT)

    const statsQuery = queries.find(query => /AS last_watering_at/.test(query.sql))
    assert.ok(statsQuery, 'статистика пользователя запрошена')
    assert.match(statsQuery.sql, /site_visit_days/, 'статистика читает последний заход')
    assert.match(statsQuery.sql, /AS last_visit_at/, 'response знает последний заход')
    assert.match(statsQuery.sql, /GREATEST\(/, 'активность карточки считается как в списке')
})

test('getUser: без таблицы site_visit_days отдаёт lastVisitAt = null и не падает', async () => {
    const { controller, queries } = createQueryContext({
        visitsTracked: false,
        statsRow: createStatsRow({ last_visit_at: undefined, last_activity_at: CHAT_AT })
    })
    const res = createResponse()

    await controller.getUser({ params: { id: '3' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.stats.lastVisitAt, null)
    assert.equal(res.body.stats.lastActivityAt, CHAT_AT)

    const statsQuery = queries.find(query => /AS last_watering_at/.test(query.sql))
    assert.ok(statsQuery, 'статистика пользователя запрошена')
    assert.doesNotMatch(statsQuery.sql, /site_visit_days/, 'без таблицы визитов SQL её не трогает')
    assert.match(statsQuery.sql, /NULL::timestamptz AS last_visit_at/, 'заглушка вместо отсутствующей таблицы')
})
