import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { applyMigrations, listMigrationFiles } from './helpers/migrations.js'

process.env.REDIS_COMMAND_TIMEOUT_MS ??= '5000'

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1'
const SKIP_REASON = 'интеграционные тесты выключены: RUN_INTEGRATION=1 не задан (нужны Postgres и Redis)'

const skip = RUN_INTEGRATION ? false : SKIP_REASON

const LOCK_TTL_MS = 30_000
const LOCK_ATTEMPTS = 8
const LOCK_RETRY_DELAY_MS = 250

async function waitForRedis(ping, { attempts = 20, delayMs = 250 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (await ping()) return true
        await sleep(delayMs)
    }
    return false
}

async function acquireWithRetry({
    acquireLock,
    client,
    key,
    name,
    ttlMs = LOCK_TTL_MS,
    cleanupOnDegraded = false
}) {
    for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt += 1) {
        const lock = await acquireLock(name, { ttlMs })
        if (!lock.degraded) return lock

        if (cleanupOnDegraded) {
            await client.del(key).catch(() => {})
        }
        await sleep(LOCK_RETRY_DELAY_MS)
    }

    throw new Error(
        `Redis не успевает ответить за секунду (degraded) — проверьте REDIS_URL/нагрузку: ${name}`
    )
}

async function releaseWithRetry({ releaseLock, client, lock }) {
    for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt += 1) {
        if (await releaseLock(lock)) return true

        const remaining = await client.get(lock.key).catch(() => undefined)
        if (remaining === null) return true

        await sleep(LOCK_RETRY_DELAY_MS)
    }
    return false
}

let contextPromise = null

async function getContext() {
    contextPromise ??= (async () => {
        const [{ default: sequelize }, { default: User }, { default: Plant }, { default: Notification }, { ensureBaseSchema }] =
            await Promise.all([
                import('../db.js'),
                import('../models/userModels.js'),
                import('../models/Plant.js'),
                import('../models/Notification.js'),
                import('../scripts/init-integration-db.mjs')
            ])

        await sequelize.authenticate()
        await ensureBaseSchema()

        return { sequelize, User, Plant, Notification }
    })()

    return contextPromise
}

function uniqueEmail(prefix) {
    return `${prefix}-${randomUUID()}@integration.test`
}

after(async () => {
    if (!contextPromise) return
    try {
        const { sequelize } = await contextPromise
        await sequelize.close()
    } catch {
    }
})

