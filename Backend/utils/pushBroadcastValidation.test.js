import assert from 'node:assert/strict'
import test from 'node:test'
import {
    MAX_BODY_LENGTH,
    MAX_TITLE_LENGTH,
    isValidBroadcastId,
    resolveScheduledStatus,
    validateBroadcastInput
} from './pushBroadcastValidation.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function validPayload(overrides = {}) {
    return {
        title: 'Заголовок',
        body: 'Текст рассылки',
        ...overrides
    }
}

test('accepts a minimal payload and applies defaults', () => {
    const result = validateBroadcastInput(validPayload())

    assert.equal(result.ok, true)
    assert.deepEqual(result.value, {
        title: 'Заголовок',
        body: 'Текст рассылки',
        url: '/',
        icon: null,
        targetMode: 'all',
        userIds: [],
        includeGuests: false,
        scheduledFor: null
    })
})

test('trims title and body', () => {
    const result = validateBroadcastInput(validPayload({
        title: '  Заголовок  ',
        body: '  Текст  '
    }))

    assert.equal(result.ok, true)
    assert.equal(result.value.title, 'Заголовок')
    assert.equal(result.value.body, 'Текст')
})

test('title boundaries are enforced', () => {
    const tooLong = validateBroadcastInput(validPayload({
        title: 'a'.repeat(MAX_TITLE_LENGTH + 1)
    }))
    assert.deepEqual(tooLong, { ok: false, message: 'Укажите заголовок до 120 символов' })

    const exact = validateBroadcastInput(validPayload({
        title: 'a'.repeat(MAX_TITLE_LENGTH)
    }))
    assert.equal(exact.ok, true)
    assert.equal(exact.value.title.length, MAX_TITLE_LENGTH)
})

test('title rejects missing and whitespace-only values', () => {
    for (const title of [undefined, null, '', '   ', 42]) {
        const result = validateBroadcastInput(validPayload({ title }))
        assert.deepEqual(result, { ok: false, message: 'Укажите заголовок до 120 символов' })
    }
})

test('body boundaries are enforced', () => {
    const tooLong = validateBroadcastInput(validPayload({
        body: 'b'.repeat(MAX_BODY_LENGTH + 1)
    }))
    assert.deepEqual(tooLong, { ok: false, message: 'Укажите текст до 1000 символов' })

    const exact = validateBroadcastInput(validPayload({
        body: 'b'.repeat(MAX_BODY_LENGTH)
    }))
    assert.equal(exact.ok, true)
    assert.equal(exact.value.body.length, MAX_BODY_LENGTH)
})

test('body rejects missing and whitespace-only values', () => {
    for (const body of [undefined, null, '', '   ', {}]) {
        const result = validateBroadcastInput(validPayload({ body }))
        assert.deepEqual(result, { ok: false, message: 'Укажите текст до 1000 символов' })
    }
})

test('url accepts an internal path and rejects external or protocol-relative links', () => {
    assert.equal(validateBroadcastInput(validPayload({ url: '/home' })).value.url, '/home')
    assert.equal(validateBroadcastInput(validPayload({ url: '  /plants/7  ' })).value.url, '/plants/7')
    assert.equal(validateBroadcastInput(validPayload({ url: '' })).value.url, '/')
    assert.equal(validateBroadcastInput(validPayload({ url: null })).value.url, '/')

    const expected = { ok: false, message: 'Ссылка должна быть внутренним путём, например /home' }
    for (const url of ['http://evil', 'https://evil.example/x', '//evil', '/\\evil', '/a b', 'home', 42]) {
        assert.deepEqual(validateBroadcastInput(validPayload({ url })), expected)
    }
    assert.deepEqual(
        validateBroadcastInput(validPayload({ url: `/${'a'.repeat(2048)}` })).ok,
        false
    )
})

test('icon accepts internal paths and http(s) urls only', () => {
    assert.equal(validateBroadcastInput(validPayload({ icon: '/icons/icon-192.png' })).value.icon, '/icons/icon-192.png')
    assert.equal(validateBroadcastInput(validPayload({ icon: 'https://cdn.example.com/i.png' })).value.icon, 'https://cdn.example.com/i.png')
    assert.equal(validateBroadcastInput(validPayload({ icon: 'http://cdn.example.com/i.png' })).value.icon, 'http://cdn.example.com/i.png')
    assert.equal(validateBroadcastInput(validPayload({ icon: '' })).value.icon, null)

    const expected = { ok: false, message: 'Некорректная иконка' }
    for (const icon of ['icons/icon.png', 'ftp://cdn/i.png', 'javascript:alert(1)', 42]) {
        assert.deepEqual(validateBroadcastInput(validPayload({ icon })), expected)
    }
    assert.equal(
        validateBroadcastInput(validPayload({ icon: `/${'a'.repeat(2048)}` })).ok,
        false
    )
})

