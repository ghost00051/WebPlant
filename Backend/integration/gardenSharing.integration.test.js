import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'

import { applyMigrations } from './helpers/migrations.js'

process.env.REDIS_URL = ''
delete process.env.REDIS_HOST
process.env.SMTP_USER = ''
process.env.SMTP_PASSWORD = ''

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1'
const SKIP_REASON = 'интеграционный тест шаринга сада выключен: RUN_INTEGRATION=1 не задан (нужны Postgres и psql)'

const skip = RUN_INTEGRATION ? false : SKIP_REASON

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

        const { default: UserLegalConsent } = await import('../models/userLegalConsentModels.js')
        await UserLegalConsent.sync()

        const [
            { default: User },
            { default: Plant },
            { default: GardenShare },
            { default: GardenShareSignup },
            gardenShareService,
            shareTokens
        ] = await Promise.all([
            import('../models/userModels.js'),
            import('../models/Plant.js'),
            import('../models/GardenShare.js'),
            import('../models/GardenShareSignup.js'),
            import('../services/gardenShareService.js'),
            import('../utils/shareTokens.js')
        ])

        return {
            sequelize,
            User,
            Plant,
            GardenShare,
            GardenShareSignup,
            gardenShareService,
            shareTokens
        }
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

function uniqueEmail(prefix) {
    return `${prefix}-${randomUUID()}@integration.test`
}

async function resetDatabase(sequelize) {
    await sequelize.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE')
}

function createResponse() {
    const headers = new Map()
    const cookies = []
    return {
        statusCode: 200,
        body: null,
        headers,
        cookies,
        set(name, value) {
            headers.set(name, value)
            return this
        },
        setHeader(name, value) {
            headers.set(name, value)
        },
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        },
        cookie(name, value, options) {
            cookies.push({ name, value, options })
        },
        clearCookie(name, options) {
            cookies.push({ name, value: null, options, cleared: true })
        }
    }
}

function itemById(board, id) {
    return board.items.find(item => item.id === id)
}

