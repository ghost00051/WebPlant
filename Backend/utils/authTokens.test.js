import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import AuthSession from '../models/AuthSession.js'
import {
    clearAuthCookies,
    isAuthTokenActive,
    revokeAuthToken,
    setRememberedAuth,
    setSessionAuth
} from './authTokens.js'

process.env.SECRET_KEY = 'auth-token-tests-secret'

const originalCreate = AuthSession.create
const originalFindOne = AuthSession.findOne
const originalUpdate = AuthSession.update
const sessions = new Map()

AuthSession.create = async values => {
    sessions.set(values.token_hash, {
        id: sessions.size + 1,
        revoked_at: null,
        ...values
    })
}
AuthSession.findOne = async ({ where }) => {
    const session = sessions.get(where.token_hash)
    if (
        session &&
        session.user_id === where.user_id &&
        session.token_type === where.token_type &&
        session.revoked_at === where.revoked_at
    ) {
        return session
    }
    return null
}
AuthSession.update = async (values, { where }) => {
    const session = sessions.get(where.token_hash)
    if (
        session &&
        session.user_id === where.user_id &&
        session.token_type === where.token_type &&
        session.revoked_at === where.revoked_at
    ) {
        Object.assign(session, values)
        return [1]
    }
    return [0]
}

test.after(() => {
    AuthSession.create = originalCreate
    AuthSession.findOne = originalFindOne
    AuthSession.update = originalUpdate
})

function createResponseRecorder() {
    const cookies = new Map()
    const clearedCookies = []
    return {
        cookies,
        clearedCookies,
        cookie(name, value, options) {
            cookies.set(name, { value, options })
        },
        clearCookie(name, options) {
            clearedCookies.push({ name, options })
        }
    }
}

test('session auth records a revocable browser session', async () => {
    const response = createResponseRecorder()
    await setSessionAuth(response, { id: 1, email: 'user@example.com', role: 'USER' })

    const sessionCookie = response.cookies.get('token')
    const payload = jwt.verify(sessionCookie.value, process.env.SECRET_KEY)
    assert.equal(sessionCookie.options.maxAge, undefined)
    assert.equal(payload.tokenType, 'session')
    assert.equal(await isAuthTokenActive(payload), true)
    assert.equal(
        response.clearedCookies.some(cookie => cookie.name === 'refresh_token'),
        true
    )

    await revokeAuthToken(sessionCookie.value)
    assert.equal(await isAuthTokenActive(payload), false)
})

test('remembered auth ties access and refresh tokens to one revocable session', async () => {
    const response = createResponseRecorder()
    await setRememberedAuth(response, {
        id: 2,
        email: 'user@example.com',
        role: 'USER'
    })

    const accessCookie = response.cookies.get('token')
    const refreshCookie = response.cookies.get('refresh_token')
    const accessPayload = jwt.verify(accessCookie.value, process.env.SECRET_KEY)
    const refreshPayload = jwt.verify(refreshCookie.value, process.env.SECRET_KEY)

    assert.equal(accessCookie.options.maxAge, undefined)
    assert.equal(accessPayload.tokenType, 'access')
    assert.equal(refreshPayload.tokenType, 'refresh')
    assert.equal(accessPayload.sid, refreshPayload.jti)
    assert.equal(refreshCookie.options.maxAge, 30 * 24 * 60 * 60 * 1000)
    assert.equal(await isAuthTokenActive(accessPayload), true)
    assert.equal(await isAuthTokenActive(refreshPayload), true)

    await revokeAuthToken(refreshCookie.value)
    assert.equal(await isAuthTokenActive(accessPayload), false)
})

test('logout clears both authentication cookies', () => {
    const response = createResponseRecorder()
    clearAuthCookies(response)

    assert.deepEqual(
        response.clearedCookies.map(cookie => cookie.name).sort(),
        ['refresh_token', 'token']
    )
})
