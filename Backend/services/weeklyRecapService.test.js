import test from 'node:test'
import assert from 'node:assert/strict'

import { WeeklyRecapService, buildWeeklyRecapEmail, isWeeklyRecapDue, readWeeklyRecapConfig, shouldSendRecapEmail, weeklyRecapDedupeKey } from './weeklyRecapService.js'

const MSK = 'Europe/Moscow'
const SUNDAY_EVENING = new Date('2026-11-01T16:00:00Z')
const WEEK_START = '2026-10-26'

const BASE_ENV = {
    WEEKLY_RECAP_ENABLED: 'true',
    WEEKLY_RECAP_EMAIL_ENABLED: 'false',
    WEEKLY_RECAP_HOUR: '19',
    WEEKLY_RECAP_WEEKDAY: '7',
    FRONTEND_URL: 'https://example.test'
}

const wateringEvent = iso => ({ action: 'watered', action_at: iso, hours_late: 0 })

function createHarness({
    preferences = [{ user_id: 1 }],
    users = [{
        id: 1,
        timezone: MSK,
        email: 'user@example.test',
        marketing_email_opt_in: true
    }],
    eventsByUser = {
        1: [
            wateringEvent('2026-10-26T06:00:00Z'),
            wateringEvent('2026-10-28T06:00:00Z'),
            wateringEvent('2026-11-01T06:00:00Z')
        ]
    },
    photos = 2,
    careActions = 1,
    throwingUserIds = [],
    env = BASE_ENV,
    mailReady = true,
    storeResult = { notification: { id: 11 }, created: true }
} = {}) {
    const calls = {
        store: [],
        push: [],
        mail: [],
        updated: [],
        prefWhere: null,
        lockCalls: []
    }

    const prefInstances = preferences.map(pref => ({
        last_weekly_recap_date: null,
        ...pref,
        async update(values) {
            Object.assign(this, values)
            calls.updated.push(this.user_id)
        }
    }))

    const models = {
        NotificationPreference: {
            async findAll(options) {
                calls.prefWhere = options?.where ?? null
                return prefInstances
            }
        },
        User: {
            async findAll() {
                return users
            }
        },
        WateringLog: {
            async findAll({ where }) {
                if (throwingUserIds.includes(where.user_id)) throw new Error('БД недоступна')
                return eventsByUser[where.user_id] ?? []
            }
        },
        Plant: {
            async findAll() {
                return [{ id: 1 }]
            }
        },
        PlantPhoto: {
            async count() {
                return photos
            }
        },
        PlantCareLog: {
            async count() {
                return careActions
            }
        }
    }

    const notifications = {
        async storeNotification(payload) {
            calls.store.push(payload)
            return storeResult
        },
        async sendNotificationPush(payload) {
            calls.push.push(payload)
            return { sent: 1, failed: 0 }
        }
    }

    const mail = {
        isMailConfigured: () => mailReady,
        async sendMail(payload) {
            calls.mail.push(payload)
            return { accepted: [payload.to] }
        }
    }

    const service = new WeeklyRecapService({
        models,
        notifications,
        mail,
        env,
        withDistributedLock: async (name, options, task) => {
            calls.lockCalls.push({ name, options })
            return { ran: true, result: await task() }
        }
    })

    return { service, calls, preferences: prefInstances }
}

test('readWeeklyRecapConfig: значения по умолчанию и идемпотентный парсинг env', () => {
    assert.deepEqual(readWeeklyRecapConfig({}), {
        enabled: true,
        emailEnabled: false,
        hour: 19,
        weekday: 7
    })

    assert.deepEqual(readWeeklyRecapConfig({
        WEEKLY_RECAP_ENABLED: 'false',
        WEEKLY_RECAP_EMAIL_ENABLED: 'true',
        WEEKLY_RECAP_HOUR: '9',
        WEEKLY_RECAP_WEEKDAY: '1'
    }), {
        enabled: false,
        emailEnabled: true,
        hour: 9,
        weekday: 1
    })

    assert.deepEqual(readWeeklyRecapConfig({
        WEEKLY_RECAP_ENABLED: 'maybe',
        WEEKLY_RECAP_HOUR: '25',
        WEEKLY_RECAP_WEEKDAY: '0'
    }), {
        enabled: true,
        emailEnabled: false,
        hour: 19,
        weekday: 7
    })
})