test('createOrGetShare идемпотентен, публичный сад безопасен и считает просмотры', { skip }, async () => {
    const {
        sequelize,
        User,
        Plant,
        GardenShare,
        gardenShareService: {
            createOrGetShare,
            getShareStatus,
            getPublicGarden,
            revokeShare
        }
    } = await getContext()
    await resetDatabase(sequelize)

    const owner = await User.create({
        email: uniqueEmail('garden-owner'),
        password: 'integration-test',
        name: 'Иван Садовников',
        username: 'garden_owner'
    })

    const now = Date.now()
    const monstera = await Plant.create({
        user_id: owner.id,
        name: 'Монстера',
        species: 'Monstera deliciosa',
        watering_interval_days: 5,
        is_active: true,
        created_at: new Date(now - 2000)
    })
    const cactus = await Plant.create({
        user_id: owner.id,
        name: 'Кактус',
        species: null,
        watering_interval_days: 14,
        is_active: true,
        created_at: new Date(now - 1000)
    })
    await Plant.create({
        user_id: owner.id,
        name: 'Архивное растение',
        is_active: false,
        created_at: new Date(now + 1000)
    })

    const first = await createOrGetShare(owner.id)
    assert.match(first.token, /^[A-Za-z0-9_-]{16,64}$/)
    assert.equal(first.path, `/garden/${first.token}`)
    assert.equal(first.viewCount, 0)
    assert.equal(first.signupCount, 0)
    assert.ok(first.createdAt, 'createdAt должен быть ISO-строкой')

    const second = await createOrGetShare(owner.id)
    assert.equal(second.token, first.token, 'повторный POST возвращает текущую ссылку')
    assert.equal(await GardenShare.count({ where: { user_id: owner.id, revoked_at: null } }), 1)

    const status = await getShareStatus(owner.id)
    assert.equal(status.token, first.token)
    assert.equal(status.path, `/garden/${first.token}`)

    const garden = await getPublicGarden(first.token)
    assert.ok(garden, 'активная ссылка должна отдавать сад')
    assert.equal(garden.token, first.token)
    assert.equal(garden.ownerName, 'Иван', 'ownerName — первый токен users.name')
    assert.equal(garden.plantCount, 2, 'считаются только активные растения')
    assert.deepEqual(garden.plants.map(plant => plant.name), ['Монстера', 'Кактус'])
    assert.deepEqual(garden.plants[0], {
        id: monstera.id,
        name: 'Монстера',
        species: 'Monstera deliciosa',
        intervalDays: 5
    })
    assert.deepEqual(garden.plants[1], {
        id: cactus.id,
        name: 'Кактус',
        species: null,
        intervalDays: 14
    })
    assert.ok(garden.sharedAt)
    assert.equal(garden.viewCount, 1, 'первый просмотр инкрементирует view_count')

    const payload = JSON.stringify(garden)
    assert.ok(!payload.includes(owner.email), 'email владельца не должен утекать')
    assert.ok(!payload.includes('email'), 'в публичном ответе нет поля email')
    assert.ok(!payload.includes('user_id'), 'в публичном ответе нет user_id')
    assert.ok(!payload.includes('photo'), 'в публичном ответе нет фотографий')
    for (const plant of garden.plants) {
        assert.deepEqual(Object.keys(plant).sort(), ['id', 'intervalDays', 'name', 'species'])
    }

    const secondView = await getPublicGarden(first.token)
    assert.equal(secondView.viewCount, 2)
    const shareRow = await GardenShare.findOne({ where: { token: first.token } })
    assert.equal(shareRow.view_count, 2, 'view_count в БД инкрементируется')
    assert.ok(shareRow.last_viewed_at, 'last_viewed_at фиксируется при просмотре')

    assert.equal(await getPublicGarden('a'.repeat(22)), null, 'неизвестный токен → null (404)')
    assert.equal(await getPublicGarden('short'), null, 'невалидный формат → null (404)')
    assert.equal(await getPublicGarden(undefined), null)
    assert.equal(await getPublicGarden('../etc/passwd'), null)

    const usernameOwner = await User.create({
        email: uniqueEmail('garden-username'),
        password: 'integration-test',
        username: 'garden_master'
    })
    const usernameShare = await createOrGetShare(usernameOwner.id)
    const usernameGarden = await getPublicGarden(usernameShare.token)
    assert.equal(usernameGarden.ownerName, 'garden_master')
    assert.equal(usernameGarden.plantCount, 0)
    assert.deepEqual(usernameGarden.plants, [])

    const anonymousOwner = await User.create({
        email: uniqueEmail('garden-anonymous'),
        password: 'integration-test'
    })
    const anonymousShare = await createOrGetShare(anonymousOwner.id)
    assert.equal((await getPublicGarden(anonymousShare.token)).ownerName, 'Садовод')

    const manyOwner = await User.create({
        email: uniqueEmail('garden-many'),
        password: 'integration-test',
        name: 'МногоРастений'
    })
    await Plant.bulkCreate(Array.from({ length: 101 }, (_, index) => ({
        user_id: manyOwner.id,
        name: `Растение-${index}`,
        watering_interval_days: 7,
        is_active: true,
        created_at: new Date(now + index)
    })))
    const manyShare = await createOrGetShare(manyOwner.id)
    const manyGarden = await getPublicGarden(manyShare.token)
    assert.equal(manyGarden.plants.length, 100, 'в публичный ответ попадает не больше 100 растений')
    assert.equal(manyGarden.plantCount, 101)
    assert.equal(manyGarden.plants[0].name, 'Растение-0', 'порядок created_at ASC')
    assert.equal(manyGarden.plants[99].name, 'Растение-99')

    await revokeShare(owner.id)
    assert.equal(await getPublicGarden(first.token), null, 'после revoke публичный сад → 404')
    assert.equal(await getShareStatus(owner.id), null)
    await revokeShare(owner.id)
    await revokeShare(owner.id)

    const newShare = await createOrGetShare(owner.id)
    assert.notEqual(newShare.token, first.token, 'после revoke создаётся новая ссылка')
    assert.equal(await getShareStatus(owner.id).then(share => share.token), newShare.token)
})

