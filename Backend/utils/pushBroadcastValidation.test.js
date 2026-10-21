import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_PUSH_PAYLOAD_BYTES,
    MAX_TITLE_LENGTH,
    MAX_BODY_LENGTH,
    measurePushPayloadBytes,
    resolveScheduledStatus,
    validateBroadcastInput,
    isValidBroadcastId
} from './pushBroadcastValidation.js'
import { normalizeIdempotencyKey } from './broadcastIdempotency.js'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * 60 * 1000

test('validateBroadcastInput: минимальная корректная рассылка', () => {
    const result = validateBroadcastInput({ title: 'Заголовок', body: 'Текст' })
    assert.equal(result.ok, true)
    assert.equal(result.value.targetMode, 'all')
    assert.equal(result.value.url, '/')
    assert.equal(result.value.includeGuests, false)
    assert.ok(result.value.payloadBytes > 0)
    assert.ok(result.value.payloadBytes <= MAX_PUSH_PAYLOAD_BYTES)
})

test('validateBroadcastInput: длина title/body и пустые значения', () => {
    assert.equal(validateBroadcastInput({ title: '', body: 'x' }).ok, false)
    assert.equal(validateBroadcastInput({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1), body: 'x' }).ok, false)
    assert.equal(validateBroadcastInput({ title: 'x', body: 'x'.repeat(MAX_BODY_LENGTH + 1) }).ok, false)
})

test('validateBroadcastInput: payload больше 3800 байт отклоняется (кириллица + длинный url)', () => {
    const payload = {
        title: 'я'.repeat(MAX_TITLE_LENGTH),
        body: 'я'.repeat(MAX_BODY_LENGTH),
        url: `/${'x'.repeat(2040)}`,
        targetMode: 'all'
    }
    const measured = measurePushPayloadBytes(payload)
    assert.ok(measured > MAX_PUSH_PAYLOAD_BYTES, `expected oversized payload, got ${measured} bytes`)
    const result = validateBroadcastInput(payload)
    assert.equal(result.ok, false)
    assert.match(result.message, /длинн|размер/i)
})

test('measurePushPayloadBytes: учитывает icon/badge/data.url и UTF-8', () => {
    const ascii = measurePushPayloadBytes({ title: 'a', body: 'b' })
    const cyrillic = measurePushPayloadBytes({ title: 'я', body: 'б' })
    assert.ok(cyrillic > ascii)
    const withLongIcon = measurePushPayloadBytes({
        title: 'a',
        body: 'b',
        icon: `/icons/${'i'.repeat(500)}.png`
    })
    assert.ok(withLongIcon > ascii)
})

test('validateBroadcastInput: url только внутренний путь', () => {
    for (const url of ['https://example.com', '//evil.example.com', 'javascript:alert(1)', '/a b', '/\n/x']) {
        assert.equal(validateBroadcastInput({ title: 'T', body: 'B', url }).ok, false, url)
    }
    for (const url of ['', '/home', '/plants/1']) {
        assert.equal(validateBroadcastInput({ title: 'T', body: 'B', url }).ok, true, url)
    }
})

test('validateBroadcastInput: includeGuests только для targetMode=all', () => {
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', targetMode: 'users', userIds: [1, 2], includeGuests: true
    }).ok, false)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', targetMode: 'all', includeGuests: true
    }).ok, true)
})

test('validateBroadcastInput: userIds нормализуются и ограничены', () => {
    const deduped = validateBroadcastInput({
        title: 'T', body: 'B', targetMode: 'users', userIds: [1, '2', 2, 1]
    })
    assert.equal(deduped.ok, true)
    assert.deepEqual(deduped.value.userIds, [1, 2])

    assert.equal(validateBroadcastInput({ title: 'T', body: 'B', targetMode: 'users', userIds: [] }).ok, false)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', targetMode: 'users',
        userIds: Array.from({ length: 1001 }, (_, index) => index + 1)
    }).ok, false)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', targetMode: 'users', userIds: [0]
    }).ok, false)
})

test('validateBroadcastInput: окно планирования 30с..365д', () => {
    const now = Date.now()
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', scheduledFor: new Date(now + 60 * MINUTE).toISOString()
    }).ok, true)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', scheduledFor: new Date(now + 10 * 1000).toISOString()
    }).ok, false)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', scheduledFor: new Date(now - MINUTE).toISOString()
    }).ok, false)
    assert.equal(validateBroadcastInput({
        title: 'T', body: 'B', scheduledFor: new Date(now + 366 * DAY).toISOString()
    }).ok, false)
})

test('resolveScheduledStatus / isValidBroadcastId', () => {
    assert.equal(resolveScheduledStatus(null), 'sending')
    assert.equal(resolveScheduledStatus(new Date(Date.now() + MINUTE)), 'pending')
    assert.equal(resolveScheduledStatus(new Date(Date.now() - MINUTE)), 'sending')
    assert.equal(isValidBroadcastId('1'), true)
    assert.equal(isValidBroadcastId('0'), false)
    assert.equal(isValidBroadcastId('01'), false)
    assert.equal(isValidBroadcastId('abc'), false)
    assert.equal(isValidBroadcastId(1), false)
})

test('normalizeIdempotencyKey: UUID и ограничения формата', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    assert.equal(normalizeIdempotencyKey(uuid), uuid)
    assert.equal(normalizeIdempotencyKey(`  ${uuid}  `), uuid)
    assert.equal(normalizeIdempotencyKey('short'), null)
    assert.equal(normalizeIdempotencyKey('has spaces here'), null)
    assert.equal(normalizeIdempotencyKey('x'.repeat(201)), null)
    assert.equal(normalizeIdempotencyKey(42), null)
    assert.equal(normalizeIdempotencyKey(undefined), null)
})