test('isWeeklyRecapDue: локальные день недели и час пользователя', () => {
    const config = readWeeklyRecapConfig(BASE_ENV)

    assert.equal(isWeeklyRecapDue({ now: SUNDAY_EVENING, timeZone: MSK, config }), true)
    assert.equal(
        isWeeklyRecapDue({ now: new Date('2026-11-01T15:00:00Z'), timeZone: MSK, config }),
        false
    )
    assert.equal(
        isWeeklyRecapDue({ now: new Date('2026-10-26T16:00:00Z'), timeZone: MSK, config }),
        false
    )
    assert.equal(
        isWeeklyRecapDue({ now: SUNDAY_EVENING, timeZone: MSK, config: { ...config, enabled: false } }),
        false
    )

    const mondayMorning = readWeeklyRecapConfig({
        WEEKLY_RECAP_WEEKDAY: '1',
        WEEKLY_RECAP_HOUR: '9'
    })
    assert.equal(
        isWeeklyRecapDue({
            now: new Date('2026-10-26T06:00:00Z'),
            timeZone: MSK,
            config: mondayMorning
        }),
        true
    )
})

test('weeklyRecapDedupeKey: ключ по дате понедельника', () => {
    assert.equal(weeklyRecapDedupeKey(WEEK_START), 'weekly-recap:2026-10-26')
})

test('shouldSendRecapEmail: только при согласии, SMTP и включённой опции', () => {
    const env = { ...BASE_ENV, WEEKLY_RECAP_EMAIL_ENABLED: 'true' }
    const config = readWeeklyRecapConfig(env)
    const user = { email: 'user@example.test', marketing_email_opt_in: true }
    const mailReady = () => true

    assert.equal(shouldSendRecapEmail(user, config, { env, isMailReady: mailReady }), true)
    assert.equal(
        shouldSendRecapEmail({ ...user, marketing_email_opt_in: false }, config, { env, isMailReady: mailReady }),
        false
    )
    assert.equal(shouldSendRecapEmail(user, config, { env, isMailReady: () => false }), false)
    assert.equal(shouldSendRecapEmail(user, readWeeklyRecapConfig(BASE_ENV), { env, isMailReady: mailReady }), false)
    assert.equal(
        shouldSendRecapEmail({ email: '', marketing_email_opt_in: true }, config, { env, isMailReady: mailReady }),
        false
    )
})

test('buildWeeklyRecapEmail: письмо со ссылкой на профиль', () => {
    const message = buildWeeklyRecapEmail({
        recap: { title: '🌿 Итоги недели', body: '3 из 4 поливов, 2 фото, серия 5 🔥' },
        weekStartDate: WEEK_START,
        frontendUrl: 'https://example.test/'
    })

    assert.match(message.subject, /Итоги недели/)
    assert.match(message.text, /3 из 4 поливов/)
    assert.match(message.text, /https:\/\/example\.test\/profile/)
    assert.ok(!message.text.includes('//profile'))
    assert.match(message.html, /https:\/\/example\.test\/profile/)
    assert.match(message.html, /3 из 4 поливов/)

    const fallback = buildWeeklyRecapEmail({ recap: { body: 'текст' }, frontendUrl: '' })
    assert.match(fallback.text, /checktheplants\.ru\/profile/)
})

test('tick: создаёт recap, push, обновляет дату и не дублирует за неделю', async () => {
    const { service, calls, preferences } = createHarness()

    const first = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(first.skipped, false)
    assert.equal(first.recapsCreated, 1)
    assert.equal(first.pushesAttempted, 1)
    assert.equal(first.emailsSent, 0)
    assert.equal(first.errors, 0)

    assert.equal(calls.prefWhere.weekly_recap_enabled, true)
    assert.equal(calls.store.length, 1)
    const stored = calls.store[0]
    assert.equal(stored.userId, 1)
    assert.equal(stored.type, 'weekly_recap')
    assert.equal(stored.title, '🌿 Итоги недели')
    assert.equal(stored.url, '/home')
    assert.equal(stored.dedupeKey, `weekly-recap:${WEEK_START}`)
    assert.equal(stored.payload.stats.scheduled, 3)
    assert.equal(stored.payload.stats.photos, 2)
    assert.equal(stored.payload.stats.careActions, 1)
    assert.equal(stored.payload.streak.current, 3)
    assert.match(stored.body, /3 из 3 поливов/)
    assert.match(stored.body, /2 фото/)
    assert.match(stored.body, /серия 3 🔥/)

    assert.equal(calls.push.length, 1)
    assert.equal(calls.push[0].userId, 1)
    assert.equal(calls.push[0].data.tag, 'weekly_recap')
    assert.equal(calls.push[0].data.notificationId, 11)
    assert.equal(calls.push[0].data.url, '/home')

    assert.deepEqual(calls.updated, [1])
    assert.equal(preferences[0].last_weekly_recap_date, WEEK_START)

    calls.store.length = 0
    const second = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(second.recapsCreated, 0)
    assert.equal(second.usersSkipped, 1)
    assert.equal(calls.store.length, 0)
})

