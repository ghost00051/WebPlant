import test from 'node:test'
import assert from 'node:assert/strict'

import userController from './userController.js'

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        }
    }
}

test('getCurrentUser: отдаёт дату регистрации в createdAt для профиля и достижений', async () => {
    const createdAt = new Date('2026-09-10T12:00:00.000Z')
    const res = createResponse()

    await userController.getCurrentUser({
        user: {
            id: 3,
            email: 'ilya@example.com',
            name: 'Илья',
            username: 'ilya',
            phone: null,
            bio: null,
            role: 'USER',
            privilege_level: 'free',
            timezone: null,
            marketing_email_opt_in: false,
            created_at: createdAt
        }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.id, 3)
    assert.equal(res.body.privilege_level, 'free')
    assert.equal(new Date(res.body.createdAt).toISOString(), createdAt.toISOString())
})

test('getCurrentUser: без created_at отдаёт createdAt = null, а не падает', async () => {
    const res = createResponse()

    await userController.getCurrentUser({
        user: {
            id: 4,
            email: 'user@example.com',
            role: 'USER',
            privilege_level: 'free',
            timezone: null,
            marketing_email_opt_in: false
        }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.createdAt, null)
})

test('getCurrentUser: без пользователя отвечает 401', async () => {
    const res = createResponse()

    await userController.getCurrentUser({}, res)

    assert.equal(res.statusCode, 401)
})