test('attributeShareSignup: пишет signup, идемпотентен и не бросает исключений', { skip }, async () => {
    const {
        sequelize,
        User,
        GardenShare,
        GardenShareSignup,
        gardenShareService: { createOrGetShare, attributeShareSignup, revokeShare }
    } = await getContext()
    await resetDatabase(sequelize)

    const owner = await User.create({
        email: uniqueEmail('attr-owner'),
        password: 'integration-test',
        name: 'Владелец'
    })
    const share = await createOrGetShare(owner.id)
    const shareRow = await GardenShare.findOne({ where: { token: share.token } })

    const newcomer = await User.create({
        email: uniqueEmail('attr-newcomer'),
        password: 'integration-test'
    })

    assert.equal(await attributeShareSignup(newcomer.id, share.token), true)
    assert.equal(await GardenShareSignup.count({ where: { user_id: newcomer.id } }), 1)

    assert.equal(await attributeShareSignup(newcomer.id, share.token), false, 'повтор не дублирует signup')
    assert.equal(await GardenShareSignup.count({ where: { user_id: newcomer.id } }), 1)

    assert.equal(await attributeShareSignup(newcomer.id, 'a'.repeat(22)), false, 'неизвестный токен игнорируется')
    assert.equal(await attributeShareSignup(newcomer.id, 'broken'), false, 'битый токен игнорируется')
    assert.equal(await attributeShareSignup(newcomer.id, null), false)
    assert.equal(await attributeShareSignup(null, share.token), false, 'некорректный userId не ломает вызов')

    const transactional = await User.create({
        email: uniqueEmail('attr-tx'),
        password: 'integration-test'
    })
    await sequelize.transaction(async transaction => {
        assert.equal(
            await attributeShareSignup(transactional.id, share.token, { transaction }),
            true
        )
    })
    const signup = await GardenShareSignup.findOne({ where: { user_id: transactional.id } })
    assert.ok(signup, 'signup внутри транзакции коммитится')
    assert.equal(signup.share_id, shareRow.id)

    const afterRevoke = await User.create({
        email: uniqueEmail('attr-revoked'),
        password: 'integration-test'
    })
    await revokeShare(owner.id)
    assert.equal(await attributeShareSignup(afterRevoke.id, share.token), false, 'отозванная ссылка не атрибутируется')
    assert.equal(await GardenShareSignup.count({ where: { user_id: afterRevoke.id } }), 0)
})

