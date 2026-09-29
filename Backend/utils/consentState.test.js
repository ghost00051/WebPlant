import test from 'node:test'
import assert from 'node:assert/strict'
import { getConsentState } from './consentState.js'

test('only the latest accepted and non-revoked decision grants consent', () => {
    const now = new Date('2026-09-28T12:00:00Z')
    assert.deepEqual(getConsentState({
        is_accepted: true,
        is_revoked: false,
        expires_at: '2026-10-01T00:00:00Z'
    }, now), { hasConsent: true, isExpired: false })
    assert.deepEqual(getConsentState({
        is_accepted: false,
        is_revoked: false,
        expires_at: null
    }, now), { hasConsent: false, isExpired: false })
    assert.deepEqual(getConsentState({
        is_accepted: true,
        is_revoked: true,
        expires_at: null
    }, now), { hasConsent: false, isExpired: false })
    assert.deepEqual(getConsentState({
        is_accepted: true,
        is_revoked: false,
        expires_at: '2026-09-27T12:00:00Z'
    }, now), { hasConsent: false, isExpired: true })
})
