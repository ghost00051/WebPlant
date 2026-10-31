import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'

import { applyMigrations } from './helpers/migrations.js'

process.env.REDIS_URL = ''
delete process.env.REDIS_HOST

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1'
const SKIP_REASON = 'интеграционный тест метрик продукта выключен: RUN_INTEGRATION=1 не задан (нужны Postgres и psql в PATH)'

const skip = RUN_INTEGRATION ? false : SKIP_REASON

const MSK = 'Europe/Moscow'
const PERIOD_DAYS = 30
const METRIC_IDS = [
    'ttfv',
    'activation',
    'plants2',
    'd1',
    'd7',
    'd30',
    'push_ctr',
    'returns_no_push',
    'ai_usage',
    'ai_cost',
    'premium',
    'share_organic'
]

const BILLING_DETAIL = 'биллинг и entitlements (F15) не внедрены: платящие = privilege_level ≠ free'

let contextPromise = null

async function getContext() {
    contextPromise ??= (async () => {
        const [{ default: sequelize }, { ensureBaseSchema }] = await Promise.all([
            import('../db.js'),
            import('../scripts/init-integration-db.mjs')
        ])

        await sequelize.authenticate()
        await ensureBaseSchema()
        await applyMigrations()

        return { sequelize }
    })()

    return contextPromise
}

after(async () => {
    if (!contextPromise) return
    try {
        const { sequelize } = await contextPromise
        await sequelize.close()
    } catch {
    }
})

function pad(value) {
    return String(value).padStart(2, '0')
}

function todayMsk() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: MSK,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date())
}

function shiftDay(day, offset) {
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
}

function instant(day, hour, minute = 0, second = 0) {
    return new Date(`${day}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`)
}

function uniqueEmail(prefix) {
    return `${prefix}-${randomUUID()}@integration.test`
}

async function loadModels() {
    const [
        { default: User },
        { default: Plant },
        { default: PushSubscription },
        { default: Notification },
        { default: ProductEvent },
        { default: SiteVisit },
        { default: ChatLog },
        { default: AiAdviceLog }
    ] = await Promise.all([
        import('../models/userModels.js'),
        import('../models/Plant.js'),
        import('../models/PushSubscription.js'),
        import('../models/Notification.js'),
        import('../models/ProductEvent.js'),
        import('../models/SiteVisit.js'),
        import('../models/ChatLog.js'),
        import('../models/AiAdviceLog.js')
    ])

    return { User, Plant, PushSubscription, Notification, ProductEvent, SiteVisit, ChatLog, AiAdviceLog }
}

async function createUser(User, { prefix, registeredAt, privilege = 'free', role = 'USER' }) {
    return User.create({
        email: uniqueEmail(prefix),
        password: 'integration-test',
        role,
        privilege_level: privilege,
        created_at: registeredAt
    })
}

async function createPlant(Plant, userId, { name, isActive = true, createdAt }) {
    return Plant.create({
        user_id: userId,
        name: `${name}-${randomUUID()}`,
        watering_interval_days: 7,
        is_active: isActive,
        created_at: createdAt || new Date()
    })
}

async function createPush(PushSubscription, userId) {
    return PushSubscription.create({
        user_id: userId,
        endpoint: `https://push.integration.test/${randomUUID()}`,
        p256dh: 'integration-p256dh',
        auth: 'integration-auth'
    })
}

