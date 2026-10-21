import assert from 'node:assert/strict'
import test from 'node:test'
import {
    clearGuestTokenCookie,
    generateGuestToken,
    getGuestToken,
    getValidGuestToken,
    GUEST_TOKEN_LIFETIME_MS,
    LEGACY_GUEST_TOKEN_LIFETIME_MS,
    parseGuestToken,
    signGuestToken
} from './guestToken.js'

const GUEST_TOKEN_LIFETIME = GUEST_TOKEN_LIFETIME_MS

test('guest token persists for the cookie-consent retention period', () => {
    const guestToken = generateGuestToken()
    const cookies = []
    const req = { cookies: { guest_token: guestToken } }
    const res = {
        cookie(name, value, options) {
            cookies.push({ name, value, options })
        }
    }
    let nextCalled = false

    getGuestToken(req, res, () => {
        nextCalled = true
    })

    assert.equal(req.guestToken, guestToken)
    assert.equal(nextCalled, true)
    assert.equal(cookies.length, 0)
    assert.match(guestToken, /^guest_[0-9a-f]{32}_\d{13}_[0-9a-f]{32}$/i)
})

test('guest token generation sets an httpOnly cookie with the expected lifetime', () => {
    const cookies = []
    const req = { cookies: {} }
    const res = {
        cookie(name, value, options) {
            cookies.push({ name, value, options })
        }
    }

    getGuestToken(req, res, () => {})

    assert.equal(cookies.length, 1)
    assert.equal(cookies[0].name, 'guest_token')
    assert.equal(cookies[0].value, req.guestToken)
    assert.equal(cookies[0].options.maxAge, GUEST_TOKEN_LIFETIME)
    assert.equal(cookies[0].options.httpOnly, true)
    assert.equal(cookies[0].options.path, '/')
    assert.equal(cookies[0].options.sameSite, 'lax')
})

test('expired, future-dated, and malformed guest tokens are replaced', () => {
    const invalidTokens = [
        `guest_${'a'.repeat(32)}_${Date.now() - GUEST_TOKEN_LIFETIME}`,
        `guest_${'b'.repeat(32)}_${Date.now() + 60_000}`,
        'not-a-guest-token'
    ]

    for (const invalidToken of invalidTokens) {
        const cookies = []
        const req = { cookies: { guest_token: invalidToken } }
        const res = {
            cookie(name, value, options) {
                cookies.push({ name, value, options })
            }
        }

        getGuestToken(req, res, () => {})

        assert.notEqual(req.guestToken, invalidToken)
        assert.equal(cookies.length, 1)
        assert.equal(cookies[0].name, 'guest_token')
    }
})

test('only unexpired guest tokens can be linked during authentication', () => {
    const now = Date.now()
    const current = `guest_${'c'.repeat(32)}_${now - 1}`
    const expired = `guest_${'d'.repeat(32)}_${now - GUEST_TOKEN_LIFETIME}`
    const future = `guest_${'e'.repeat(32)}_${now + 1}`

    assert.equal(getValidGuestToken(current, now), current)
    assert.equal(getValidGuestToken(expired, now), null)
    assert.equal(getValidGuestToken(future, now), null)
})

test('guest token removal uses the same scope and security attributes as creation', () => {
    const clearedCookies = []
    clearGuestTokenCookie({
        clearCookie(name, options) {
            clearedCookies.push({ name, options })
        }
    })

    assert.deepEqual(clearedCookies, [{
        name: 'guest_token',
        options: {
            httpOnly: true,
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/'
        }
    }])
})

test('signed guest token is valid only with a matching HMAC', () => {
    const now = Date.now()
    const hex = 'a'.repeat(32)
    const signature = signGuestToken(hex, now)
    const token = `guest_${hex}_${now}_${signature}`

    assert.match(signature, /^[0-9a-f]{32}$/)
    assert.equal(getValidGuestToken(token, now), token)
    assert.deepEqual(parseGuestToken(token, now), {
        token,
        hex,
        timestamp: now,
        legacy: false
    })
})

test('guest token with an invalid signature or swapped payload is rejected', () => {
    const now = Date.now()
    const hex = 'b'.repeat(32)
    const signature = signGuestToken(hex, now)
    const tamperedSignature = `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`

    assert.equal(getValidGuestToken(`guest_${hex}_${now}_${tamperedSignature}`, now), null)
    assert.equal(getValidGuestToken(`guest_${hex}_${now - 1000}_${signature}`, now), null)
    const otherSignature = signGuestToken('c'.repeat(32), now)
    assert.equal(getValidGuestToken(`guest_${hex}_${now}_${otherSignature}`, now), null)
    assert.equal(getValidGuestToken(`guest_${hex}_${now}_${signature.slice(0, 31)}`, now), null)
})

test('legacy unsigned guest token is accepted for 30 days and marked legacy', () => {
    const now = Date.now()
    const legacyToken = `guest_${'d'.repeat(32)}_${now - 1000}`
    const parsed = parseGuestToken(legacyToken, now)

    assert.ok(parsed, 'старый неподписанный токен ещё принимается')
    assert.equal(parsed.legacy, true, 'старый токен помечен как legacy')
    assert.equal(getValidGuestToken(legacyToken, now), legacyToken, 'совместимость со старыми cookie')

    const expiredLegacy = `guest_${'e'.repeat(32)}_${now - LEGACY_GUEST_TOKEN_LIFETIME_MS}`
    assert.equal(parseGuestToken(expiredLegacy, now), null)
    assert.equal(getValidGuestToken(expiredLegacy, now), null)
})

test('expired signed guest token is rejected', () => {
    const now = Date.now()
    const hex = 'f'.repeat(32)
    const expiredTimestamp = now - GUEST_TOKEN_LIFETIME_MS
    const futureTimestamp = now + 60_000

    assert.equal(
        getValidGuestToken(`guest_${hex}_${expiredTimestamp}_${signGuestToken(hex, expiredTimestamp)}`, now),
        null
    )
    assert.equal(
        getValidGuestToken(`guest_${hex}_${futureTimestamp}_${signGuestToken(hex, futureTimestamp)}`, now),
        null
    )
})

test('legacy guest cookie is upgraded to a signed token', () => {
    const now = Date.now()
    const legacyToken = `guest_${'1'.repeat(32)}_${now - 1000}`
    const cookies = []
    const req = { cookies: { guest_token: legacyToken } }
    const res = {
        cookie(name, value, options) {
            cookies.push({ name, value, options })
        }
    }

    getGuestToken(req, res, () => {})

    assert.notEqual(req.guestToken, legacyToken)
    assert.equal(cookies.length, 1)
    assert.equal(cookies[0].name, 'guest_token')
    assert.equal(cookies[0].value, req.guestToken)
    assert.equal(cookies[0].options.maxAge, GUEST_TOKEN_LIFETIME)
    assert.match(req.guestToken, /^guest_[0-9a-f]{32}_\d{13}_[0-9a-f]{32}$/)
    assert.equal(getValidGuestToken(req.guestToken), req.guestToken)
    assert.equal(parseGuestToken(req.guestToken).legacy, false)
})
