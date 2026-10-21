import test from 'node:test'
import assert from 'node:assert/strict'

import {
    UNSUBSCRIBE_ONE_CLICK_VALUE,
    UNSUBSCRIBE_PATH,
    UNSUBSCRIBE_TOKEN_LENGTH,
    buildListUnsubscribeHeaders,
    buildUnsubscribeUrl,
    createUnsubscribeToken,
    normalizeUnsubscribeUserId,
    verifyUnsubscribeToken
} from './marketingConsent.js'

const TEST_SECRET = 'marketing-consent-tests-secret-at-least-32-bytes'
const FRONTEND_URL = 'https://checktheplants.ru,https://www.checktheplants.ru'

process.env.SECRET_KEY = TEST_SECRET

test('normalizeUnsubscribeUserId: принимает модель, plain-объект, число и строку', () => {
    assert.equal(normalizeUnsubscribeUserId({ id: 42 }), 42)
    assert.equal(normalizeUnsubscribeUserId(42), 42)
    assert.equal(normalizeUnsubscribeUserId('42'), 42)
    assert.equal(normalizeUnsubscribeUserId(' 42 '), 42)
})

test('normalizeUnsubscribeUserId: отбраковывает мусор', () => {
    for (const value of [
        null,
        undefined,
        {},
        { id: null },
        { id: 0 },
        { id: -1 },
        { id: 1.5 },
        { id: '1; DROP TABLE users' },
        'abc',
        '',
        '0',
        '0012x',
        true,
        2_147_483_648
    ]) {
        assert.equal(normalizeUnsubscribeUserId(value), null, `должно быть null: ${String(value)}`)
    }
})

test('createUnsubscribeToken: детерминированный base64url-токен нужной длины', () => {
    const token = createUnsubscribeToken(42, { secret: TEST_SECRET })

    assert.equal(typeof token, 'string')
    assert.equal(token.length, UNSUBSCRIBE_TOKEN_LENGTH)
    assert.match(token, /^[A-Za-z0-9_-]+$/)
    assert.equal(createUnsubscribeToken(42, { secret: TEST_SECRET }), token)
})

test('createUnsubscribeToken: разным пользователям — разные токены', () => {
    const first = createUnsubscribeToken(1, { secret: TEST_SECRET })
    const second = createUnsubscribeToken(2, { secret: TEST_SECRET })

    assert.notEqual(first, second)
    assert.equal(verifyUnsubscribeToken(1, second, { secret: TEST_SECRET }), false)
    assert.equal(verifyUnsubscribeToken(2, first, { secret: TEST_SECRET }), false)
})

test('createUnsubscribeToken: без SECRET_KEY и с некорректным id бросает ошибку', () => {
    assert.throws(() => createUnsubscribeToken(42, { secret: '' }))
    assert.throws(() => createUnsubscribeToken(null, { secret: TEST_SECRET }))
    assert.throws(() => createUnsubscribeToken({ id: 'x' }, { secret: TEST_SECRET }))
})

test('verifyUnsubscribeToken: валидный токен подтверждается', () => {
    const token = createUnsubscribeToken(42, { secret: TEST_SECRET })

    assert.equal(verifyUnsubscribeToken(42, token, { secret: TEST_SECRET }), true)
    assert.equal(verifyUnsubscribeToken('42', token, { secret: TEST_SECRET }), true)
    assert.equal(verifyUnsubscribeToken({ id: 42 }, token, { secret: TEST_SECRET }), true)
})