test('миграции применяются идемпотентно (двукратный прогон)', { skip }, async t => {
    const { sequelize } = await getContext()

    const files = listMigrationFiles()
    assert.ok(files.length >= 10, `в Backend/migrations ожидались SQL-файлы, найдено ${files.length}`)

    const first = await applyMigrations()
    const second = await applyMigrations()

    t.diagnostic(`runner: ${first.runner}, файлов: ${files.length}`)

    assert.equal(first.applied.length, files.length, 'первый прогон применил не все файлы')
    assert.equal(second.applied.length, files.length, 'повторный прогон применил не все файлы')
    assert.deepEqual(second.applied, first.applied, 'порядок применения миграций должен совпадать')

    const [rows] = await sequelize.query(
        "select table_name from information_schema.tables where table_schema = 'public'"
    )
    const tables = new Set(rows.map(row => row.table_name))

    const expectedTables = [
        'users',
        'plants',
        'push_subscriptions',
        'chat_logs',
        'auth_sessions',
        'passkeys',
        'passkey_challenges',
        'notification_preferences',
        'notifications',
        'push_broadcasts',
        'push_broadcast_recipients',
        'mail_broadcasts',
        'mail_broadcast_recipients',
        'password_reset_tokens',
        'ai_advice_logs',
        'plant_care_plans',
        'site_visit_days'
    ]
    for (const table of expectedTables) {
        assert.ok(tables.has(table), `после миграций нет таблицы ${table}`)
    }

    const [indexes] = await sequelize.query(
        `select indexdef from pg_indexes
         where schemaname = 'public'
           and tablename = 'notifications'
           and indexname = 'idx_notifications_user_dedupe'`
    )
    assert.equal(indexes.length, 1, 'миграции не создали индекс idx_notifications_user_dedupe')
    assert.match(indexes[0].indexdef, /^CREATE UNIQUE INDEX/)

    const [pushColumns] = await sequelize.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'push_subscriptions'`
    )
    const pushColumnNames = new Set(pushColumns.map(row => row.column_name))
    for (const column of ['last_success_at', 'last_error', 'failed_attempts', 'invalidated_at', 'invalid_reason']) {
        assert.ok(pushColumnNames.has(column), `миграция не добавила push_subscriptions.${column}`)
    }
})

test('unique index notifications(user_id, dedupe_key) не даёт создать дубликат', { skip }, async () => {
    const { User, Notification } = await getContext()

    const user = await User.create({ email: uniqueEmail('notif'), password: 'integration-test' })
    try {
        const dedupeKey = `watering:${randomUUID()}`
        const payload = {
            user_id: user.id,
            type: 'watering_due',
            title: 'Пора полить',
            body: 'Монстера ждёт воды',
            dedupe_key: dedupeKey
        }

        await Notification.create(payload)

        await assert.rejects(
            Notification.create(payload),
            error => {
                assert.equal(error.name, 'SequelizeUniqueConstraintError')
                return true
            },
            'повторное уведомление с тем же dedupe_key должно нарушать unique index'
        )

        await Notification.create({ ...payload, dedupe_key: `${dedupeKey}:second` })

        const count = await Notification.count({ where: { user_id: user.id } })
        assert.equal(count, 2, 'должны сохраниться ровно два уведомления с разными dedupe_key')
    } finally {
        await user.destroy().catch(() => {})
    }

    assert.equal(
        await Notification.count({ where: { user_id: user.id } }),
        0,
        'уведомления должны удаляться каскадом вместе с пользователем'
    )
})

test('distributedLock на реальном Redis: acquire / повторный acquire / release', { skip }, async () => {
    const [{ closeRedis, getRedisClient, pingRedis }, { acquireLock, releaseLock, buildLockKey, withDistributedLock }] =
        await Promise.all([
            import('../redis.js'),
            import('../utils/distributedLock.js')
        ])

    try {
        assert.ok(
            process.env.REDIS_URL || process.env.REDIS_HOST,
            'для интеграционного теста нужен REDIS_URL (или REDIS_HOST/REDIS_PORT)'
        )
        assert.ok(await waitForRedis(pingRedis), 'Redis недоступен: проверьте REDIS_URL и что сервис поднят')

        const client = await getRedisClient()
        assert.ok(client, 'клиент Redis должен быть доступен')

        const name = `integration-lock-${randomUUID()}`
        const key = buildLockKey(name)

        const first = await acquireWithRetry({ acquireLock, client, key, name, cleanupOnDegraded: true })
        assert.equal(first.acquired, true, 'первый acquire должен взять лок')
        assert.equal(first.degraded, false, 'лок должен быть настоящим, без degraded-фолбэка')
        assert.ok(first.token, 'у взятого лока должен быть token владельца')
        assert.equal(await client.get(key), first.token, 'в Redis должен лежать token владельца')

        const second = await acquireWithRetry({ acquireLock, client, key, name })
        assert.equal(second.acquired, false, 'второй acquire не должен брать занятый лок')
        assert.equal(second.degraded, false, 'второй acquire должен получить честный ответ Redis')

        assert.equal(
            await releaseWithRetry({ releaseLock, client, lock: first }),
            true,
            'release владельцем должен вернуть true'
        )
        assert.equal(await client.get(key), null, 'после release ключ должен исчезнуть из Redis')

        const third = await acquireWithRetry({ acquireLock, client, key, name, cleanupOnDegraded: true })
        assert.equal(third.acquired, true, 'после release лок должен снова браться')
        assert.equal(await releaseWithRetry({ releaseLock, client, lock: third }), true)

        const ran = await withDistributedLock(name, {}, async () => 'ok')
        assert.equal(ran.ran, true, 'на свободном локе задача должна выполниться')
        assert.equal(ran.result, 'ok')
        assert.equal(await client.get(key), null, 'withDistributedLock должен освободить лок')
    } finally {
        await closeRedis()
    }
})

test('транзакция откатывает вставки при ошибке', { skip }, async () => {
    const { sequelize, User, Plant } = await getContext()

    const email = uniqueEmail('rollback')
    const plantName = `rollback-${randomUUID()}`

    await assert.rejects(
        sequelize.transaction(async transaction => {
            const user = await User.create({ email, password: 'integration-test' }, { transaction })
            await Plant.create({ user_id: user.id, name: plantName }, { transaction })
            throw new Error('искусственная ошибка внутри транзакции')
        }),
        /искусственная ошибка внутри транзакции/
    )

    assert.equal(await User.count({ where: { email } }), 0, 'пользователь не должен остаться после rollback')
    assert.equal(await Plant.count({ where: { name: plantName } }), 0, 'растение не должно остаться после rollback')
})

test('удаление пользователя каскадно убирает растения и уведомления', { skip }, async () => {
    const { User, Plant, Notification } = await getContext()

    const user = await User.create({ email: uniqueEmail('cascade'), password: 'integration-test' })
    const plant = await Plant.create({
        user_id: user.id,
        name: `Монстера ${randomUUID()}`,
        watering_interval_days: 7
    })
    const notification = await Notification.create({
        user_id: user.id,
        plant_id: plant.id,
        type: 'care_tip',
        title: 'Совет дня',
        body: 'Протрите листья',
        dedupe_key: `care-tip:${plant.id}`
    })

    await user.destroy()

    assert.equal(await Plant.count({ where: { id: plant.id } }), 0, 'растение должно удалиться каскадом')
    assert.equal(
        await Notification.count({ where: { id: notification.id } }),
        0,
        'уведомление должно удалиться каскадом'
    )
})
