import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import AuthSession from '../models/AuthSession.js'
import User from '../models/userModels.js'
import {
    ADMIN_ORIGIN_FORBIDDEN_MESSAGE,
    isAdminPanelOrigin,
    requireAdmin
} from './admin.js'

process.env.SECRET_KEY = 'admin-middleware-tests-secret'
process.env.ADMIN_PANEL_ORIGIN = 'https://admin.example.test,http://localhost:5599'

const ADMIN_ORIGIN = 'https://admin.example.test'
const FOREIGN_ORIGIN = 'https://evil.example.test'

const originalAuthSessionFindOne = AuthSession.findOne
const originalUserFindByPk = User.findByPk
const adminUser = { id: 5, email: 'admin@example.test', role: 'ADMIN' }
const regularUser = { id: 6, email: 'user@example.test', role: 'USER' }

AuthSession.findOne = async () => ({ id: 1 })
User.findByPk = async id => (
    id === adminUser.id ? adminUser : id === regularUser.id ? regularUser : null
)

test.after(() => {
    AuthSession.findOne = originalAuthSessionFindOne
    User.findByPk = originalUserFindByPk
})

function createRequest({
    origin,
    userId = adminUser.id,
    originalUrl = '/api/admin/analytics/overview'
} = {}) {
    const headers = {}
    if (origin !== undefined) headers.origin = origin
    return {
        cookies: {
            token: jwt.sign(
                { id: userId, tokenType: 'session', jti: randomUUID() },
                process.env.SECRET_KEY,
                { expiresIn: '1h' }
            )
        },
        headers,
        originalUrl,
        get(name) {
            return headers[String(name).toLowerCase()]
        }
    }
}

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

test('requireAdmin: чужой origin админ-API получает 403', async () => {
    const req = createRequest({ origin: FOREIGN_ORIGIN })
    const res = createResponse()
    let nextCalled = false

    await requireAdmin(req, res, () => {
        nextCalled = true
    })

    assert.equal(res.statusCode, 403)
    assert.equal(res.body.message, ADMIN_ORIGIN_FORBIDDEN_MESSAGE)
    assert.equal(nextCalled, false)
})

test('requireAdmin: свой origin из ADMIN_PANEL_ORIGIN проходит', async () => {
    for (const origin of [ADMIN_ORIGIN, 'http://localhost:5599']) {
        const req = createRequest({ origin })
        const res = createResponse()
        let nextCalled = false

        await requireAdmin(req, res, () => {
            nextCalled = true
        })

        assert.equal(res.statusCode, null, `origin ${origin} должен проходить`)
        assert.equal(nextCalled, true)
        assert.equal(req.user, adminUser)
    }
})

test('requireAdmin: без Origin (curl, внутренние вызовы) проходит', async () => {
    const req = createRequest()
    const res = createResponse()
    let nextCalled = false

    await requireAdmin(req, res, () => {
        nextCalled = true
    })

    assert.equal(res.statusCode, null)
    assert.equal(nextCalled, true)
})

test('requireAdmin: чужой origin не открывает админ-API даже для админа', async () => {
    const req = createRequest({ origin: `${FOREIGN_ORIGIN}/admin`, originalUrl: '/api/admin/users/5' })
    const res = createResponse()

    await requireAdmin(req, res, () => {
        throw new Error('next не должен вызываться')
    })

    assert.equal(res.statusCode, 403)
    assert.equal(res.body.message, ADMIN_ORIGIN_FORBIDDEN_MESSAGE)
})

test('requireAdmin: не-админ получает 403 независимо от origin', async () => {
    const req = createRequest({ origin: ADMIN_ORIGIN, userId: regularUser.id })
    const res = createResponse()

    await requireAdmin(req, res, () => {
        throw new Error('next не должен вызываться')
    })

    assert.equal(res.statusCode, 403)
    assert.equal(res.body.message, 'Доступ запрещён')
})

test('requireAdmin: проверка origin ограничена /api/admin/*', async () => {
    const req = createRequest({
        origin: 'https://checktheplants.ru',
        originalUrl: '/api/system/docker-stats'
    })
    const res = createResponse()
    let nextCalled = false

    await requireAdmin(req, res, () => {
        nextCalled = true
    })

    assert.equal(res.statusCode, null)
    assert.equal(nextCalled, true)
})

test('isAdminPanelOrigin: сравнивает canonical origin и поддерживает список', () => {
    assert.equal(isAdminPanelOrigin(ADMIN_ORIGIN), true)
    assert.equal(isAdminPanelOrigin('http://localhost:5599'), true)
    assert.equal(isAdminPanelOrigin('https://admin.example.test/'), true)
    assert.equal(isAdminPanelOrigin('http://admin.example.test'), false)
    assert.equal(isAdminPanelOrigin(FOREIGN_ORIGIN), false)
    assert.equal(isAdminPanelOrigin(''), false)
    assert.equal(isAdminPanelOrigin(undefined), false)
    assert.equal(isAdminPanelOrigin(ADMIN_ORIGIN, { adminPanelOrigins: '' }), false)
})
