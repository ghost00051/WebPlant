import test from 'node:test'
import assert from 'node:assert/strict'

import {
    GARDEN_VIEW_DEDUPE_MS,
    buildGardenVisitorKey,
    claimGardenView,
    getPublicGarden,
    notifyGardenShareViews,
    resetGardenViewDedupeState,
    resolveGardenViewDelivery
} from './gardenShareService.js'

test('notifyGardenShareViews: невалидные аргументы не требуют БД', async () => {
    assert.deepEqual(await notifyGardenShareViews(null), { notified: false, reason: 'invalid' })
    assert.deepEqual(await notifyGardenShareViews({ id: 0, user_id: 1 }), { notified: false, reason: 'invalid' })
    assert.deepEqual(await notifyGardenShareViews({ id: 1, user_id: null, view_count: 3 }), {
        notified: false,
        reason: 'invalid'
    })
    assert.deepEqual(await notifyGardenShareViews({ id: 1, user_id: 1, view_count: 0 }), {
        notified: false,
        reason: 'invalid'
    })
})

test('notifyGardenShareViews: рост просмотров раньше суточного окна — throttled без БД', async () => {
    const now = new Date('2026-11-01T12:00:00Z')
    const result = await notifyGardenShareViews({
        id: 5,
        user_id: 7,
        view_count: 10,
        views_notified_count: 4,
        views_notified_at: new Date('2026-11-01T11:00:00Z')
    }, { now })

    assert.deepEqual(result, { notified: false, reason: 'throttled' })
})

