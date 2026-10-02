import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import AuthSession from '../models/AuthSession.js'
import User from '../models/userModels.js'
import {
    refreshRememberedSession,
    requireAuth
} from './auth.js'

process.env.SECRET_KEY = 'auth-middleware-tests-secret'

const originalFindOne = AuthSession.findOne
const originalFindByPk = User.findByPk
const sessions = new Set()
const user = { id: 17, email: 'plant@example.com', role: 'USER' }

AuthSession.findOne = async ({ where }) => (
    sessions.has(where.token_hash) &&
    where.user_id === user.id &&
    where.token_type === 'refresh' &&
    where.revoked_at === null
        ? { id: 1 }
        : sessions.has(where.token_hash) &&
            where.user_id === user.id &&
            where.token_type === 'session' &&
            where.revoked_at === null
            ? { id: 1 }
            : null
)
User.findByPk = async id => (id === user.id ? user : null)

test.after(() => {
    AuthSession.findOne = originalFindOne
    User.findByPk = originalFindByPk
})

function createResponse() {
    const cookies = new Map()
    return {
        cookies,
        statusCode: null,
        body: null,
        cookie(name, value, options) {
            cookies.set(name, { value, options })
        },
        clearCookie() {},
        status(statusCode) {
            this.statusCode = statusCode
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

function trackToken(tokenId) {
    sessions.add(createHash('sha256').update(tokenId).digest('hex'))
}

test('requireAuth accepts only an active server-side session', async () => {
    const sessionId = randomUUID()
    trackToken(sessionId)
    const req = {
        cookies: {
            token: jwt.sign({
                id: user.id,
                tokenType: 'session',
                jti: sessionId
            }, process.env.SECRET_KEY, { expiresIn: '1h' })
        }
    }
    const res = createResponse()
    let nextCalled = false

    await requireAuth(req, res, () => {
        nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.user, user)
    assert.equal(res.statusCode, null)

    req.cookies.token = jwt.sign({
        id: user.id,
        tokenType: 'session',
        jti: randomUUID()
    }, process.env.SECRET_KEY, { expiresIn: '1h' })
    const rejectedResponse = createResponse()
    nextCalled = false
    await requireAuth(req, rejectedResponse, () => {
        nextCalled = true
    })

    assert.equal(rejectedResponse.statusCode, 401)
    assert.equal(nextCalled, false)
})

test('expired remembered access token refreshes only with an active refresh session', async () => {
    const sessionId = randomUUID()
    trackToken(sessionId)
    const req = {
        cookies: {
            token: jwt.sign({
                id: user.id,
                tokenType: 'access',
                sid: sessionId
            }, process.env.SECRET_KEY, { expiresIn: -1 }),
            refresh_token: jwt.sign({
                id: user.id,
                tokenType: 'refresh',
                jti: sessionId
            }, process.env.SECRET_KEY, { expiresIn: '30d' })
        }
    }
    const res = createResponse()
    let nextCalled = false

    await refreshRememberedSession(req, res, () => {
        nextCalled = true
    })

    const renewed = res.cookies.get('token')
    assert.equal(nextCalled, true)
    assert.equal(jwt.verify(renewed.value, process.env.SECRET_KEY).sid, sessionId)
})