test('verifyUnsubscribeToken: невалидный, подделанный и устаревший токен отклоняются', () => {
    const token = createUnsubscribeToken(42, { secret: TEST_SECRET })

    const replaced = token[10] === 'A' ? 'B' : 'A'
    const middle = `${token.slice(0, 10)}${replaced}${token.slice(11)}`
    assert.notEqual(middle, token)
    assert.equal(verifyUnsubscribeToken(42, middle, { secret: TEST_SECRET }), false)

    const last = token.at(-1) === 'A' ? 'B' : 'A'
    assert.equal(verifyUnsubscribeToken(42, `${token.slice(0, -1)}${last}`, { secret: TEST_SECRET }), false)

    assert.equal(verifyUnsubscribeToken(42, token.slice(0, -1), { secret: TEST_SECRET }), false)

    assert.equal(verifyUnsubscribeToken(43, token, { secret: TEST_SECRET }), false)

    const foreign = createUnsubscribeToken(42, { secret: 'another-secret-another-secret-32b' })
    assert.equal(verifyUnsubscribeToken(42, foreign, { secret: TEST_SECRET }), false)

    for (const value of ['', null, undefined, 123, {}, [], 'not-a-token']) {
        assert.equal(verifyUnsubscribeToken(42, value, { secret: TEST_SECRET }), false)
    }

    assert.equal(verifyUnsubscribeToken('abc', token, { secret: TEST_SECRET }), false)
})

test('buildUnsubscribeUrl: строит ссылку от первого origin FRONTEND_URL', () => {
    const url = buildUnsubscribeUrl(42, {
        frontendUrl: FRONTEND_URL,
        secret: TEST_SECRET
    })

    assert.ok(url.startsWith(`https://checktheplants.ru${UNSUBSCRIBE_PATH}?`), url)
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://checktheplants.ru')
    assert.equal(parsed.pathname, UNSUBSCRIBE_PATH)
    assert.equal(parsed.searchParams.get('uid'), '42')
    assert.equal(parsed.searchParams.get('token'), createUnsubscribeToken(42, { secret: TEST_SECRET }))
})

test('buildUnsubscribeUrl: срезает хвостовой слэш и берёт SECRET_KEY из окружения', () => {
    const url = buildUnsubscribeUrl({ id: 7 }, { frontendUrl: 'https://checktheplants.ru/' })

    assert.ok(url.startsWith(`https://checktheplants.ru${UNSUBSCRIBE_PATH}?uid=7&token=`), url)
    assert.equal(new URL(url).searchParams.get('token'), createUnsubscribeToken(7))
})

test('buildUnsubscribeUrl: без FRONTEND_URL и с плохим id бросает ошибку', () => {
    assert.throws(() => buildUnsubscribeUrl(42, { frontendUrl: '' }), /FRONTEND_URL/)
    assert.throws(() => buildUnsubscribeUrl(42, { frontendUrl: '   ' }), /FRONTEND_URL/)
    assert.throws(() => buildUnsubscribeUrl(null, { frontendUrl: FRONTEND_URL }), /invalid user id/)
})

test('buildUnsubscribeUrl: аварийный baseUrl (UNSUBSCRIBE_URL_BASE) важнее FRONTEND_URL', () => {
    const url = buildUnsubscribeUrl(42, {
        frontendUrl: FRONTEND_URL,
        secret: TEST_SECRET,
        baseUrl: 'https://server.checktheplants.ru/api/users/unsubscribe/'
    })

    assert.ok(
        url.startsWith('https://server.checktheplants.ru/api/users/unsubscribe?uid=42&token='),
        url
    )
})

test('buildListUnsubscribeHeaders: RFC 8058 one-click заголовки', () => {
    const headers = buildListUnsubscribeHeaders(42, {
        frontendUrl: FRONTEND_URL,
        secret: TEST_SECRET
    })
    const url = buildUnsubscribeUrl(42, { frontendUrl: FRONTEND_URL, secret: TEST_SECRET })

    assert.deepEqual(headers, {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': UNSUBSCRIBE_ONE_CLICK_VALUE
    })
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    assert.match(headers['List-Unsubscribe'], /^<https:\/\/checktheplants\.ru\/unsubscribe\?uid=42&token=[A-Za-z0-9_-]{32}>$/)
})
