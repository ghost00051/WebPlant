import test from 'node:test'
import assert from 'node:assert/strict'

import {
    NotificationPreferenceController,
    serializeNotificationPreferences
} from './notificationPreferenceController.js'

function createResponse() {
    return {
        statusCode: 200,
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

function createPreference(overrides = {}) {
    const preference = {
        user_id: 1,
        morning_summary_enabled: false,
        care_advice_enabled: true,
        weekly_recap_enabled: true,
        dark_theme_enabled: false,
        theme_mode: 'system',
        delivery_mode: 'digest',
        quiet_hours_enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
        updates: [],
        async update(values) {
            this.updates.push(values)
            Object.assign(this, values)
        },
        ...overrides
    }
    return preference
}

function createController({ preference = null, findOrCreate } = {}) {
    const state = { findOrCreateCalls: 0, findOneCalls: 0 }

    const models = {
        NotificationPreference: {
            async findOne() {
                state.findOneCalls += 1
                return preference
            },
            async findOrCreate(options) {
                state.findOrCreateCalls += 1
                const created = preference ?? createPreference({ ...options.defaults })
                return [created, preference === null]
            }
        }
    }

    if (typeof findOrCreate === 'function') {
        models.NotificationPreference.findOrCreate = findOrCreate
    }

    return {
        controller: new NotificationPreferenceController({ models }),
        state
    }
}

test('serializeNotificationPreferences: дефолты для пользователя без строки prefs', () => {
    assert.deepEqual(serializeNotificationPreferences(null, { timeZone: 'Europe/Moscow' }), {
        morning_summary_enabled: false,
        care_advice_enabled: true,
        weekly_recap_enabled: true,
        dark_theme_enabled: false,
        theme_mode: 'system',
        delivery_mode: 'digest',
        quiet_hours_enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
        quiet_hours_timezone: 'Europe/Moscow'
    })
})

test('serializeNotificationPreferences: нормализует старые/битые значения', () => {
    const payload = serializeNotificationPreferences({
        morning_summary_enabled: true,
        care_advice_enabled: false,
        dark_theme_enabled: true,
        theme_mode: 'dark',
        delivery_mode: 'per_plant',
        quiet_hours_enabled: true,
        quiet_hours_start: '23:30',
        quiet_hours_end: '07:15'
    }, { timeZone: 'Asia/Tokyo' })

    assert.equal(payload.delivery_mode, 'per_plant')
    assert.equal(payload.quiet_hours_enabled, true)
    assert.equal(payload.quiet_hours_start, '23:30')
    assert.equal(payload.quiet_hours_end, '07:15')
    assert.equal(payload.quiet_hours_timezone, 'Asia/Tokyo')

    const broken = serializeNotificationPreferences({
        delivery_mode: 'hourly',
        quiet_hours_start: '25:00',
        theme_mode: 'neon'
    }, { timeZone: 'мусор' })
    assert.equal(broken.delivery_mode, 'digest')
    assert.equal(broken.quiet_hours_start, '22:00')
    assert.equal(broken.theme_mode, 'system')
    assert.equal(broken.quiet_hours_timezone, 'Europe/Moscow')
})

test('GET: 401 без пользователя, дефолты без строки, значения из БД', async () => {
    const unauthorized = createController()
    const unauthorizedRes = createResponse()
    await unauthorized.controller.get({ user: null }, unauthorizedRes)
    assert.equal(unauthorizedRes.statusCode, 401)
    assert.match(unauthorizedRes.body.message, /авторизован/i)

    const empty = createController()
    const emptyRes = createResponse()
    await empty.controller.get({ user: { id: 1, timezone: 'Europe/Moscow' } }, emptyRes)
    assert.equal(emptyRes.statusCode, 200)
    assert.equal(emptyRes.body.delivery_mode, 'digest')
    assert.equal(emptyRes.body.quiet_hours_enabled, false)
    assert.equal(emptyRes.body.quiet_hours_timezone, 'Europe/Moscow')

    const existing = createController({ preference: createPreference({ delivery_mode: 'per_plant' }) })
    const existingRes = createResponse()
    await existing.controller.get({ user: { id: 1, timezone: 'Europe/Moscow' } }, existingRes)
    assert.equal(existingRes.body.delivery_mode, 'per_plant')
})

test('PATCH: валидация delivery_mode, quiet hours, read-only полей', async () => {
    const { controller } = createController({ preference: createPreference() })
    const cases = [
        [{ delivery_mode: 'hourly' }, /delivery_mode должен быть digest или per_plant/],
        [{ quiet_hours_start: '9:00' }, /quiet_hours_start должен быть временем в формате HH:MM/],
        [{ quiet_hours_end: '24:00' }, /quiet_hours_end должен быть временем в формате HH:MM/],
        [{ quiet_hours_timezone: 'UTC' }, /не изменяется/],
        [{ quiet_hours_enabled: 'yes' }, /quiet_hours_enabled должно быть логическим/],
        [{ morning_summary_enabled: 1 }, /morning_summary_enabled должно быть логическим/],
        [{}, /Необходимо передать настройку уведомлений/]
    ]

    for (const [body, pattern] of cases) {
        const res = createResponse()
        await controller.update({ user: { id: 1 }, body }, res)
        assert.equal(res.statusCode, 400, JSON.stringify(body))
        assert.match(res.body.message, pattern)
    }
})

test('PATCH: нельзя сделать начало и конец тихих часов одинаковыми', async () => {
    const { controller } = createController({
        preference: createPreference({ quiet_hours_start: '22:00', quiet_hours_end: '08:00' })
    })
    const res = createResponse()
    await controller.update({
        user: { id: 1 },
        body: { quiet_hours_start: '08:00' }
    }, res)

    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, /не должны совпадать/)
})

test('PATCH: сохраняет режим, тихие часы и возвращает полный объект', async () => {
    const preference = createPreference()
    const { controller } = createController({ preference })
    const res = createResponse()

    await controller.update({
        user: { id: 1, timezone: 'Asia/Tokyo' },
        body: {
            delivery_mode: 'per_plant',
            quiet_hours_enabled: true,
            quiet_hours_start: '23:00',
            quiet_hours_end: '07:00'
        }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(preference.updates.length, 1)
    assert.deepEqual(preference.updates[0], {
        delivery_mode: 'per_plant',
        quiet_hours_enabled: true,
        quiet_hours_start: '23:00',
        quiet_hours_end: '07:00'
    })
    assert.equal(res.body.delivery_mode, 'per_plant')
    assert.equal(res.body.quiet_hours_enabled, true)
    assert.equal(res.body.quiet_hours_start, '23:00')
    assert.equal(res.body.quiet_hours_end, '07:00')
    assert.equal(res.body.quiet_hours_timezone, 'Asia/Tokyo')
    assert.equal(res.body.care_advice_enabled, true)
})

test('PATCH: старые ключи и theme_mode работают как раньше', async () => {
    const preference = createPreference()
    const { controller } = createController({ preference })

    const first = createResponse()
    await controller.update({
        user: { id: 1 },
        body: { morning_summary_enabled: true, care_advice_enabled: false }
    }, first)
    assert.equal(first.statusCode, 200)
    assert.equal(first.body.morning_summary_enabled, true)
    assert.equal(first.body.care_advice_enabled, false)

    const second = createResponse()
    await controller.update({ user: { id: 1 }, body: { theme_mode: 'dark' } }, second)
    assert.equal(second.body.theme_mode, 'dark')
    assert.equal(second.body.dark_theme_enabled, true)
})

test('PATCH: 500 при ошибке БД с русским сообщением', async () => {
    const { controller } = createController({
        findOrCreate: async () => {
            throw new Error('db down')
        }
    })
    const res = createResponse()
    await controller.update({
        user: { id: 1 },
        body: { delivery_mode: 'digest' }
    }, res)

    assert.equal(res.statusCode, 500)
    assert.match(res.body.message, /Ошибка сервера/)
})
