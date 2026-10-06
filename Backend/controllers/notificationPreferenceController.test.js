import assert from 'node:assert/strict'
import test from 'node:test'
import NotificationPreference from '../models/NotificationPreference.js'
import notificationPreferenceController from './notificationPreferenceController.js'

const originalFindOrCreate = NotificationPreference.findOrCreate
const originalFindOne = NotificationPreference.findOne

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

test.after(() => {
    NotificationPreference.findOrCreate = originalFindOrCreate
    NotificationPreference.findOne = originalFindOne
})

test('notification preference get returns defaults without creating a preference row', async () => {
    let query
    NotificationPreference.findOne = async options => {
        query = options
        return null
    }
    const res = createResponse()

    await notificationPreferenceController.get({ user: { id: 42 } }, res)

    assert.deepEqual(query, { where: { user_id: 42 } })
    assert.deepEqual(res.body, {
        morning_summary_enabled: false,
        dark_theme_enabled: false,
        theme_mode: 'system'
    })
})

test('notification preference update requires a boolean value', async () => {
    const res = createResponse()

    await notificationPreferenceController.update({
        user: { id: 42 },
        body: { morning_summary_enabled: 'true' }
    }, res)

    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, /логическим значением/)
})

test('notification preference update stores the authenticated user setting', async () => {
    let query
    const preference = {
        morning_summary_enabled: false,
        dark_theme_enabled: false,
        theme_mode: 'system',
        async update(values) {
            Object.assign(this, values)
        }
    }
    NotificationPreference.findOrCreate = async options => {
        query = options
        return [preference, false]
    }
    const res = createResponse()

    await notificationPreferenceController.update({
        user: { id: 42 },
        body: { morning_summary_enabled: true }
    }, res)

    assert.deepEqual(query, {
        where: { user_id: 42 },
        defaults: { morning_summary_enabled: true }
    })
    assert.equal(preference.morning_summary_enabled, true)
    assert.deepEqual(res.body, {
        morning_summary_enabled: true,
        dark_theme_enabled: false,
        theme_mode: 'system'
    })
})

test('notification preference update preserves other settings', async () => {
    const preference = {
        morning_summary_enabled: true,
        dark_theme_enabled: false,
        theme_mode: 'light',
        async update(values) {
            Object.assign(this, values)
        }
    }
    NotificationPreference.findOrCreate = async () => [preference, false]
    const res = createResponse()

    await notificationPreferenceController.update({
        user: { id: 42 },
        body: { dark_theme_enabled: true }
    }, res)

    assert.equal(preference.morning_summary_enabled, true)
    assert.equal(preference.dark_theme_enabled, true)
    assert.deepEqual(res.body, {
        morning_summary_enabled: true,
        dark_theme_enabled: true,
        theme_mode: 'dark'
    })
})

test('notification preferences accept system theme and sync the legacy dark flag', async () => {
    const preference = {
        morning_summary_enabled: false,
        dark_theme_enabled: true,
        theme_mode: 'dark',
        async update(values) {
            Object.assign(this, values)
        }
    }
    NotificationPreference.findOrCreate = async () => [preference, false]
    const res = createResponse()

    await notificationPreferenceController.update({
        user: { id: 42 },
        body: { theme_mode: 'system' }
    }, res)

    assert.equal(preference.theme_mode, 'system')
    assert.equal(preference.dark_theme_enabled, false)
    assert.equal(res.body.theme_mode, 'system')
})

test('notification preferences reject unsupported theme modes', async () => {
    const res = createResponse()

    await notificationPreferenceController.update({
        user: { id: 42 },
        body: { theme_mode: 'automatic' }
    }, res)

    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, /system, light или dark/)
})