test('registration с shareToken атрибутирует регистрацию и делает метрику measured', { skip }, async () => {
    const {
        sequelize,
        User,
        GardenShareSignup,
        gardenShareService: { createOrGetShare, getShareStatus, revokeShare },
        shareTokens: { generateShareToken }
    } = await getContext()
    await resetDatabase(sequelize)

    const owner = await User.create({
        email: uniqueEmail('reg-owner'),
        password: 'integration-test',
        name: 'Владелец Сада'
    })
    const share = await createOrGetShare(owner.id)

    const { default: userController } = await import('../controllers/userController.js')
    const { default: UserLegalConsent } = await import('../models/userLegalConsentModels.js')

    const email = uniqueEmail('reg-shared')
    const sharedRes = createResponse()
    await userController.registration({
        body: {
            email,
            password: 'GardenPass123',
            name: 'Пришедший Из Шаринга',
            privacyPolicyAccepted: true,
            termsAccepted: true,
            shareToken: share.token
        },
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    }, sharedRes)
    assert.equal(sharedRes.statusCode, 201, `регистрация: ${JSON.stringify(sharedRes.body)}`)

    const sharedUser = await User.findOne({ where: { email: email.toLowerCase() } })
    assert.ok(sharedUser)
    const signup = await GardenShareSignup.findOne({ where: { user_id: sharedUser.id } })
    assert.ok(signup, 'регистрация должна попасть в garden_share_signups')
    assert.ok(Number.isInteger(signup.share_id) && signup.share_id > 0)
    const sharedStatus = await getShareStatus(owner.id)
    assert.equal(sharedStatus.token, share.token)
    assert.equal(sharedStatus.signupCount, 1)
    assert.equal(await UserLegalConsent.count({ where: { user_id: sharedUser.id } }), 2)

    const duplicateRes = createResponse()
    await userController.registration({
        body: {
            email,
            password: 'GardenPass123',
            privacyPolicyAccepted: true,
            termsAccepted: true,
            shareToken: share.token
        },
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    }, duplicateRes)
    assert.equal(duplicateRes.statusCode, 409)
    assert.equal(await GardenShareSignup.count({ where: { user_id: sharedUser.id } }), 1)

    const unknownEmail = uniqueEmail('reg-unknown')
    const unknownRes = createResponse()
    await userController.registration({
        body: {
            email: unknownEmail,
            password: 'GardenPass123',
            privacyPolicyAccepted: true,
            termsAccepted: true,
            shareToken: generateShareToken()
        },
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    }, unknownRes)
    assert.equal(unknownRes.statusCode, 201, 'неизвестный токен не ломает регистрацию')
    const unknownUser = await User.findOne({ where: { email: unknownEmail.toLowerCase() } })
    assert.equal(await GardenShareSignup.count({ where: { user_id: unknownUser.id } }), 0)

    const invalidRes = createResponse()
    await userController.registration({
        body: {
            email: uniqueEmail('reg-invalid'),
            password: 'GardenPass123',
            privacyPolicyAccepted: true,
            termsAccepted: true,
            shareToken: 'not-a-valid-token!'
        },
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    }, invalidRes)
    assert.equal(invalidRes.statusCode, 400, 'неверный формат shareToken → 400')

    await revokeShare(owner.id)
    const revokedEmail = uniqueEmail('reg-revoked')
    const revokedRes = createResponse()
    await userController.registration({
        body: {
            email: revokedEmail,
            password: 'GardenPass123',
            privacyPolicyAccepted: true,
            termsAccepted: true,
            shareToken: share.token
        },
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    }, revokedRes)
    assert.equal(revokedRes.statusCode, 201)
    const revokedUser = await User.findOne({ where: { email: revokedEmail.toLowerCase() } })
    assert.equal(await GardenShareSignup.count({ where: { user_id: revokedUser.id } }), 0)

    const { buildProductMetricsBoard } = await import('../services/productMetricsService.js')
    const board = await buildProductMetricsBoard({ days: 30 })
    assert.deepEqual(board.items.map(item => item.id), METRIC_IDS)
    const shareMetric = itemById(board, 'share_organic')
    assert.equal(shareMetric.status, 'measured', 'метрика измеряется по garden_share_signups')
    assert.equal(shareMetric.value, 25, '1 атрибутированная регистрация из 4 за период')
    assert.equal(shareMetric.display, '25%')
    assert.equal(shareMetric.targetMet, true)
    assert.equal(
        shareMetric.detail,
        'регистрации из шаринга 1 из 4; просмотров сада 0; кликов «Поделиться» 0'
    )
})

