import test from 'node:test'
import assert from 'node:assert/strict'
import {
    isValidEmail,
    isValidRegistrationPassword,
    isValidWateringInterval,
    normalizeEmail
} from './validation.js'
import { isAllowedOrigin } from './origins.js'

test('email normalization trims whitespace and ignores case', () => {
    assert.equal(normalizeEmail('  Plant.Owner@Example.COM '), 'plant.owner@example.com')
})

test('email validation rejects malformed and overlong addresses', () => {
    assert.equal(isValidEmail('plant@example.com'), true)
    assert.equal(isValidEmail('not-an-email'), false)
    assert.equal(isValidEmail(`${'a'.repeat(250)}@b.co`), false)
})

test('registration passwords do not exceed bcrypt byte limit', () => {
    assert.equal(isValidRegistrationPassword('пароль123'), true)
    assert.equal(isValidRegistrationPassword('a'.repeat(72)), true)
    assert.equal(isValidRegistrationPassword('a'.repeat(73)), false)
})

test('watering intervals must be whole days between one and one year', () => {
    assert.equal(isValidWateringInterval(1), true)
    assert.equal(isValidWateringInterval(365), true)
    assert.equal(isValidWateringInterval(0), false)
    assert.equal(isValidWateringInterval(1.5), false)
    assert.equal(isValidWateringInterval(366), false)
})

test('production origin checks only allow the configured frontend', () => {
    assert.equal(isAllowedOrigin('https://app.example.com', {
        frontendUrl: 'https://app.example.com',
        nodeEnv: 'production'
    }), true)
    assert.equal(isAllowedOrigin('https://frontdevivan.ru', {
        frontendUrl: 'https://app.example.com',
        nodeEnv: 'production'
    }), false)
    assert.equal(isAllowedOrigin('http://localhost:5173', {
        nodeEnv: 'development'
    }), true)
})
