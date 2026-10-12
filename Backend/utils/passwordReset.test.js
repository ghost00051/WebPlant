import assert from 'node:assert/strict'
import test from 'node:test'
import {
    RESET_MAX_REQUESTS_PER_HOUR,
    RESET_PASSWORD_MIN_LENGTH,
    RESET_TOKEN_TTL_MINUTES,
    buildResetUrl,
    generateResetToken,
    getPrimaryFrontendUrl,
    hashResetToken,
    isResetRequestTooSoon,
    isResetTokenUsable,
    isValidResetPassword,
    isValidResetTokenFormat,
    maskEmail
} from './passwordReset.js'

test('generateResetToken выдаёт уникальные токены формата base64url', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateResetToken()))

    assert.equal(tokens.size, 50)
    for (const token of tokens) {
        assert.equal(token.length, 43)
        assert.ok(isValidResetTokenFormat(token), `токен ${token} не проходит проверку формата`)
    }
})

test('hashResetToken — стабильный sha-256 в hex, в базе нет самого токена', () => {
    const hash = hashResetToken('some-token')

    assert.match(hash, /^[a-f0-9]{64}$/)
    assert.equal(hash, hashResetToken('some-token'))
    assert.notEqual(hash, hashResetToken('some-token2'))
    assert.notEqual(hash, 'some-token')
})

test('isValidResetTokenFormat отсекает мусор и токены чужой длины', () => {
    assert.equal(isValidResetTokenFormat(generateResetToken()), true)
    assert.equal(isValidResetTokenFormat(''), false)
    assert.equal(isValidResetTokenFormat(null), false)
    assert.equal(isValidResetTokenFormat('a'.repeat(42)), false)
    assert.equal(isValidResetTokenFormat('a'.repeat(44)), false)
    assert.equal(isValidResetTokenFormat(`${'a'.repeat(42)}+`), false)
    assert.equal(isValidResetTokenFormat(`${'a'.repeat(42)} `), false)
})

test('buildResetUrl берёт первый FRONTEND_URL и подставляет токен', () => {
    const token = generateResetToken()

    assert.equal(
        buildResetUrl(token, 'https://checktheplants.ru, https://test.checktheplants.ru'),
        `https://checktheplants.ru/reset-password?token=${token}`
    )
    assert.equal(
        buildResetUrl(token, 'https://test.checktheplants.ru/'),
        `https://test.checktheplants.ru/reset-password?token=${token}`
    )
    assert.throws(() => buildResetUrl('broken-token', 'https://checktheplants.ru'), /Invalid reset token/)
    assert.throws(() => buildResetUrl(token, ''), /FRONTEND_URL/)
})

test('getPrimaryFrontendUrl: пустое значение и запятые не ломают разбор', () => {
    assert.equal(getPrimaryFrontendUrl(' , https://checktheplants.ru/ '), 'https://checktheplants.ru')
    assert.equal(getPrimaryFrontendUrl(''), '')
    assert.equal(getPrimaryFrontendUrl(undefined), '')
})

test('isResetTokenUsable: использованная и истёкшая ссылка не проходит', () => {
    const now = new Date('2026-10-12T12:00:00.000Z')
    const future = new Date('2026-10-12T12:30:00.000Z')
    const past = new Date('2026-10-12T11:59:59.000Z')

    assert.equal(isResetTokenUsable({ expires_at: future, used_at: null }, now), true)
    assert.equal(isResetTokenUsable({ expires_at: future, used_at: now }, now), false)
    assert.equal(isResetTokenUsable({ expires_at: past, used_at: null }, now), false)
    assert.equal(isResetTokenUsable({ expires_at: now, used_at: null }, now), false)
    assert.equal(isResetTokenUsable(null, now), false)
})

test('isResetRequestTooSoon: повторная ссылка не чаще чем раз в минуту', () => {
    const now = new Date('2026-10-12T12:00:00.000Z')

    assert.equal(isResetRequestTooSoon(new Date('2026-10-12T11:59:30.000Z'), now), true)
    assert.equal(isResetRequestTooSoon(new Date('2026-10-12T12:00:00.000Z'), now), true)
    assert.equal(isResetRequestTooSoon(new Date('2026-10-12T11:58:00.000Z'), now), false)
    assert.equal(isResetRequestTooSoon(null, now), false)
})

test('isValidResetPassword повторяет требования регистрации', () => {
    assert.equal(isValidResetPassword('12345678'), true)
    assert.equal(isValidResetPassword('1234567'), false)
    assert.equal(isValidResetPassword(''), false)
    assert.equal(isValidResetPassword(null), false)
    assert.equal(isValidResetPassword('a'.repeat(73)), false)
    assert.equal(isValidResetPassword('ё'.repeat(RESET_PASSWORD_MIN_LENGTH)), true)
    assert.equal(isValidResetPassword('ё'.repeat(37)), false)
})

test('maskEmail оставляет домен, но скрывает ящик', () => {
    assert.equal(maskEmail('anna.sokolova@mail.ru'), 'an***********@mail.ru')
    assert.equal(maskEmail('ab@mail.ru'), 'ab***@mail.ru')
    assert.equal(maskEmail('a@mail.ru'), 'a***@mail.ru')
    assert.equal(maskEmail('not-an-email'), '')
    assert.equal(maskEmail(undefined), '')
})

test('срок жизни ссылки и лимит писем соответствуют интерфейсу', () => {
    assert.equal(RESET_TOKEN_TTL_MINUTES, 30)
    assert.equal(RESET_PASSWORD_MIN_LENGTH, 8)
    assert.equal(RESET_MAX_REQUESTS_PER_HOUR, 3)
})
