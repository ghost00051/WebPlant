import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_LINK_MODELS,
    GUEST_LINK_SOURCES,
    describeGuestLinkSummary,
    linkGuestDataToUser
} from './linkGuestData.js'

const GUEST = 'guest_0123456789abcdef0123456789abcdef_1700000000000_abcdef0123456789abcdef0123456789'

function createModels(overrides = {}) {
    const calls = []

    const models = {
        UserCookieConsent: {
            async update(values, options) {
                calls.push({ model: 'UserCookieConsent', values, options })
                if (overrides.consentUpdate) return overrides.consentUpdate(values, options)
                return [2]
            }
        },
        ChatLog: {
            async count(options) {
                calls.push({ model: 'ChatLog.count', options })
                if (options.distinct) {
                    if (overrides.sessionCount) return overrides.sessionCount(options)
                    return 3
                }
                if (overrides.diagnosisCount) return overrides.diagnosisCount(options)
                return 1
            },
            async update(values, options) {
                calls.push({ model: 'ChatLog.update', values, options })
                if (overrides.chatUpdate) return overrides.chatUpdate(values, options)
                return [7]
            }
        }
    }

    return { models, calls }
}

test('linkGuestDataToUser: пропускает пустые аргументы и не трогает модели', async () => {
    const { models, calls } = createModels()

    const noToken = await linkGuestDataToUser(5, '', 'registration_linked', null, { models })
    assert.equal(noToken.skipped, true)
    assert.equal(noToken.consentCount, 0)
    assert.equal(noToken.chatMessageCount, 0)
    assert.deepEqual(noToken.errors, [])

    const badUser = await linkGuestDataToUser(0, GUEST, 'registration_linked', null, { models })
    assert.equal(badUser.skipped, true)

    const badToken = await linkGuestDataToUser(5, 'x'.repeat(300), 'registration_linked', null, { models })
    assert.equal(badToken.skipped, true)

    assert.equal(calls.length, 0, 'без валидных входных данных запросов к БД быть не должно')
})

test('linkGuestDataToUser: переносит согласия, сессии, диагнозы и сообщения', async () => {
    const { models, calls } = createModels()

    const result = await linkGuestDataToUser(42, ` ${GUEST} `, 'login_linked', null, { models })

    assert.equal(result.skipped, false)
    assert.equal(result.consentCount, 2)
    assert.equal(result.chatSessionCount, 3)
    assert.equal(result.diagnosisCount, 1)
    assert.equal(result.chatMessageCount, 7)
    assert.equal(result.linked, true)
    assert.deepEqual(result.errors, [])

    const consentCall = calls.find(call => call.model === 'UserCookieConsent')
    assert.deepEqual(consentCall.values, { user_id: 42, source: 'login_linked' })
    assert.deepEqual(consentCall.options.where, { guest_token: GUEST, user_id: null })

    const sessionCall = calls.find(call => call.model === 'ChatLog.count' && call.options.distinct)
    assert.equal(sessionCall.options.col, 'session_id')
    assert.deepEqual(sessionCall.options.where, {
        user_id: null,
        'metadata.guestToken': GUEST
    })

    const chatCall = calls.find(call => call.model === 'ChatLog.update')
    assert.deepEqual(chatCall.values, { user_id: 42 })
    assert.deepEqual(chatCall.options.where, {
        user_id: null,
        'metadata.guestToken': GUEST
    })
})

test('linkGuestDataToUser: неизвестный source нормализуется, transaction прокидывается', async () => {
    const { models, calls } = createModels()
    const transaction = { id: 'tx-1' }

    await linkGuestDataToUser(1, GUEST, 'weird_source', transaction, { models })

    for (const call of calls) {
        assert.equal(call.options.transaction, transaction)
    }
    const consentCall = calls.find(call => call.model === 'UserCookieConsent')
    assert.equal(consentCall.values.source, 'registration_linked')
})

test('linkGuestDataToUser: ошибка шага не ломает остальные шаги и не выбрасывается', async () => {
    const { models, calls } = createModels({
        consentUpdate: () => {
            throw new Error('relation user_cookie_consents does not exist')
        }
    })

    const result = await linkGuestDataToUser(9, GUEST, 'registration_linked', null, { models })

    assert.equal(result.consentCount, 0)
    assert.equal(result.chatMessageCount, 7, 'чат всё равно связывается')
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].step, 'cookie_consents')
    assert.match(result.errors[0].message, /user_cookie_consents/)

    const chatCall = calls.find(call => call.model === 'ChatLog.update')
    assert.ok(chatCall, 'связывание чата должно выполниться после ошибки согласий')
})

test('linkGuestDataToUser: падение всех шагов возвращает нули и список ошибок', async () => {
    const { models } = createModels({
        consentUpdate: () => {
            throw new Error('db down')
        },
        sessionCount: () => {
            throw new Error('db down')
        },
        diagnosisCount: () => {
            throw new Error('db down')
        },
        chatUpdate: () => {
            throw new Error('db down')
        }
    })

    const result = await linkGuestDataToUser(9, GUEST, 'registration_linked', null, { models })

    assert.equal(result.linked, false)
    assert.equal(result.consentCount, 0)
    assert.equal(result.chatMessageCount, 0)
    assert.equal(result.errors.length, 4)
    assert.deepEqual(
        result.errors.map(error => error.step).sort(),
        ['chat_diagnoses', 'chat_messages', 'chat_sessions', 'cookie_consents']
    )
})

test('linkGuestDataToUser: формат ответа update ([count]) и число обрабатываются одинаково', async () => {
    const arrayModels = createModels()
    const arrayResult = await linkGuestDataToUser(3, GUEST, 'registration_linked', null, {
        models: arrayModels.models
    })
    assert.equal(arrayResult.consentCount, 2)

    const plainModels = createModels({
        consentUpdate: () => 4,
        chatUpdate: () => 5
    })
    const plainResult = await linkGuestDataToUser(3, GUEST, 'registration_linked', null, {
        models: plainModels.models
    })
    assert.equal(plainResult.consentCount, 4)
    assert.equal(plainResult.chatMessageCount, 5)
})

test('describeGuestLinkSummary: человекочитаемая сводка', () => {
    assert.equal(describeGuestLinkSummary({}), 'нечего переносить')
    assert.equal(
        describeGuestLinkSummary({
            consentCount: 2,
            chatMessageCount: 5,
            chatSessionCount: 1,
            diagnosisCount: 1
        }),
        'согласий: 2, сообщений: 5, чатов: 1, диагнозов: 1'
    )
    assert.equal(
        describeGuestLinkSummary({
            consentCount: 1,
            chatMessageCount: 0,
            chatSessionCount: 0
        }),
        'согласий: 1'
    )
})

test('контракт: источники и модели по умолчанию', () => {
    assert.deepEqual([...GUEST_LINK_SOURCES], ['registration_linked', 'login_linked'])
    assert.ok(DEFAULT_LINK_MODELS.ChatLog)
    assert.ok(DEFAULT_LINK_MODELS.UserCookieConsent)
})
