import test from 'node:test'
import assert from 'node:assert/strict'
import {
    getUploadedPlantPhotoPath,
    isValidEmail,
    isUploadedPlantPhotoUrl,
    isValidRegistrationPassword,
    isValidReminderWeekdays,
    isValidWateringInterval,
    normalizeEmail
} from './validation.js'
import { isAllowedOrigin, parseLocalDevOrigins } from './origins.js'

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
    assert.equal(isValidRegistrationPassword('1234567'), false)
    assert.equal(isValidRegistrationPassword('12345678'), true)
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

test('plant reminder weekdays must be unique numeric weekdays', () => {
    assert.equal(isValidReminderWeekdays([]), true)
    assert.equal(isValidReminderWeekdays([0, 1, 6]), true)
    assert.equal(isValidReminderWeekdays(['mon']), false)
    assert.equal(isValidReminderWeekdays([1, 1]), false)
    assert.equal(isValidReminderWeekdays([7]), false)
})

test('plant photos must point to uploaded files on the API origin', () => {
    const origin = { protocol: 'https:', host: 'server.example.com' }
    assert.equal(
        isUploadedPlantPhotoUrl(
            'https://server.example.com/uploads/plants/0123456789abcdef0123456789abcdef.jpg',
            origin
        ),
        true
    )
    assert.equal(
        isUploadedPlantPhotoUrl(
            '/uploads/plants/0123456789abcdef0123456789abcdef.jpeg',
            origin
        ),
        true
    )
    assert.equal(
        isUploadedPlantPhotoUrl(
            'https://server.example.com/uploads/plants/0123456789abcdef0123456789abcdef.jpeg',
            origin
        ),
        true
    )
    assert.equal(
        isUploadedPlantPhotoUrl('https://attacker.example/image.jpg', origin),
        false
    )
    assert.equal(
        isUploadedPlantPhotoUrl(
            'https://other-host.example/uploads/plants/0123456789abcdef0123456789abcdef.jpg',
            origin
        ),
        false
    )
    assert.equal(
        getUploadedPlantPhotoPath(
            'https://other-host.example/uploads/plants/0123456789abcdef0123456789abcdef.jpg'
        ),
        '/uploads/plants/0123456789abcdef0123456789abcdef.jpg'
    )
    assert.equal(getUploadedPlantPhotoPath('https://attacker.example/image.jpg'), null)
    assert.equal(
        isUploadedPlantPhotoUrl(
            'https://server.example.com/uploads/plants/0123456789abcdef0123456789abcdef.jpg?tracking=1',
            origin
        ),
        false
    )
})

test('production origin checks only allow the configured frontend', () => {
    assert.equal(isAllowedOrigin('https://app.example.com', {
        frontendUrl: 'https://app.example.com',
        nodeEnv: 'production'
    }), true)
    assert.equal(isAllowedOrigin('http://192.168.0.176:5173', {
        nodeEnv: 'production'
    }), false)
    assert.equal(isAllowedOrigin('https://frontdevivan.ru', {
        frontendUrl: 'https://app.example.com',
        nodeEnv: 'production'
    }), false)
    assert.equal(isAllowedOrigin('http://192.168.0.177:5173', {
        nodeEnv: 'production'
    }), false)
    assert.equal(isAllowedOrigin('http://localhost:5173', {
        nodeEnv: 'production'
    }), false)
    assert.equal(isAllowedOrigin('http://localhost:5173', {
        nodeEnv: 'development'
    }), true)
})

test('production origin checks allow multiple configured frontends', () => {
    const frontendUrl = 'https://checktheplants.ru,https://test.checktheplants.ru'

    assert.equal(isAllowedOrigin('https://checktheplants.ru', {
        frontendUrl,
        nodeEnv: 'production'
    }), true)
    assert.equal(isAllowedOrigin('https://test.checktheplants.ru', {
        frontendUrl,
        nodeEnv: 'production'
    }), true)
    assert.equal(isAllowedOrigin('https://other.checktheplants.ru', {
        frontendUrl,
        nodeEnv: 'production'
    }), false)
})

test('production origin checks allow only explicitly configured local dev origins', () => {
    const options = {
        frontendUrl: 'https://checktheplants.ru',
        localDevOrigins: 'http://192.168.0.176:5173,http://localhost:5173',
        nodeEnv: 'production'
    }

    assert.equal(isAllowedOrigin('http://192.168.0.176:5173', options), true)
    assert.equal(isAllowedOrigin('http://localhost:5173', options), true)
    assert.equal(isAllowedOrigin('http://192.168.0.177:5173', options), false)
    assert.equal(isAllowedOrigin('https://evil.example', options), false)
})

test('local dev origin configuration rejects non-local and non-HTTP origins', () => {
    assert.deepEqual(parseLocalDevOrigins('http://192.168.0.176:5173'), [
        'http://192.168.0.176:5173'
    ])
    assert.throws(() => parseLocalDevOrigins('http://evil.example:5173'), /LOCAL_DEV_ORIGINS/)
    assert.throws(() => parseLocalDevOrigins('https://localhost:5173'), /LOCAL_DEV_ORIGINS/)
    assert.throws(() => parseLocalDevOrigins('http://192.168.0.176'), /LOCAL_DEV_ORIGINS/)
})