test('контроллеры ссылки: {share:null}, 404 и no-store, идемпотентный DELETE', { skip }, async () => {
    const {
        sequelize,
        User,
        gardenShareService: { createOrGetShare }
    } = await getContext()
    await resetDatabase(sequelize)

    const owner = await User.create({
        email: uniqueEmail('ctrl-owner'),
        password: 'integration-test',
        name: 'Анна'
    })
    const { default: controller } = await import('../controllers/gardenShareController.js')

    let res = createResponse()
    await controller.status({ user: owner }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { share: null }, 'без активной ссылки GET /api/garden/share → { share: null }')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    res = createResponse()
    await controller.getPublic({ params: { token: 'invalid-token' } }, res)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.body, { message: 'Сад не найден или ссылка отозвана' })
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    res = createResponse()
    await controller.create({ user: owner }, res)
    assert.equal(res.statusCode, 200)
    assert.match(res.body.share.token, /^[A-Za-z0-9_-]{16,64}$/)
    assert.equal(res.headers.get('Cache-Control'), 'no-store', 'POST /share тоже no-store')
    const token = res.body.share.token

    res = createResponse()
    await controller.create({ user: owner }, res)
    assert.equal(res.body.share.token, token, 'POST идемпотентен')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    res = createResponse()
    await controller.status({ user: owner }, res)
    assert.equal(res.body.share.token, token)
    assert.equal(res.body.share.signupCount, 0)
    assert.equal(res.body.share.viewCount, 0)

    res = createResponse()
    await controller.getPublic({ params: { token } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.garden.ownerName, 'Анна')
    assert.equal(res.body.garden.viewCount, 1)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    res = createResponse()
    await controller.revoke({ user: owner }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { share: null, revoked: true })
    assert.equal(res.headers.get('Cache-Control'), 'no-store', 'DELETE /share тоже no-store')

    res = createResponse()
    await controller.revoke({ user: owner }, res)
    assert.equal(res.statusCode, 200, 'повторный DELETE идемпотентен, не 500')
    assert.deepEqual(res.body, { share: null, revoked: true })
    assert.equal(res.headers.get('Cache-Control'), 'no-store')

    res = createResponse()
    await controller.getPublic({ params: { token } }, res)
    assert.equal(res.statusCode, 404)

    res = createResponse()
    await controller.status({ user: owner }, res)
    assert.deepEqual(res.body, { share: null })

    const recreated = await createOrGetShare(owner.id)
    assert.notEqual(recreated.token, token)
})

test('активная ссылка уникальна: конкурентные createOrGetShare и частичный UNIQUE-индекс', { skip }, async () => {
    const {
        sequelize,
        User,
        GardenShare,
        gardenShareService: { createOrGetShare, getShareStatus, revokeShare },
        shareTokens: { generateShareToken }
    } = await getContext()
    await resetDatabase(sequelize)

    const owner = await User.create({
        email: uniqueEmail('race-owner'),
        password: 'integration-test',
        name: 'Гонка'
    })

    const results = await Promise.all(Array.from({ length: 5 }, () => createOrGetShare(owner.id)))
    const tokens = new Set(results.map(result => result.token))
    assert.equal(tokens.size, 1, 'конкурентные createOrGetShare возвращают одну и ту же ссылку')
    const [token] = tokens
    assert.equal(await GardenShare.count({ where: { user_id: owner.id, revoked_at: null } }), 1)
    assert.equal((await getShareStatus(owner.id)).token, token)

    await assert.rejects(
        sequelize.query(
            'INSERT INTO garden_shares (user_id, token) VALUES ($1, $2)',
            { bind: [owner.id, generateShareToken()] }
        ),
        error => error?.parent?.code === '23505' || error?.code === '23505',
        'частичный UNIQUE(user_id) WHERE revoked_at IS NULL должен запрещать вторую активную ссылку'
    )
    await assert.rejects(
        GardenShare.create({ user_id: owner.id, token: generateShareToken() }),
        error => error?.name === 'SequelizeUniqueConstraintError'
    )

    const revoked = await GardenShare.create({
        user_id: owner.id,
        token: generateShareToken(),
        revoked_at: new Date()
    })
    assert.ok(revoked.id)
    await revoked.destroy()

    await revokeShare(owner.id)
    const recreated = await createOrGetShare(owner.id)
    assert.notEqual(recreated.token, token)
    assert.equal(await GardenShare.count({ where: { user_id: owner.id, revoked_at: null } }), 1)
})
