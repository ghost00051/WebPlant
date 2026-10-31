import test from 'node:test'
import assert from 'node:assert/strict'

import { linkGuestDataAfterAuth } from './userController.js'

const GUEST = 'guest_0123456789abcdef0123456789abcdef_1700000000000_abcdef0123456789abcdef0123456789'

const EMPTY_GUEST_LINK = {
    linked: false,
    chatMessages: 0,
    chatSessions: 0,
    diagnoses: 0,
    consents: 0
}

function createLinkModels(overrides = {}) {
    return {
        UserCookieConsent: {
            async update() {
                if (overrides.consentUpdate) return overrides.consentUpdate()
                return overrides.consentRows ?? [2]
            }
        },
        ChatLog: {
            async count(options) {
                if (options?.distinct) {
                    if (overrides.sessionCount) return overrides.sessionCount()
                    return overrides.sessionRows ?? 3
                }
                if (overrides.diagnosisCount) return overrides.diagnosisCount()
                return overrides.diagnosisRows ?? 1
            },
            async update() {
                if (overrides.chatUpdate) return overrides.chatUpdate()
                return overrides.chatRows ?? [7]
            }
        }
    }
}

test('linkGuestDataAfterAuth: без гостевой куки возвращает пустой guestLink', async () => {
    assert.deepEqual(
        await linkGuestDataAfterAuth(42, null, 'registration_linked', {
            models: createLinkModels()
        }),
        EMPTY_GUEST_LINK
    )
    assert.deepEqual(
        await linkGuestDataAfterAuth(42, '', 'login_linked', { models: createLinkModels() }),
        EMPTY_GUEST_LINK
    )
})

test('linkGuestDataAfterAuth: возвращает summary, из которого строится guestLink ответа', async () => {
    const summary = await linkGuestDataAfterAuth(42, GUEST, 'registration_linked', {
        models: createLinkModels()
    })

    assert.deepEqual(summary, {
        linked: true,
        chatMessages: 7,
        chatSessions: 3,
        diagnoses: 1,
        consents: 2
    })
    assert.equal(summary.linked, summary.chatMessages + summary.consents > 0)
})

test('linkGuestDataAfterAuth: только согласия перенеслись — linked=true, чатов 0', async () => {
    const summary = await linkGuestDataAfterAuth(42, GUEST, 'login_linked', {
        models: createLinkModels({ consentRows: [1], chatRows: [0], sessionRows: 0, diagnosisRows: 0 })
    })

    assert.deepEqual(summary, {
        linked: true,
        chatMessages: 0,
        chatSessions: 0,
        diagnoses: 0,
        consents: 1
    })
})

test('linkGuestDataAfterAuth: частичный сбой — в guestLink только реально перенесённое', async () => {
    const summary = await linkGuestDataAfterAuth(42, GUEST, 'login_linked', {
        models: createLinkModels({
            chatUpdate: () => {
                throw new Error('db down')
            }
        })
    })

    assert.deepEqual(summary, {
        linked: true,
        chatMessages: 0,
        chatSessions: 3,
        diagnoses: 1,
        consents: 2
    })
})

test('linkGuestDataAfterAuth: падение переноса не ломает auth — пустой summary', async () => {
    const explodingModels = {
        get ChatLog() {
            throw new Error('models are broken')
        }
    }

    assert.deepEqual(
        await linkGuestDataAfterAuth(42, GUEST, 'registration_linked', { models: explodingModels }),
        EMPTY_GUEST_LINK
    )
})