async function seedMetricsFixture(sequelize) {
    const models = await loadModels()
    const { User, Plant, PushSubscription, Notification, ProductEvent, SiteVisit, ChatLog, AiAdviceLog } = models

    const today = todayMsk()
    const day = offset => shiftDay(today, offset)
    const at = (offset, hour, minute = 0, second = 0) => instant(day(offset), hour, minute, second)

    await sequelize.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE')
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS watering_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            action VARCHAR(32),
            action_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `)

    const users = {}
    users.a = await createUser(User, { prefix: 'pm-a', registeredAt: at(0, 12), privilege: 'premium' })
    users.b = await createUser(User, { prefix: 'pm-b', registeredAt: at(0, 12) })
    users.c = await createUser(User, { prefix: 'pm-c', registeredAt: at(-10, 12) })
    users.d = await createUser(User, { prefix: 'pm-d', registeredAt: at(-10, 12) })
    users.e = await createUser(User, { prefix: 'pm-e', registeredAt: at(-10, 12) })
    users.f = await createUser(User, { prefix: 'pm-f', registeredAt: at(-3, 12) })
    users.g = await createUser(User, { prefix: 'pm-g', registeredAt: at(-2, 12) })
    users.h = await createUser(User, { prefix: 'pm-h', registeredAt: at(-1, 12) })
    users.j = await createUser(User, { prefix: 'pm-j', registeredAt: at(-40, 12), privilege: 'pro' })
    users.admin = await createUser(User, { prefix: 'pm-admin', registeredAt: at(-10, 12), role: 'ADMIN' })

    await createPlant(Plant, users.a.id, { name: 'a1' })
    await createPlant(Plant, users.a.id, { name: 'a2' })
    await createPlant(Plant, users.b.id, { name: 'b1' })
    await createPlant(Plant, users.b.id, { name: 'b2-inactive', isActive: false })
    await createPlant(Plant, users.c.id, { name: 'c1' })
    await createPlant(Plant, users.d.id, { name: 'd1' })
    await createPlant(Plant, users.f.id, { name: 'f1' })
    await createPlant(Plant, users.f.id, { name: 'f2' })
    await createPlant(Plant, users.g.id, { name: 'g1' })
    await createPlant(Plant, users.j.id, { name: 'j1' })
    await createPlant(Plant, users.j.id, { name: 'j2' })
    await createPlant(Plant, users.j.id, { name: 'j3' })
    for (let index = 0; index < 5; index += 1) {
        await createPlant(Plant, users.admin.id, { name: `admin-${index}` })
    }

    for (const key of ['a', 'c', 'e', 'f', 'g', 'j']) {
        await createPush(PushSubscription, users[key].id)
    }

    const events = [
        { user: users.a, visitor: 'pm-visitor-a', event: 'landing_view', at: at(0, 10, 0) },
        { user: users.a, visitor: 'pm-visitor-a', event: 'plant_created', at: at(0, 10, 2, 22) },
        { user: users.b, visitor: 'pm-visitor-b', event: 'landing_view', at: at(0, 11, 0) },
        { user: users.b, visitor: 'pm-visitor-b', event: 'plant_created', at: at(0, 11, 1) },
        { user: users.d, visitor: 'pm-visitor-d', event: 'watering_marked', at: at(-5, 12, 0) },
        { user: users.j, visitor: 'pm-visitor-j', event: 'watering_marked', at: at(-10, 12, 0) }
    ]
    for (const event of events) {
        await ProductEvent.create({
            user_id: event.user.id,
            visitor_id: event.visitor,
            event: event.event,
            properties: {},
            created_at: event.at
        })
    }

    await SiteVisit.create({ visitor_id: 'pm-visitor-c', day: day(-9), user_id: users.c.id, views: 1 })
    await SiteVisit.create({ visitor_id: 'pm-visitor-c', day: day(-2), user_id: users.c.id, views: 1 })
    await SiteVisit.create({
        visitor_id: 'pm-visitor-b',
        day: day(-1),
        user_id: users.b.id,
        views: 1,
        utm_source: 'share'
    })

    await Notification.create({
        user_id: users.a.id,
        type: 'watering_due',
        title: 'Пора полить',
        body: 'Монстера ждёт воды',
        dedupe_key: `pm-n1-${randomUUID()}`,
        created_at: at(0, 9, 0),
        click_count: 2,
        clicked_at: at(0, 9, 5)
    })
    await Notification.create({
        user_id: users.c.id,
        type: 'watering_due',
        title: 'Пора полить',
        body: 'Кактус ждёт воды',
        dedupe_key: `pm-n2-${randomUUID()}`,
        created_at: at(-2, 9, 0),
        click_count: 0
    })
    await Notification.create({
        user_id: users.b.id,
        type: 'watering_due',
        title: 'Пора полить',
        body: 'Фикус ждёт воды',
        dedupe_key: `pm-n3-${randomUUID()}`,
        created_at: at(-1, 9, 0),
        click_count: 0
    })

    await ChatLog.create({ user_id: users.a.id, role: 'user', text: 'Как полить монстеру?', created_at: at(0, 14, 0) })
    await ChatLog.create({ user_id: users.b.id, role: 'user', text: 'Почему желтеют листья?', created_at: at(-2, 14, 0) })
    await ChatLog.create({ user_id: users.b.id, role: 'assistant', text: 'Ответ ассистента', created_at: at(-2, 14, 1) })
    await ChatLog.create({ user_id: users.j.id, role: 'assistant', text: 'Ответ ассистента', created_at: at(-5, 14, 0) })
    await ChatLog.create({ user_id: users.j.id, role: 'user', text: 'Старый диалог', created_at: at(-40, 14, 0) })
    await AiAdviceLog.create({ user_id: users.d.id, kind: 'watering', created_at: at(-5, 15, 0) })

    return { today, users }
}

function itemById(board, id) {
    return board.items.find(item => item.id === id)
}

async function collectControllerResponse(days) {
    const { default: controller } = await import('../controllers/adminAnalyticsController.js')
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        }
    }

    await controller.getProductAnalytics({ query: { days } }, res)
    return res
}

test('buildProductMetricsBoard: 12 метрик по контракту на засиженных данных', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const [{ buildProductMetricsBoard }] = await Promise.all([
        import('../services/productMetricsService.js')
    ])
    const board = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4, aiRequests: 12 })

    assert.equal(board.items.length, 12, 'должно быть ровно 12 метрик')
    assert.deepEqual(board.items.map(item => item.id), METRIC_IDS, 'порядок id по контракту')
    assert.deepEqual(board.summary, { total: 12, measured: 11, partial: 1, unavailable: 0 })
    for (const item of board.items) {
        assert.ok(['measured', 'partial', 'unavailable'].includes(item.status), `${item.id}: неверный статус`)
        assert.ok(['seconds', 'percent', 'rub'].includes(item.unit), `${item.id}: неверный unit`)
        assert.ok(['P0', 'P1', 'P2'].includes(item.priority), `${item.id}: неверный priority`)
        assert.ok(typeof item.label === 'string' && item.label.length > 0, `${item.id}: пустой label`)
        assert.ok(typeof item.horizon === 'string' && item.horizon.length > 0, `${item.id}: пустой horizon`)
        assert.ok(typeof item.target === 'string' && item.target.length > 0, `${item.id}: пустой target`)
        assert.ok(typeof item.source === 'string' && item.source.length > 0, `${item.id}: пустой source`)
        assert.ok(typeof item.detail === 'string', `${item.id}: detail должен быть строкой`)
    }

    const ttfv = itemById(board, 'ttfv')
    assert.equal(ttfv.status, 'measured')
    assert.equal(ttfv.unit, 'seconds')
    assert.equal(ttfv.value, 101, 'медиана TTFV из 60 и 142 секунд')
    assert.equal(ttfv.display, '101 с')
    assert.equal(ttfv.targetMet, false, 'доля ≤ 60 с = 50% ниже цели 60%')
    assert.equal(ttfv.detail, 'медиана; n=2; 50% ≤ 60 с')
    assert.equal(ttfv.target, '< 60 сек у 60% новых')

    const activation = itemById(board, 'activation')
    assert.equal(activation.status, 'measured')
    assert.equal(activation.value, 50)
    assert.equal(activation.display, '50%')
    assert.equal(activation.targetMet, true, '50% активаций достигает цели ≥ 50%')
    assert.equal(activation.detail, '≥1 растение и push: 4 из 8')

    const plants2 = itemById(board, 'plants2')
    assert.equal(plants2.value, 33.3)
    assert.equal(plants2.display, '33,3%')
    assert.equal(plants2.targetMet, false)
    assert.equal(plants2.detail, '≥2 активных растения: 3 из 9 аккаунтов')

    const d1 = itemById(board, 'd1')
    assert.equal(d1.value, 16.7)
    assert.equal(d1.targetMet, false)
    assert.equal(d1.detail, 'вернулись 1 из 6; окно D1 завершено')

    const d7 = itemById(board, 'd7')
    assert.equal(d7.value, 50)
    assert.equal(d7.targetMet, true)
    assert.equal(d7.detail, 'вернулись 2 из 4; окно D7 завершено')

    const d30 = itemById(board, 'd30')
    assert.equal(d30.value, 100)
    assert.equal(d30.targetMet, true)
    assert.equal(d30.detail, 'вернулись 1 из 1; окно D30 завершено')

    const pushCtr = itemById(board, 'push_ctr')
    assert.equal(pushCtr.value, 66.7)
    assert.equal(pushCtr.display, '66,7%')
    assert.equal(pushCtr.targetMet, true)
    assert.equal(pushCtr.detail, 'кликов 2 из 3')

    const returns = itemById(board, 'returns_no_push')
    assert.equal(returns.value, 42.9)
    assert.equal(returns.targetMet, true)
    assert.equal(returns.detail, 'дней без push: 3 из 7')

    const aiUsage = itemById(board, 'ai_usage')
    assert.equal(aiUsage.value, 50, 'средняя дневная доля DAU: (50% + 100% + 0%) / 3')
    assert.equal(aiUsage.targetMet, true)
    assert.equal(aiUsage.detail, 'в среднем 50% DAU в день; дней с ИИ 2 из 3')

    const aiCost = itemById(board, 'ai_cost')
    assert.equal(aiCost.status, 'measured')
    assert.equal(aiCost.unit, 'rub')
    assert.equal(aiCost.value, 0.1, '0,4 ₽ расход / 4 активных user-дня = 0,1 ₽/DAU, без деления на 30 дней')
    assert.equal(aiCost.display, '0,1 ₽')
    assert.equal(aiCost.targetMet, true)
    assert.equal(aiCost.detail, 'расход 0,4 ₽ за 30 дн.; средний DAU 0,13; 0,1 ₽/DAU')

    const premium = itemById(board, 'premium')
    assert.equal(premium.status, 'partial')
    assert.equal(premium.value, 50)
    assert.equal(premium.display, '50%')
    assert.equal(premium.targetMet, true)
    assert.equal(premium.detail, BILLING_DETAIL)

    const share = itemById(board, 'share_organic')
    assert.equal(share.status, 'measured', 'после миграции F13 шаринг измеряется по garden_share_signups')
    assert.equal(share.value, 0, 'в фикстуре нет атрибутированных регистраций')
    assert.equal(share.display, '0%')
    assert.equal(share.targetMet, false)
    assert.equal(
        share.detail,
        'регистрации из шаринга 0 из 8; просмотров сада 0; кликов «Поделиться» 0'
    )
    assert.equal(share.source, 'garden_shares + garden_share_signups / регистрации; UTM/Web Share; admin → Продукт')

    const { User, ProductEvent } = await loadModels()
    const today = todayMsk()
    const oldUser = await createUser(User, {
        prefix: 'pm-old-plant',
        registeredAt: instant(shiftDay(today, -40), 12)
    })
    await ProductEvent.create({
        user_id: oldUser.id,
        visitor_id: 'pm-visitor-old',
        event: 'plant_created',
        properties: {},
        created_at: instant(shiftDay(today, -40), 12)
    })
    await ProductEvent.create({
        user_id: oldUser.id,
        visitor_id: 'pm-visitor-old-new',
        event: 'landing_view',
        properties: {},
        created_at: instant(shiftDay(today, -1), 12)
    })
    await ProductEvent.create({
        user_id: oldUser.id,
        visitor_id: 'pm-visitor-old-new',
        event: 'plant_created',
        properties: {},
        created_at: instant(today, 12)
    })

    const boardAfterSecondPlant = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4, aiRequests: 12 })
    const ttfvAfterSecondPlant = itemById(boardAfterSecondPlant, 'ttfv')
    assert.equal(ttfvAfterSecondPlant.value, 101, 'второе растение старого пользователя не должно искажать TTFV')
    assert.equal(ttfvAfterSecondPlant.detail, 'медиана; n=2; 50% ≤ 60 с')
})

test('buildProductMetricsBoard: aiCost = null даёт partial и прочерк у ai_cost', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const { buildProductMetricsBoard } = await import('../services/productMetricsService.js')
    const board = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: null, aiRequests: 12 })
    const aiCost = itemById(board, 'ai_cost')

    assert.equal(aiCost.status, 'partial')
    assert.equal(aiCost.value, null)
    assert.equal(aiCost.display, '—')
    assert.equal(aiCost.targetMet, null)
    assert.match(aiCost.detail, /AI_PRICE_\*/)
    assert.deepEqual(board.summary, { total: 12, measured: 10, partial: 2, unavailable: 0 })
})

test('buildProductMetricsBoard: aiRequests = 0 (нет телеметрии) даёт partial, а не «0 ₽»', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const { buildProductMetricsBoard } = await import('../services/productMetricsService.js')
    const withZeroRequests = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4, aiRequests: 0 })
    const aiCost = itemById(withZeroRequests, 'ai_cost')

    assert.equal(aiCost.status, 'partial')
    assert.equal(aiCost.value, null, 'при пустой телеметрии стоимость не выдаётся как 0')
    assert.equal(aiCost.display, '—')
    assert.equal(aiCost.targetMet, null)
    assert.equal(aiCost.detail, 'нет телеметрии ИИ за период — стоимость не рассчитана')
    assert.deepEqual(withZeroRequests.summary, { total: 12, measured: 10, partial: 2, unavailable: 0 })

    const withoutRequestsOption = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4 })
    assert.equal(itemById(withoutRequestsOption, 'ai_cost').status, 'measured', 'без опции aiRequests поведение прежнее')
})

test('getProductAnalytics: старые поля сохранены, metrics добавлен', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const response = await collectControllerResponse(String(PERIOD_DAYS))
    assert.equal(response.statusCode, 200, `контроллер ответил ${response.statusCode}: ${JSON.stringify(response.body)}`)

    const body = response.body
    assert.ok(body.generatedAt, 'generatedAt на месте')
    assert.equal(body.timezone, MSK)
    assert.equal(body.days, PERIOD_DAYS)
    assert.equal(typeof body.eventsTracked, 'boolean')
    assert.equal(typeof body.usersCreatedAtTracked, 'boolean')
    for (const key of ['dau', 'wau', 'mau', 'activeUsers', 'newUsers', 'eventsToday', 'eventsInRange']) {
        assert.equal(typeof body.activity[key], 'number', `activity.${key}`)
    }
    for (const key of ['registered', 'plantCreated', 'wateringMarked', 'pushSubscribed', 'rates']) {
        assert.ok(key in body.funnel, `funnel.${key}`)
    }
    assert.ok(Array.isArray(body.retention), 'retention — массив когорт')
    assert.ok(Array.isArray(body.events), 'events — массив')
    for (const key of ['notifications', 'clicks', 'ctr', 'clickedToday']) {
        assert.equal(typeof body.push[key], 'number', `push.${key}`)
    }

    assert.ok(body.metrics, 'в ответе есть metrics')
    assert.equal(body.metrics.items.length, 12)
    assert.deepEqual(body.metrics.items.map(item => item.id), METRIC_IDS)
    assert.equal(body.metrics.summary.total, 12)
    assert.equal(
        body.metrics.summary.measured + body.metrics.summary.partial + body.metrics.summary.unavailable,
        12
    )
    const activation = body.metrics.items.find(item => item.id === 'activation')
    assert.equal(activation.value, 50, 'активация считается и через контроллер')
    const aiCost = body.metrics.items.find(item => item.id === 'ai_cost')
    assert.equal(aiCost.status, 'partial', 'с пустым REDIS_URL телеметрии нет → partial, не «0 ₽»')
    assert.equal(aiCost.value, null)
    assert.match(aiCost.detail, /нет телеметрии ИИ/)
})

test('buildProductMetricsBoard: без product_events метрики деградируют, а не падают', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const [{ buildProductMetricsBoard }, { resetAdminSchemaCache }] = await Promise.all([
        import('../services/productMetricsService.js'),
        import('../utils/adminSchema.js')
    ])

    await sequelize.query('ALTER TABLE product_events RENAME TO product_events_pm_hidden')
    resetAdminSchemaCache()
    let board
    try {
        board = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4, aiRequests: 12 })
    } finally {
        await sequelize.query('ALTER TABLE product_events_pm_hidden RENAME TO product_events')
        resetAdminSchemaCache()
    }

    assert.deepEqual(board.summary, { total: 12, measured: 8, partial: 1, unavailable: 3 })
    assert.equal(itemById(board, 'ttfv').status, 'unavailable')
    assert.equal(itemById(board, 'ttfv').display, '—')
    assert.equal(itemById(board, 'ai_usage').status, 'unavailable')
    assert.equal(itemById(board, 'ai_cost').status, 'unavailable')
    assert.equal(itemById(board, 'activation').value, 50)
    assert.equal(itemById(board, 'd7').value, 25, 'без событий остаётся возврат по site_visit_days')
    assert.equal(itemById(board, 'd30').value, 0)
    assert.equal(itemById(board, 'push_ctr').value, 66.7)
    assert.equal(itemById(board, 'returns_no_push').value, 33.3)
    assert.equal(itemById(board, 'premium').status, 'partial')

    const share = itemById(board, 'share_organic')
    assert.equal(share.status, 'measured')
    assert.equal(share.value, 0)
    assert.equal(share.display, '0%')
    assert.equal(share.detail, 'регистрации из шаринга 0 из 8; просмотров сада 0')
})

test('buildProductMetricsBoard: без таблиц шаринга share_organic деградирует в partial', { skip }, async () => {
    const { sequelize } = await getContext()
    await seedMetricsFixture(sequelize)

    const [{ buildProductMetricsBoard }, { resetAdminSchemaCache }] = await Promise.all([
        import('../services/productMetricsService.js'),
        import('../utils/adminSchema.js')
    ])

    await sequelize.query('ALTER TABLE garden_share_signups RENAME TO garden_share_signups_pm_hidden')
    await sequelize.query('ALTER TABLE garden_shares RENAME TO garden_shares_pm_hidden')
    resetAdminSchemaCache()
    let board
    try {
        board = await buildProductMetricsBoard({ days: PERIOD_DAYS, aiCost: 0.4, aiRequests: 12 })
    } finally {
        await sequelize.query('ALTER TABLE garden_shares_pm_hidden RENAME TO garden_shares')
        await sequelize.query('ALTER TABLE garden_share_signups_pm_hidden RENAME TO garden_share_signups')
        resetAdminSchemaCache()
    }

    const share = itemById(board, 'share_organic')
    assert.equal(share.status, 'partial')
    assert.equal(share.value, null)
    assert.equal(share.display, '—')
    assert.equal(share.detail, 'шаринг не внедрён: нет таблиц garden_shares/garden_share_signups')
    assert.deepEqual(board.summary, { total: 12, measured: 10, partial: 2, unavailable: 0 })
})