test('buildGardenVisitorKey: стабильный хэш IP+UA, без признаков посетителя — null', () => {
    const first = buildGardenVisitorKey({ ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (X11; Linux)' })

    assert.match(first, /^[0-9a-f]{32}$/)
    assert.equal(
        first,
        buildGardenVisitorKey({ ip: ' 10.0.0.1 ', userAgent: 'Mozilla/5.0 (X11; Linux) ' }),
        'пробелы не должны менять ключ'
    )
    assert.notEqual(first, buildGardenVisitorKey({ ip: '10.0.0.2', userAgent: 'Mozilla/5.0 (X11; Linux)' }))
    assert.notEqual(first, buildGardenVisitorKey({ ip: '10.0.0.1', userAgent: 'curl/8.5.0' }))
    assert.equal(buildGardenVisitorKey(), null)
    assert.equal(buildGardenVisitorKey({}), null)
    assert.equal(buildGardenVisitorKey({ ip: '', userAgent: '' }), null)
})

test('claimGardenView: без признаков посетителя просмотр считается как раньше', async () => {
    resetGardenViewDedupeState()
    assert.deepEqual(await claimGardenView(5, null), {
        counted: true,
        deduped: false,
        degraded: true
    })
    assert.deepEqual(await claimGardenView(0, 'visitor'), {
        counted: true,
        deduped: false,
        degraded: true
    })
})

test('claimGardenView: Redis SET NX дедуплицирует повторный визит на 24 часа', async () => {
    resetGardenViewDedupeState()
    const seen = new Set()
    const calls = []
    const command = async args => {
        calls.push(args)
        assert.equal(args[0], 'SET')
        if (seen.has(args[1])) return null
        seen.add(args[1])
        return 'OK'
    }

    const now = new Date('2026-11-01T12:00:00Z')
    const visitor = buildGardenVisitorKey({ ip: '10.0.0.1', userAgent: 'Mozilla/5.0' })

    assert.deepEqual(await claimGardenView(5, visitor, { now, command }), {
        counted: true,
        deduped: false,
        degraded: false
    })
    assert.deepEqual(await claimGardenView(5, visitor, {
        now: new Date('2026-11-02T11:59:00Z'),
        command
    }), {
        counted: false,
        deduped: true,
        degraded: false
    })

    const [setArgs] = calls
    assert.equal(setArgs[3], 'PX')
    assert.equal(setArgs[4], String(GARDEN_VIEW_DEDUPE_MS))

    assert.equal(
        (await claimGardenView(5, 'another-visitor', { now, command })).counted,
        true,
        'другой посетитель — новый просмотр'
    )
    assert.equal(
        (await claimGardenView(6, visitor, { now, command })).counted,
        true,
        'счётчики разных ссылок не пересекаются'
    )
})

test('claimGardenView: без Redis работает in-memory fallback на то же окно 24ч', async () => {
    resetGardenViewDedupeState()
    const command = async () => {
        throw new Error('Redis недоступен')
    }

    const first = await claimGardenView(7, 'visitor-a', {
        now: new Date('2026-11-01T12:00:00Z'),
        command
    })
    assert.deepEqual(first, { counted: true, deduped: false, degraded: true })

    assert.deepEqual(await claimGardenView(7, 'visitor-a', {
        now: new Date('2026-11-02T11:59:00Z'),
        command
    }), { counted: false, deduped: true, degraded: true })

    assert.deepEqual(await claimGardenView(7, 'visitor-a', {
        now: new Date('2026-11-02T12:01:00Z'),
        command
    }), { counted: true, deduped: false, degraded: true }, 'после окна визит снова считается')

    assert.equal(
        (await claimGardenView(7, 'visitor-b', {
            now: new Date('2026-11-02T12:01:00Z'),
            command
        })).counted,
        true
    )
    resetGardenViewDedupeState()
})

test('resolveGardenViewDelivery: тихие часы владельца — без push и мессенджеров', async () => {
    const delivery = await resolveGardenViewDelivery(4, new Date('2026-11-01T20:00:00Z'), {
        NotificationPreference: {
            async findByPk() {
                return {
                    quiet_hours_enabled: true,
                    quiet_hours_start: '22:00',
                    quiet_hours_end: '08:00'
                }
            }
        },
        User: { async findByPk() { return { timezone: 'Europe/Moscow' } } },
        PushSubscription: { async count() { return 2 } }
    })

    assert.deepEqual(delivery, { push: false, messengers: false, reason: 'quiet_hours' })
})

test('resolveGardenViewDelivery: нет активных push-подписок — без push, но мессенджеры', async () => {
    const delivery = await resolveGardenViewDelivery(4, new Date('2026-11-01T12:00:00Z'), {
        NotificationPreference: { async findByPk() { return null } },
        User: { async findByPk() { return { timezone: 'Europe/Moscow' } } },
        PushSubscription: { async count() { return 0 } }
    })

    assert.deepEqual(delivery, { push: false, messengers: true, reason: 'push_disabled' })
})

test('resolveGardenViewDelivery: push включён — отправляем push (как раньше)', async () => {
    const delivery = await resolveGardenViewDelivery(4, new Date('2026-11-01T12:00:00Z'), {
        NotificationPreference: {
            async findByPk() {
                return { quiet_hours_enabled: false, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }
            }
        },
        User: { async findByPk() { return { timezone: 'Europe/Moscow' } } },
        PushSubscription: { async count() { return 1 } }
    })

    assert.deepEqual(delivery, { push: true, messengers: false, reason: null })
})

test('resolveGardenViewDelivery: ошибка чтения настроек — push отправляется (fail-open)', async () => {
    const delivery = await resolveGardenViewDelivery(4, new Date('2026-11-01T12:00:00Z'), {
        NotificationPreference: {
            async findByPk() {
                throw new Error('db down')
            }
        },
        User: { async findByPk() { return null } },
        PushSubscription: { async count() { return 0 } }
    })

    assert.deepEqual(delivery, { push: true, messengers: false, reason: 'error' })
})

function createNotifyHarness({ storeError = null, created = true } = {}) {
    const log = []
    const stores = []
    const deps = {
        async acquireLock() {
            log.push('lock')
            return { acquired: true }
        },
        async releaseLock() {
            log.push('unlock')
        },
        async storeNotification(payload) {
            stores.push(payload)
            log.push('store')
            if (storeError) throw storeError
            return { notification: { id: 11 }, created }
        },
        async resolveGardenViewDelivery() {
            log.push('delivery')
            return { push: false, messengers: false, reason: 'quiet_hours' }
        },
        sequelize: {
            async query(sql) {
                const normalized = String(sql).replace(/\s+/g, ' ')
                if (normalized.includes('SELECT id, user_id, view_count')) {
                    log.push('load')
                    return [[{
                        id: 5,
                        user_id: 7,
                        view_count: 6,
                        views_notified_at: null,
                        views_notified_count: 0
                    }]]
                }
                if (normalized.includes('SET views_notified_at = now()')) {
                    log.push('mark')
                    return [[]]
                }
                throw new Error(`unexpected query: ${normalized}`)
            }
        }
    }

    return { deps, log, stores }
}

const TRIGGERING_SHARE = {
    id: 5,
    user_id: 7,
    view_count: 6,
    views_notified_count: 0,
    views_notified_at: null
}

test('notifyGardenShareViews: views_notified_* обновляются только после успешного storeNotification', async () => {
    const { deps, log, stores } = createNotifyHarness()

    const result = await notifyGardenShareViews(TRIGGERING_SHARE, {
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.deepEqual(result, { notified: true, viewCount: 6, notificationId: 11 })
    assert.deepEqual(log, ['lock', 'load', 'store', 'mark', 'delivery', 'unlock'])
    assert.equal(stores.length, 1)
    assert.equal(stores[0].userId, 7)
    assert.equal(stores[0].type, 'garden_view')
    assert.equal(stores[0].dedupeKey, 'garden-share:5:view:6')
})

test('notifyGardenShareViews: сбой storeNotification не двигает состояние троттлинга', async () => {
    const { deps, log } = createNotifyHarness({ storeError: new Error('notifications.type check failed') })

    const result = await notifyGardenShareViews(TRIGGERING_SHARE, {
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.deepEqual(result, { notified: false, reason: 'error' })
    assert.deepEqual(log, ['lock', 'load', 'store', 'unlock'], 'mark не выполняется при ошибке store')
})

test('notifyGardenShareViews: свежие счётчики в БД перекрывают устаревший snapshot', async () => {
    const { deps, log } = createNotifyHarness()
    deps.sequelize.query = async sql => {
        const normalized = String(sql).replace(/\s+/g, ' ')
        if (normalized.includes('SELECT id, user_id, view_count')) {
            log.push('load')
            return [[{
                id: 5,
                user_id: 7,
                view_count: 7,
                views_notified_at: new Date('2026-11-01T11:59:00Z'),
                views_notified_count: 7
            }]]
        }
        throw new Error('mark не должен выполняться при throttled')
    }

    const result = await notifyGardenShareViews(TRIGGERING_SHARE, {
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.deepEqual(result, { notified: false, reason: 'throttled' })
    assert.deepEqual(log, ['lock', 'load', 'unlock'])
})

test('notifyGardenShareViews: лок занят другим инстансом — без уведомления и БД', async () => {
    const { deps, log } = createNotifyHarness()
    deps.acquireLock = async () => {
        log.push('lock')
        return { acquired: false }
    }

    const result = await notifyGardenShareViews(TRIGGERING_SHARE, {
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.deepEqual(result, { notified: false, reason: 'claimed_elsewhere' })
    assert.deepEqual(log, ['lock'])
})

const SHARE_TOKEN = 'A'.repeat(22)

const SHARE_ROW = {
    id: 5,
    user_id: 7,
    token: SHARE_TOKEN,
    created_at: new Date('2026-10-28T10:00:00Z'),
    view_count: 5,
    views_notified_at: null,
    views_notified_count: 0
}

function createGardenHarness({
    viewerUserId = null,
    claim = { counted: true, deduped: false, degraded: false }
} = {}) {
    const queries = []
    const notifications = []
    const deps = {
        sequelize: {
            async query(sql, options) {
                const normalized = String(sql).replace(/\s+/g, ' ')
                if (normalized.includes('FROM garden_shares') && normalized.includes('WHERE token = $1')) {
                    queries.push({ kind: 'select', bind: options.bind })
                    return [[{ ...SHARE_ROW }]]
                }
                if (normalized.includes('SET view_count = view_count + 1')) {
                    queries.push({ kind: 'increment', bind: options.bind })
                    return [[{ ...SHARE_ROW, view_count: SHARE_ROW.view_count + 1 }]]
                }
                throw new Error(`unexpected query: ${normalized}`)
            }
        },
        User: {
            async findByPk(id) {
                return { id, name: 'Иван', username: 'ivan' }
            }
        },
        Plant: {
            async findAll() {
                return [{ id: 1, name: 'Монстера', species: null, watering_interval_days: 5 }]
            },
            async count() {
                return 1
            }
        },
        claimGardenView: async (shareId, visitorKey, options) => {
            queries.push({ kind: 'claim', bind: [shareId, visitorKey], options })
            return claim
        },
        notifyGardenShareViews: async (share, options) => {
            notifications.push({ share, options })
            return { notified: true }
        },
        viewerUserId
    }

    return { deps, queries, notifications }
}

test('getPublicGarden: просмотр владельцем не увеличивает view_count и не уведомляет', async () => {
    const { deps, queries, notifications } = createGardenHarness({ viewerUserId: 7 })

    const garden = await getPublicGarden(SHARE_TOKEN, {
        viewerUserId: 7,
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.equal(garden.viewCount, 5)
    assert.deepEqual(queries.map(query => query.kind), ['select'], 'владелец не инкрементирует и не дедуплицирует визит')
    assert.equal(notifications.length, 0, 'о своих просмотрах владельца не уведомляем')
})

test('getPublicGarden: новый посетитель увеличивает view_count и уведомляет владельца', async () => {
    const { deps, queries, notifications } = createGardenHarness()

    const garden = await getPublicGarden(SHARE_TOKEN, {
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.equal(garden.viewCount, 6)
    assert.deepEqual(queries.map(query => query.kind), ['select', 'claim', 'increment'])
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].share.view_count, 6)
})

test('getPublicGarden: повторный визит в окне дедупликации не увеличивает view_count', async () => {
    const { deps, queries, notifications } = createGardenHarness({
        claim: { counted: false, deduped: true, degraded: false }
    })

    const garden = await getPublicGarden(SHARE_TOKEN, {
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        now: new Date('2026-11-01T12:00:00Z'),
        deps
    })

    assert.equal(garden.viewCount, 5)
    assert.deepEqual(queries.map(query => query.kind), ['select', 'claim'])
    assert.equal(notifications.length, 0)
})
