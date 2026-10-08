import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import test from 'node:test'
import AuthSession from '../models/AuthSession.js'
import ChatLog from '../models/ChatLog.js'
import sequelize from '../db.js'
import User from '../models/userModels.js'
import UserCookieConsent from '../models/userCookieConsentModels.js'
import UserLegalConsent from '../models/userLegalConsentModels.js'

process.env.SECRET_KEY = 'user-controller-tests-secret'
const { default: userController } = await import('./userController.js')

const originalAuthSessionCreate = AuthSession.create
const originalChatLogUpdate = ChatLog.update
const originalTransaction = sequelize.transaction
const originalUserCreate = User.create
const originalUserFindOne = User.findOne
const originalCookieConsentUpdate = UserCookieConsent.update
const originalLegalConsentCreate = UserLegalConsent.create
const authSessions = []
const legalConsents = []
let createdUser
let nextUserId = 100

AuthSession.create = async values => {
    authSessions.push(values)
}
ChatLog.update = async () => [3]
sequelize.transaction = async callback => {
    const transaction = {
        finished: null,
        async commit() {
            this.finished = 'commit'
        },
        async rollback() {
            this.finished = 'rollback'
        }
    }
    if (!callback) return transaction
    try {
        const result = await callback(transaction)
        await transaction.commit()
        return result
    } catch (error) {
        await transaction.rollback()
        throw error
    }
}
User.create = async values => {
    createdUser = {
        id: nextUserId++,
        ...values,
        async update(updates) {
            Object.assign(this, updates)
        }
    }
    return createdUser
}
User.findOne = async () => null
UserCookieConsent.update = async () => [2]
UserLegalConsent.create = async consent => {
    legalConsents.push(consent)
}

test.after(() => {
    AuthSession.create = originalAuthSessionCreate
    ChatLog.update = originalChatLogUpdate
    sequelize.transaction = originalTransaction
    User.create = originalUserCreate
    User.findOne = originalUserFindOne
    UserCookieConsent.update = originalCookieConsentUpdate
    UserLegalConsent.create = originalLegalConsentCreate
})

function createResponse() {
    const cookies = new Map()
    const clearedCookies = []
    return {
        cookies,
        clearedCookies,
        statusCode: 200,
        body: null,
        cookie(name, value, options) {
            cookies.set(name, { value, options })
        },
        clearCookie(name, options) {
            clearedCookies.push({ name, options })
        },
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

test('registration creates a normalized account, records legal consent, and migrates guest data', async () => {
    const guestToken = `guest_${'a'.repeat(32)}_${Date.now()}`
    const req = {
        body: {
            email: '  Plant.Owner@Example.com ',
            password: 'securePassword123',
            name: '  Plant Owner  ',
            username: 'plant_owner',
            privacyPolicyAccepted: true,
            termsAccepted: true
        },
        cookies: { guest_token: guestToken },
        ip: '192.0.2.10',
        headers: { 'user-agent': 'test-browser' }
    }
    const res = createResponse()

    await userController.registration(req, res)

    assert.equal(res.statusCode, 201)
    assert.equal(createdUser.email, 'plant.owner@example.com')
    assert.equal(createdUser.name, 'Plant Owner')
    assert.equal(res.body.user.email, createdUser.email)
    assert.equal('password' in res.body.user, false)
    assert.equal(legalConsents.length >= 2, true)
    assert.equal(legalConsents.at(-2).document_version, '2.0')
    assert.equal(legalConsents.at(-1).document_version, '2.0')
    assert.equal(legalConsents.at(-2).guest_token, guestToken)
    assert.equal(legalConsents.at(-1).guest_token, guestToken)
    assert.equal(
        res.clearedCookies.some(cookie => cookie.name === 'guest_token'),
        true
    )
    assert.equal(authSessions.at(-1).user_id, createdUser.id)
    assert.equal(
        jwt.verify(
            res.cookies.get('token').value,
            process.env.SECRET_KEY
        ).tokenType,
        'session'
    )
})

test('password login honors remember-me and sets a refresh session', async () => {
    const passwordHash = await bcrypt.hash('securePassword123', 4)
    const loginUser = {
        id: 42,
        email: 'plant@example.com',
        name: 'Plant owner',
        username: 'plant_owner',
        phone: null,
        bio: null,
        role: 'USER',
        privilege_level: 'free',
        password: passwordHash
    }
    User.findOne = async () => loginUser
    const req = {
        body: {
            email: ' PLANT@EXAMPLE.COM ',
            password: 'securePassword123',
            rememberMe: true
        },
        cookies: { guest_token: `guest_${'b'.repeat(32)}_${Date.now()}` }
    }
    const res = createResponse()

    await userController.login(req, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.user.email, loginUser.email)
    assert.equal(jwt.verify(
        res.cookies.get('token').value,
        process.env.SECRET_KEY
    ).tokenType, 'access')
    assert.equal(jwt.verify(
        res.cookies.get('refresh_token').value,
        process.env.SECRET_KEY
    ).tokenType, 'refresh')
    assert.equal(res.cookies.get('refresh_token').options.maxAge, 30 * 24 * 60 * 60 * 1000)
    assert.equal(
        res.clearedCookies.some(cookie => cookie.name === 'guest_token'),
        true
    )
})

test('logout clears both authentication and guest identity cookies', async () => {
    const res = createResponse()

    await userController.logout({ cookies: {} }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(
        res.clearedCookies.some(cookie => cookie.name === 'guest_token'),
        true
    )
    assert.equal(res.body.message, 'Выход выполнен успешно')
})
