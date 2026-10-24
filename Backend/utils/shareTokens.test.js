import test from 'node:test'
import assert from 'node:assert/strict'

import {
    SHARE_TOKEN_BYTES,
    SHARE_TOKEN_MAX_LENGTH,
    SHARE_TOKEN_MIN_LENGTH,
    SHARE_TOKEN_PATTERN,
    generateShareToken,
    isValidShareToken,
    normalizeShareToken,
    parseShareToken
} from './shareTokens.js'

test('generateShareToken: base64url-строка эталонной длины', () => {
    const token = generateShareToken()
    assert.equal(typeof token, 'string')
    assert.match(token, SHARE_TOKEN_PATTERN)
    assert.equal(token.length, Math.ceil((SHARE_TOKEN_BYTES * 4) / 3))
    assert.ok(token.length >= SHARE_TOKEN_MIN_LENGTH)
    assert.ok(token.length <= SHARE_TOKEN_MAX_LENGTH)
})

test('generateShareToken: токены не повторяются', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateShareToken()))
    assert.equal(tokens.size, 100)
})

test('isValidShareToken: принимает токен из генератора и границы 16–64', () => {
    assert.equal(isValidShareToken(generateShareToken()), true)
    assert.equal(isValidShareToken('a'.repeat(SHARE_TOKEN_MIN_LENGTH)), true)
    assert.equal(isValidShareToken('a'.repeat(SHARE_TOKEN_MAX_LENGTH)), true)
    assert.equal(isValidShareToken('A-Z_a-z-0_9-'.padEnd(SHARE_TOKEN_MAX_LENGTH, 'x')), true)
})

test('isValidShareToken: отклоняет неверный формат', () => {
    assert.equal(isValidShareToken('a'.repeat(SHARE_TOKEN_MIN_LENGTH - 1)), false)
    assert.equal(isValidShareToken('a'.repeat(SHARE_TOKEN_MAX_LENGTH + 1)), false)
    assert.equal(isValidShareToken(''), false)
    assert.equal(isValidShareToken('   '), false)
    assert.equal(isValidShareToken('short'), false)
    assert.equal(isValidShareToken(`${'a'.repeat(15)}!`), false)
    assert.equal(isValidShareToken(`${'a'.repeat(15)} `), false)
    assert.equal(isValidShareToken(`${'a'.repeat(15)}+`), false)
    assert.equal(isValidShareToken(`${'a'.repeat(15)}/`), false)
    assert.equal(isValidShareToken('токен-из-кириллицы'), false)
    assert.equal(isValidShareToken(null), false)
    assert.equal(isValidShareToken(undefined), false)
    assert.equal(isValidShareToken(1234567890123456), false)
    assert.equal(isValidShareToken({}), false)
})

test('normalizeShareToken: тримминг и отказ от нестроковых значений', () => {
    const token = generateShareToken()
    assert.equal(normalizeShareToken(`  ${token}  `), token)
    assert.equal(normalizeShareToken(''), null)
    assert.equal(normalizeShareToken('   '), null)
    assert.equal(normalizeShareToken(null), null)
    assert.equal(normalizeShareToken(undefined), null)
    assert.equal(normalizeShareToken(42), null)
    assert.equal(normalizeShareToken(['token']), null)
})

test('parseShareToken: отсутствие и пустое значение — без атрибуции', () => {
    assert.deepEqual(parseShareToken(undefined), { ok: true, token: null })
    assert.deepEqual(parseShareToken(null), { ok: true, token: null })
    assert.deepEqual(parseShareToken(''), { ok: true, token: null })
    assert.deepEqual(parseShareToken('   '), { ok: true, token: null })
})

test('parseShareToken: валидный токен нормализуется', () => {
    const token = generateShareToken()
    assert.deepEqual(parseShareToken(token), { ok: true, token })
    assert.deepEqual(parseShareToken(` ${token} `), { ok: true, token })
})

test('parseShareToken: неверный формат — ok: false (контроллер вернёт 400)', () => {
    assert.deepEqual(parseShareToken('broken token'), { ok: false, token: null })
    assert.deepEqual(parseShareToken('a'.repeat(SHARE_TOKEN_MIN_LENGTH - 1)), { ok: false, token: null })
    assert.deepEqual(parseShareToken('a'.repeat(SHARE_TOKEN_MAX_LENGTH + 1)), { ok: false, token: null })
    assert.deepEqual(parseShareToken(42), { ok: false, token: null })
    assert.deepEqual(parseShareToken({ token: generateShareToken() }), { ok: false, token: null })
})