test('tick: пропускает пользователя без активности за неделю', async () => {
    const { service, calls } = createHarness({
        eventsByUser: {},
        photos: 0,
        careActions: 0
    })

    const result = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(result.recapsCreated, 0)
    assert.equal(result.usersSkipped, 1)
    assert.equal(calls.store.length, 0)
    assert.equal(calls.updated.length, 0)
})

test('tick: активность только в прошлых неделях не считается активностью за неделю', async () => {
    const { service, calls } = createHarness({
        eventsByUser: {
            1: [wateringEvent('2026-10-19T06:00:00Z')]
        },
        photos: 0,
        careActions: 0
    })

    const result = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(result.recapsCreated, 0)
    assert.equal(result.usersSkipped, 1)
    assert.equal(calls.store.length, 0)
})

test('tick: вне локального дня/часа ничего не отправляет', async () => {
    const { service, calls } = createHarness()

    const result = await service.runWeeklyRecapTick(new Date('2026-11-01T15:00:00Z'))
    assert.equal(result.recapsCreated, 0)
    assert.equal(result.usersSkipped, 1)
    assert.equal(calls.store.length, 0)
})

test('tick: при выключенном WEEKLY_RECAP_ENABLED не берёт лок и не трогает БД', async () => {
    const { service, calls } = createHarness({
        env: { ...BASE_ENV, WEEKLY_RECAP_ENABLED: 'false' }
    })

    const result = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.deepEqual(result, { skipped: true, reason: 'disabled' })
    assert.equal(calls.lockCalls.length, 0)
    assert.equal(calls.store.length, 0)
})

test('tick: письмо уходит только при WEEKLY_RECAP_EMAIL_ENABLED и согласии', async () => {
    const withEmail = createHarness({
        env: { ...BASE_ENV, WEEKLY_RECAP_EMAIL_ENABLED: 'true' }
    })
    const result = await withEmail.service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(result.emailsSent, 1)
    assert.equal(withEmail.calls.mail.length, 1)
    assert.equal(withEmail.calls.mail[0].to, 'user@example.test')
    assert.match(withEmail.calls.mail[0].html, /https:\/\/example\.test\/profile/)
    assert.match(withEmail.calls.mail[0].subject, /Итоги недели/)

    const withoutConsent = createHarness({
        env: { ...BASE_ENV, WEEKLY_RECAP_EMAIL_ENABLED: 'true' },
        users: [{
            id: 1,
            timezone: MSK,
            email: 'user@example.test',
            marketing_email_opt_in: false
        }]
    })
    const second = await withoutConsent.service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(second.emailsSent, 0)
    assert.equal(withoutConsent.calls.mail.length, 0)
})

test('tick: ошибка одного пользователя не валит остальных', async () => {
    const { service, calls } = createHarness({
        preferences: [{ user_id: 1 }, { user_id: 2 }],
        users: [
            { id: 1, timezone: MSK, email: 'one@example.test', marketing_email_opt_in: false },
            { id: 2, timezone: MSK, email: 'two@example.test', marketing_email_opt_in: false }
        ],
        throwingUserIds: [2]
    })

    const result = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(result.recapsCreated, 1)
    assert.equal(result.errors, 1)
    assert.equal(calls.store.length, 1)
    assert.equal(calls.store[0].userId, 1)
})

test('tick: created=false (dedupe) не считается отправкой', async () => {
    const { service, calls } = createHarness({
        storeResult: { notification: { id: 11 }, created: false }
    })

    const result = await service.runWeeklyRecapTick(SUNDAY_EVENING)
    assert.equal(result.recapsCreated, 0)
    assert.equal(result.usersSkipped, 1)
    assert.equal(calls.push.length, 0)
    assert.equal(calls.updated.length, 1)
})