test('targetMode defaults to all and rejects unknown values', () => {
    assert.equal(validateBroadcastInput(validPayload()).value.targetMode, 'all')
    assert.equal(validateBroadcastInput(validPayload({ targetMode: 'all' })).value.targetMode, 'all')

    const expected = { ok: false, message: 'Некорректный режим получателей' }
    for (const targetMode of ['admins', 'ALL', '', 0, [], {}]) {
        assert.deepEqual(validateBroadcastInput(validPayload({ targetMode })), expected)
    }
})

test('userIds are required for users mode, deduplicated and normalized', () => {
    const result = validateBroadcastInput(validPayload({
        targetMode: 'users',
        userIds: ['1', 2, 2, '03', 4]
    }))

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.userIds, [1, 2, 3, 4])
    assert.equal(result.value.targetMode, 'users')
})

test('userIds rejects empty or malformed lists', () => {
    const expected = { ok: false, message: 'Выберите хотя бы одного получателя' }
    const invalid = [
        undefined,
        null,
        [],
        'not-an-array',
        42,
        ['abc'],
        [0],
        [-1],
        [1.5],
        [null],
        [{}],
        [true]
    ]

    for (const userIds of invalid) {
        assert.deepEqual(
            validateBroadcastInput(validPayload({ targetMode: 'users', userIds })),
            expected
        )
    }

    assert.deepEqual(
        validateBroadcastInput(validPayload({
            targetMode: 'users',
            userIds: Array.from({ length: 1001 }, (_, index) => index + 1)
        })),
        expected
    )
})

test('userIds are ignored for all mode', () => {
    const result = validateBroadcastInput(validPayload({
        targetMode: 'all',
        userIds: ['1', 2]
    }))

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.userIds, [])
})

test('includeGuests is rejected for users mode', () => {
    assert.deepEqual(
        validateBroadcastInput(validPayload({
            targetMode: 'users',
            userIds: [1],
            includeGuests: true
        })),
        { ok: false, message: 'Гостевые подписки доступны только при рассылке всем' }
    )
})

test('includeGuests is applied for all mode', () => {
    assert.equal(validateBroadcastInput(validPayload({ includeGuests: true })).value.includeGuests, true)
    assert.equal(validateBroadcastInput(validPayload({ includeGuests: 'yes' })).value.includeGuests, false)
    assert.equal(validateBroadcastInput(validPayload()).value.includeGuests, false)
})

test('scheduledFor accepts a future date and returns ISO', () => {
    const future = new Date(Date.now() + HOUR)
    const result = validateBroadcastInput(validPayload({ scheduledFor: future.toISOString() }))

    assert.equal(result.ok, true)
    assert.equal(result.value.scheduledFor, future.toISOString())

    const asDate = validateBroadcastInput(validPayload({ scheduledFor: future }))
    assert.equal(asDate.ok, true)
    assert.equal(asDate.value.scheduledFor, future.toISOString())
})

test('scheduledFor treats null and undefined as immediate', () => {
    assert.equal(validateBroadcastInput(validPayload({ scheduledFor: null })).value.scheduledFor, null)
    assert.equal(validateBroadcastInput(validPayload({ scheduledFor: undefined })).value.scheduledFor, null)
    assert.equal(validateBroadcastInput(validPayload({ scheduledFor: '' })).value.scheduledFor, null)
})

test('scheduledFor rejects past, too-soon, too-far and malformed values', () => {
    const expected = { ok: false, message: 'Время отправки должно быть в будущем' }
    const invalid = [
        new Date(Date.now() - HOUR).toISOString(),
        new Date(Date.now() + 1000).toISOString(),
        new Date(Date.now() + 400 * DAY).toISOString(),
        'not-a-date',
        12345,
        {},
        true
    ]

    for (const scheduledFor of invalid) {
        assert.deepEqual(validateBroadcastInput(validPayload({ scheduledFor })), expected)
    }

    assert.equal(
        validateBroadcastInput(validPayload({
            scheduledFor: new Date(Date.now() + 30 * DAY).toISOString()
        })).ok,
        true
    )
})

test('resolveScheduledStatus picks pending for future dates and sending otherwise', () => {
    const now = new Date('2026-10-09T10:00:00.000Z')

    assert.equal(resolveScheduledStatus(null, now), 'sending')
    assert.equal(resolveScheduledStatus(undefined, now), 'sending')
    assert.equal(resolveScheduledStatus('not-a-date', now), 'sending')
    assert.equal(resolveScheduledStatus(new Date(now.getTime() - HOUR), now), 'sending')
    assert.equal(resolveScheduledStatus(new Date(now.getTime() + HOUR).toISOString(), now), 'pending')
})

test('isValidBroadcastId accepts only positive safe integer strings', () => {
    for (const value of ['1', '12', '9007199254740991']) {
        assert.equal(isValidBroadcastId(value), true)
    }
    for (const value of ['', '0', '01', '-1', '1.5', '1e3', 'abc', ' 1', '9007199254740993', 12, null]) {
        assert.equal(isValidBroadcastId(value), false)
    }
})
