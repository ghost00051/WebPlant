import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getPasskeyConfig,
    validateProductionPasskeyConfig
} from './passkeyConfig.js'

test('passkey config parses production RP and frontend origins', () => {
    assert.deepEqual(getPasskeyConfig({
        RP_ID: 'checktheplants.ru',
        FRONTEND_ORIGIN: 'https://checktheplants.ru, https://test.checktheplants.ru'
    }), {
        rpId: 'checktheplants.ru',
        frontendOrigins: [
            'https://checktheplants.ru',
            'https://test.checktheplants.ru'
        ]
    })
})

test('production passkey origins must be HTTPS origins covered by RP_ID', () => {
    assert.deepEqual(validateProductionPasskeyConfig({
        rpId: 'checktheplants.ru',
        frontendOrigin: 'https://checktheplants.ru,https://test.checktheplants.ru',
        frontendUrl: 'https://checktheplants.ru,https://test.checktheplants.ru'
    }), {
        rpId: 'checktheplants.ru',
        frontendOrigins: [
            'https://checktheplants.ru',
            'https://test.checktheplants.ru'
        ]
    })

    assert.throws(() => validateProductionPasskeyConfig({
        rpId: 'localhost',
        frontendOrigin: 'https://checktheplants.ru',
        frontendUrl: 'https://checktheplants.ru'
    }), /RP_ID/)
    assert.throws(() => validateProductionPasskeyConfig({
        rpId: 'checktheplants.ru',
        frontendOrigin: 'https://evil.example',
        frontendUrl: 'https://evil.example'
    }), /covered by RP_ID/)
    assert.throws(() => validateProductionPasskeyConfig({
        rpId: 'checktheplants.ru',
        frontendOrigin: 'http://checktheplants.ru',
        frontendUrl: 'http://checktheplants.ru'
    }), /HTTPS origins covered by RP_ID/)
})
