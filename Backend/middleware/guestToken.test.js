import assert from 'node:assert/strict'
import test from 'node:test'
import { generateGuestToken, getGuestToken } from './guestToken.js'

const GUEST_TOKEN_LIFETIME = 180 * 24 * 60 * 60 * 1000

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
    assert.match(guestToken, /^guest_[0-9a-f]{32}_\d{13}$/i)
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
})
