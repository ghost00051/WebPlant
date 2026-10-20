import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
    AccountController,
    DELETION_CONFIRMATION,
    buildAccountExport,
    collectPhotoUrls,
    pushEndpointHost,
    sanitizePasskey,
    sanitizePushSubscription,
    sanitizeUser
} from './accountController.js'

const PHOTO_URL = 'https://server.checktheplants.ru/uploads/plants/' + 'a'.repeat(32) + '.jpg'

function createResponse() {
    const headers = new Map()
    return {
        statusCode: 200,
        body: null,
        headers,
        setHeader(name, value) {
            headers.set(name, value)
        },
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

function createModel(name, calls, overrides = {}) {
    return {
        async findAll(options) {
            calls.push(`${name}.findAll${options?.where?.plant_id?.length ? '[plant_ids]' : ''}`)
            return overrides.findAll ? overrides.findAll(options) : []
        },
        async findOne() {
            calls.push(`${name}.findOne`)
            return overrides.findOne ? overrides.findOne() : null
        },
        async count(options) {
            calls.push(`${name}.count`)
            return overrides.count ? overrides.count(options) : 1
        },
        async destroy(options) {
            calls.push(`${name}.destroy${options?.where?.plant_id ? '[plant_ids]' : ''}`)
            return 1
        },
        async update(values, options) {
            calls.push(`${name}.update:${JSON.stringify(values)}`)
            return [1]
        },
        async findByPk(id) {
            calls.push(`${name}.findByPk`)
            return overrides.findByPk ? overrides.findByPk(id) : null
        }
    }
}

function createHarness({ user, modelOverrides = {}, queryRows = [], filesRemoved = 1 } = {}) {
    const calls = []
    const models = {}
    const modelNames = [
        'User', 'Plant', 'PlantPhoto', 'PlantCarePlan', 'WateringLog', 'ChatLog',
        'AiAdviceLog', 'Notification', 'NotificationPreference', 'PushSubscription',
        'PushBroadcastRecipient', 'MailBroadcastRecipient', 'AuthSession', 'Passkey',
        'PasskeyChallenge', 'PasswordResetToken', 'UserCookieConsent',
        'UserLegalConsent', 'SiteVisit'
    ]
    for (const name of modelNames) {
        models[name] = createModel(name, calls, {
            findByPk: async id => (name === 'User' ? user?.(id) : null),
            ...(modelOverrides[name] || {})
        })
    }

    const db = {
        async query(sql) {
            calls.push(`db.query:${/push_broadcasts/.test(sql) ? 'push_broadcasts' : /mail_broadcasts/.test(sql) ? 'mail_broadcasts' : 'photos'}`)
            if (/plant_photos/.test(sql)) return [queryRows]
            return [[], 0]
        },
        async transaction(callback) {
            calls.push('db.transaction')
            return callback({ id: 'tx' })
        }
    }

    const controller = new AccountController({
        models,
        db,
        comparePassword: async password => password === 'correct-password',
        removePlantPhotoFiles: async urls => {
            calls.push(`removePlantPhotoFiles:${urls.length}`)
            return filesRemoved
        },
        clearAuthCookies: res => {
            calls.push('clearAuthCookies')
            res.setHeader('Set-Cookie', 'token=; Max-Age=0')
        }
    })

    return { controller, calls, models }
}

test('sanitizeUser не отдаёт пароль и служебные поля', () => {
    const clean = sanitizeUser({
        id: 7,
        email: 'leaf@example.com',
        password: '$2b$10$hash',
        role: 'USER',
        privilege_level: 'free',
        timezone: 'Europe/Moscow',
        welcome_email_sent_at: new Date()
    })
    assert.equal(clean.id, 7)
    assert.equal(clean.email, 'leaf@example.com')
    assert.equal(clean.privilegeLevel, 'free')
    assert.ok(!('password' in clean))
    assert.ok(!('welcome_email_sent_at' in clean))
})

test('sanitizePushSubscription не отдаёт endpoint с токеном и ключи шифрования', () => {
    const clean = sanitizePushSubscription({
        id: 1,
        endpoint: 'https://fcm.googleapis.com/fcm/send/SECRET-DELIVERY-TOKEN',
        p256dh: 'PUBLIC-KEY',
        auth: 'AUTH-SECRET',
        created_at: '2026-10-01T00:00:00.000Z'
    })
    assert.equal(clean.service, 'fcm.googleapis.com')
    const serialized = JSON.stringify(clean)
    assert.ok(!serialized.includes('SECRET-DELIVERY-TOKEN'))
    assert.ok(!serialized.includes('PUBLIC-KEY'))
    assert.ok(!serialized.includes('AUTH-SECRET'))
})

test('sanitizePasskey не отдаёт credential_id/public_key/counter', () => {
    const clean = sanitizePasskey({
        id: 3,
        credential_id: 'credential',
        public_key: 'public',
        counter: 42,
        device_name: 'iPhone',
        transports: ['internal']
    })
    const serialized = JSON.stringify(clean)
    assert.equal(clean.deviceName, 'iPhone')
    assert.ok(!serialized.includes('credential'))
    assert.ok(!serialized.includes('public_key'))
    assert.ok(!serialized.includes('42'))
})

test('pushEndpointHost безопасно разбирает endpoint', () => {
    assert.equal(pushEndpointHost('https://push.example.com/a/b'), 'push.example.com')
    assert.equal(pushEndpointHost(''), null)
    assert.equal(pushEndpointHost('not a url'), null)
    assert.equal(pushEndpointHost(undefined), null)
})

test('collectPhotoUrls убирает дубли и мусор', () => {
    assert.deepEqual(
        collectPhotoUrls([{ url: PHOTO_URL }, { url: PHOTO_URL }, { url: '' }, { url: null }, null]),
        [PHOTO_URL]
    )
})

test('buildAccountExport не содержит секретов и собирает связанные данные', () => {
    const payload = buildAccountExport({
        exportedAt: '2026-10-20T12:00:00.000Z',
        user: { id: 1, email: 'leaf@example.com', password: 'HASH' },
        plants: [{ id: 11, name: 'Монстера', user_id: 1, is_active: true, reminder_weekdays: [1] }],
        photos: [{ plant_id: 11, url: PHOTO_URL, thumb_url: PHOTO_URL + '.thumb.jpg', is_main: true }],
        carePlans: [{ plant_id: 11, plan: { watering: 7 } }],
        wateringLogs: [{ id: 1, plant_id: 11, action: 'watered', watered_at: '2026-10-01' }],
        chatMessages: [{ id: 5, session_id: 's1', role: 'user', text: 'Привет' }],
        notifications: [{ id: 9, type: 'watering', title: 'Пора полить', body: 'Монстера' }],
        notificationPreferences: { morning_summary_enabled: true, care_advice_enabled: false },
        pushSubscriptions: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/TOKEN', p256dh: 'KEY', auth: 'AUTH' }],
        cookieConsents: [{ consent_type: 'analytics', is_accepted: true, version: '1.0' }],
        legalConsents: [{ consent_type: 'privacy_policy', is_accepted: true, document_version: '2.0' }],
        passkeys: [{ credential_id: 'cred', public_key: 'pub', counter: 3, device_name: 'iPhone' }],
        authSessionsCount: 2,
        siteVisits: [{ day: '2026-10-19', views: 3, first_path: '/' }]
    })

    const serialized = JSON.stringify(payload)
    assert.equal(payload.format, 'webplant-account-export')
    assert.equal(payload.plants[0].photos.length, 1)
    assert.equal(payload.plants[0].carePlan.watering, 7)
    assert.equal(payload.sessions.authSessions, 2)
    for (const secret of ['HASH', 'p256dh', 'TOKEN', 'AUTH', 'credential', '"public"', 'password']) {
        assert.ok(!serialized.includes(secret), `в экспорте не должно быть «${secret}»`)
    }
})

test('deleteMe: без слова подтверждения — 400 и никаких удалений', async () => {
    const { controller, calls } = createHarness({ user: () => ({ id: 1, role: 'USER' }) })
    const res = createResponse()

    await controller.deleteMe(
        { user: { id: 1 }, body: { password: 'correct-password', confirm: 'удалить' } },
        res
    )

    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, new RegExp(DELETION_CONFIRMATION))
    assert.equal(calls.length, 0)
})

test('deleteMe: без пароля — 400 и никаких удалений', async () => {
    const { controller, calls } = createHarness({ user: () => ({ id: 1, role: 'USER' }) })
    const res = createResponse()

    await controller.deleteMe(
        { user: { id: 1 }, body: { confirm: DELETION_CONFIRMATION } },
        res
    )

    assert.equal(res.statusCode, 400)
    assert.equal(res.body.requiresPassword, true)
    assert.equal(calls.length, 0)
})

test('deleteMe: неверный пароль — 403 и никаких удалений', async () => {
    const { controller, calls } = createHarness({
        user: () => ({ id: 1, role: 'USER', password: 'hash' })
    })
    const res = createResponse()

    await controller.deleteMe(
        { user: { id: 1 }, body: { password: 'wrong', confirm: DELETION_CONFIRMATION } },
        res
    )

    assert.equal(res.statusCode, 403)
    assert.ok(!calls.includes('db.transaction'))
})

test('deleteMe: администратор удаляется только через админ-панель', async () => {
    const { controller, calls } = createHarness({
        user: () => ({ id: 1, role: 'ADMIN', password: 'hash' })
    })
    const res = createResponse()

    await controller.deleteMe(
        { user: { id: 1 }, body: { password: 'correct-password', confirm: DELETION_CONFIRMATION } },
        res
    )

    assert.equal(res.statusCode, 409)
    assert.ok(!calls.includes('db.transaction'))
})

test('deleteMe: успешное удаление каскадом + файлы + cookie', async () => {
    const { controller, calls } = createHarness({
        user: () => ({ id: 42, role: 'USER', password: 'hash' }),
        queryRows: [{ url: PHOTO_URL }],
        filesRemoved: 1,
        modelOverrides: {
            Plant: { findAll: async () => [{ id: 11 }] }
        }
    })
    const res = createResponse()

    await controller.deleteMe(
        { user: { id: 42 }, body: { password: 'correct-password', confirm: DELETION_CONFIRMATION } },
        res
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.deleted, true)
    assert.equal(res.body.removed.plants, 1)
    assert.equal(res.body.removed.photoFiles, 1)
    assert.ok(calls.includes('db.transaction'), 'удаление в транзакции')
    assert.ok(calls.includes('removePlantPhotoFiles:1'), 'файлы фото удалены с диска')
    assert.ok(calls.includes('clearAuthCookies'), 'auth-cookie очищены')

    const indexOf = marker => calls.indexOf(marker)
    assert.ok(indexOf('PlantPhoto.destroy[plant_ids]') < indexOf('Plant.destroy'))
    assert.ok(indexOf('WateringLog.destroy[plant_ids]') < indexOf('Plant.destroy'))
    assert.ok(indexOf('Plant.destroy') < indexOf('User.destroy'))
    assert.ok(indexOf('AuthSession.destroy') < indexOf('User.destroy'))
    assert.ok(indexOf('PasswordResetToken.destroy') < indexOf('User.destroy'))

    for (const required of [
        'ChatLog.destroy',
        'PushSubscription.destroy',
        'PushBroadcastRecipient.destroy',
        'MailBroadcastRecipient.destroy',
        'Notification.destroy',
        'NotificationPreference.destroy',
        'UserCookieConsent.destroy',
        'UserLegalConsent.destroy',
        'Passkey.destroy',
        'PasskeyChallenge.destroy'
    ]) {
        assert.ok(calls.includes(required), `должно удаляться: ${required}`)
    }

    assert.ok(calls.some(call => call.startsWith('AiAdviceLog.update') && call.includes('user_id')))
    assert.ok(calls.some(call => call.startsWith('SiteVisit.update') && call.includes('user_id')))
    assert.ok(calls.includes('db.query:push_broadcasts'))
    assert.ok(calls.includes('db.query:mail_broadcasts'))
})

test('exportData: без авторизации — 401', async () => {
    const { controller } = createHarness()
    const res = createResponse()
    await controller.exportData({ user: null }, res)
    assert.equal(res.statusCode, 401)
})

test('exportData: отдаёт JSON-файл со всеми данными и без секретов', async () => {
    const user = {
        id: 1,
        email: 'leaf@example.com',
        password: 'HASH',
        name: 'Иван',
        timezone: 'Europe/Moscow',
        role: 'USER'
    }
    const { controller } = createHarness({
        user: id => (id === 1 ? user : null),
        modelOverrides: {
            Plant: {
                findAll: async () => [{ id: 11, name: 'Монстера', user_id: 1, is_active: true }]
            },
            PlantPhoto: {
                findAll: async () => [{ plant_id: 11, url: PHOTO_URL, is_main: true }]
            },
            ChatLog: {
                findAll: async () => [{ id: 1, session_id: 's1', role: 'user', text: 'Привет' }]
            },
            PushSubscription: {
                findAll: async () => [{
                    endpoint: 'https://fcm.googleapis.com/fcm/send/TOKEN',
                    p256dh: 'KEY',
                    auth: 'AUTH'
                }]
            },
            Passkey: {
                findAll: async () => [{ credential_id: 'cred', public_key: 'pub', counter: 1, device_name: 'iPhone' }]
            },
            AuthSession: { count: async () => 2 }
        }
    })
    const res = createResponse()

    await controller.exportData({ user: { id: 1 } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.format, 'webplant-account-export')
    assert.equal(res.body.account.email, 'leaf@example.com')
    assert.equal(res.body.plants.length, 1)
    assert.equal(res.body.chatMessages.length, 1)
    assert.equal(res.body.sessions.authSessions, 2)
    assert.match(res.headers.get('Content-Disposition'), /attachment; filename="lejka-account-1-\d{4}-\d{2}-\d{2}\.json"/)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    const serialized = JSON.stringify(res.body)
    assert.ok(!serialized.includes('HASH'))
    assert.ok(!serialized.includes('TOKEN'))
    assert.ok(!serialized.includes('"pub"'))
})

test('маршруты LIVE-02 подключены с requireAuth и rate-limit', async () => {
    const routes = await readFile(
        resolve(import.meta.dirname, '..', 'routes', 'userRoutes.js'),
        'utf8'
    )
    assert.match(routes, /router\.get\(\s*['"]\/me\/export['"]\s*,\s*requireAuth\s*,\s*accountExportLimiter/)
    assert.match(routes, /router\.delete\(\s*['"]\/me['"]\s*,\s*requireAuth\s*,\s*accountDeleteLimiter/)
    assert.match(routes, /AccountController\.exportData/)
    assert.match(routes, /AccountController\.deleteMe/)
})

test('LIVE-03: регистрация больше не подтверждает существование email', async () => {
    const source = await readFile(
        resolve(import.meta.dirname, 'userController.js'),
        'utf8'
    )
    assert.ok(!source.includes('Пользователь с таким email уже существует'))
    assert.ok(!source.includes('Пользователь с таким email или именем уже существует'))
    assert.ok(source.includes('Если аккаунт уже есть — войдите или восстановите пароль'))
    assert.match(source, /await bcrypt\.hash\(String\(password \|\|/)
})

test('LIVE-03: rate-limit регистрации/входа/удаления на месте', async () => {
    const routes = await readFile(
        resolve(import.meta.dirname, '..', 'routes', 'userRoutes.js'),
        'utf8'
    )
    assert.match(routes, /registrationLimiter/)
    assert.match(routes, /loginLimiter/)
    assert.match(routes, /accountDeleteLimiter/)
    assert.match(routes, /user-registration/)
    assert.match(routes, /user-login/)
})

