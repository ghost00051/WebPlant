import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import Passkey from '../models/Passkey.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import User from '../models/userModels.js'

process.env.SECRET_KEY = 'passkey-controller-tests-secret'
const { default: passkeyController } = await import('./passkeyController.js')

const originalPasskeyFindAll = Passkey.findAll
const originalChallengeCreate = PasskeyChallenge.create
const originalChallengeDestroy = PasskeyChallenge.destroy
const originalUserFindByPk = User.findByPk
const originalUserFindOne = User.findOne
const savedChallenges = []
const user = {
    id: 28,
    email: 'plant@example.com',
    name: 'Plant owner',
    username: 'plant_owner'
}

Passkey.findAll = async () => []
PasskeyChallenge.destroy = async () => 0
PasskeyChallenge.create = async challenge => {
    savedChallenges.push(challenge)
    return challenge
}
User.findByPk = async id => (id === user.id ? user : null)
User.findOne = async () => user

test.after(() => {
    Passkey.findAll = originalPasskeyFindAll
    PasskeyChallenge.create = originalChallengeCreate
    PasskeyChallenge.destroy = originalChallengeDestroy
    User.findByPk = originalUserFindByPk
    User.findOne = originalUserFindOne
})

function createResponse() {
    return {
        statusCode: 200,
        body: null,
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

test('passkey start endpoints return the key required to finish the challenge', async () => {
    const token = jwt.sign({
        id: user.id,
        email: user.email,
        role: 'USER',
        tokenType: 'session'
    }, process.env.SECRET_KEY, { expiresIn: '1h' })
    const registrationResponse = createResponse()

    await passkeyController.startRegistration({
        cookies: { token },
        headers: {}
    }, registrationResponse)

    assert.equal(registrationResponse.statusCode, 200)
    assert.equal(typeof registrationResponse.body._key, 'string')
    assert.equal(savedChallenges.at(-1).key, registrationResponse.body._key)
    assert.equal(savedChallenges.at(-1).type, 'registration')

    const authenticationResponse = createResponse()
    await passkeyController.startAuthentication({
        body: { email: user.email }
    }, authenticationResponse)

    assert.equal(authenticationResponse.statusCode, 200)
    assert.equal(typeof authenticationResponse.body._key, 'string')
    assert.equal(savedChallenges.at(-1).key, authenticationResponse.body._key)
    assert.equal(savedChallenges.at(-1).type, 'authentication')
})
