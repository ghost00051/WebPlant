import assert from 'node:assert/strict'
import test from 'node:test'
import { Op } from 'sequelize'
import MailBroadcast from '../models/MailBroadcast.js'
import MailBroadcastRecipient from '../models/MailBroadcastRecipient.js'
import User from '../models/userModels.js'
import mailBroadcastService, {
    normalizeEmail,
    readMailBroadcastSettings
} from './mailBroadcastService.js'

const sequelize = MailBroadcast.sequelize

const originals = {
    broadcastUpdate: MailBroadcast.update,
    broadcastFindAll: MailBroadcast.findAll,
    broadcastFindByPk: MailBroadcast.findByPk,
    broadcastCreate: MailBroadcast.create,
    recipientFindAll: MailBroadcastRecipient.findAll,
    recipientCount: MailBroadcastRecipient.count,
    recipientBulkCreate: MailBroadcastRecipient.bulkCreate,
    userCount: User.count,
    userFindAll: User.findAll,
    userFindAndCountAll: User.findAndCountAll,
    sendEmail: mailBroadcastService.sendEmail,
    transaction: sequelize.transaction
}

test.after(() => {
    MailBroadcast.update = originals.broadcastUpdate
    MailBroadcast.findAll = originals.broadcastFindAll
    MailBroadcast.findByPk = originals.broadcastFindByPk
    MailBroadcast.create = originals.broadcastCreate
    MailBroadcastRecipient.findAll = originals.recipientFindAll
    MailBroadcastRecipient.count = originals.recipientCount
    MailBroadcastRecipient.bulkCreate = originals.recipientBulkCreate
    User.count = originals.userCount
    User.findAll = originals.userFindAll
    User.findAndCountAll = originals.userFindAndCountAll
    mailBroadcastService.sendEmail = originals.sendEmail
    sequelize.transaction = originals.transaction
})

function fakeBroadcast(overrides = {}) {
    return {
        id: 9,
        status: 'sending',
        target_mode: 'all',
        subject: 'Тема письма',
        body: 'Текст письма',
        cta_label: null,
        cta_url: null,
        total_recipients: 0,
        ...overrides
    }
}

function fakeRecipient(overrides = {}) {
    return {
        id: 1,
        broadcast_id: 9,
        user_id: 1,
        email: 'user@example.com',
        status: 'pending',
        attempts: 0,
        updates: [],
        async update(values) {
            Object.assign(this, values)
            this.updates.push(values)
            return this
        },
        ...overrides
    }
}

// findAll у получателей вызывается дважды: за очередью и за счётчиками.
// Различаем их по group — счётчики всегда приходят с группировкой.
function stubRecipientQueries({ pending = [], counters = {}, total = null } = {}) {
    MailBroadcastRecipient.findAll = async options => {
        if (options.group) {
            return Object.entries(counters).map(([status, count]) => ({ status, count }))
        }
        return pending
    }
    MailBroadcastRecipient.count = async () => (total === null ? pending.length : total)
}

function stubRecipientNames(users = []) {
    User.findAll = async () => users
}

function statusCounts(sent = 0, failed = 0, skipped = 0, pending = 0) {
    return { sent, failed, skipped, pending }
}

test('buildRecipientWhere выбирает конкретных пользователей', () => {
    const where = mailBroadcastService.buildRecipientWhere({
        targetMode: 'users',
        userIds: [3, 7]
    })

    assert.deepEqual(Object.keys(where), ['id'])
    assert.deepEqual(where.id[Op.in], [3, 7])
})

test('buildRecipientWhere без фильтра рассылает всем', () => {
    assert.deepEqual(mailBroadcastService.buildRecipientWhere({ targetMode: 'all' }), {})
})

test('normalizeEmail отбрасывает пустые и некорректные адреса', () => {
    assert.equal(normalizeEmail('  anna@mail.ru  '), 'anna@mail.ru')
    assert.equal(normalizeEmail(''), '')
    assert.equal(normalizeEmail('   '), '')
    assert.equal(normalizeEmail('не-адрес'), '')
    assert.equal(normalizeEmail('anna@mail'), '')
    assert.equal(normalizeEmail(null), '')
    assert.equal(normalizeEmail(`${'a'.repeat(250)}@mail.ru`), '')
})

test('readMailBroadcastSettings берёт значения из окружения с запасными', () => {
    const defaults = readMailBroadcastSettings({})
    assert.equal(defaults.delayMs, 200)
    assert.equal(defaults.batchSize, 100)
    assert.equal(defaults.syncBatchSize, 25)

    const custom = readMailBroadcastSettings({
        MAIL_BROADCAST_DELAY_MS: '50',
        MAIL_BROADCAST_BATCH_SIZE: '500',
        MAIL_BROADCAST_SYNC_BATCH: '10'
    })
    assert.equal(custom.delayMs, 50)
    assert.equal(custom.batchSize, 500)
    assert.equal(custom.syncBatchSize, 10)

    const broken = readMailBroadcastSettings({
        MAIL_BROADCAST_DELAY_MS: '-5',
        MAIL_BROADCAST_BATCH_SIZE: '999999'
    })
    assert.equal(broken.delayMs, 200)
    assert.equal(broken.batchSize, 1000)
})

test('sendBroadcast ничего не делает, если рассылка не в статусе отправки', async () => {
    MailBroadcast.findByPk = async () => fakeBroadcast({ id: 4, status: 'sent' })
    let sendCalled = false
    mailBroadcastService.sendEmail = async () => {
        sendCalled = true
    }

    const { result } = await mailBroadcastService.sendBroadcast(4)

    assert.equal(result, null)
    assert.equal(sendCalled, false)
})

test('sendBroadcast возвращает null для несуществующей рассылки', async () => {
    MailBroadcast.findByPk = async () => null
    let sendCalled = false
    mailBroadcastService.sendEmail = async () => {
        sendCalled = true
    }

    const { broadcast, result } = await mailBroadcastService.sendBroadcast(404)

    assert.equal(broadcast, null)
    assert.equal(result, null)
    assert.equal(sendCalled, false)
})

test('sendBroadcast отправляет порцию, пишет письма и сохраняет счётчики', async () => {
    const broadcast = fakeBroadcast()
    MailBroadcast.findByPk = async () => broadcast

    const first = fakeRecipient({ id: 1, user_id: 1, email: 'anna@mail.ru' })
    const second = fakeRecipient({ id: 2, user_id: 2, email: 'ivan@mail.ru' })
    stubRecipientQueries({
        pending: [first, second],
        counters: statusCounts(2),
        total: 2
    })
    stubRecipientNames([{ id: 1, name: 'Анна' }, { id: 2, name: 'Иван Петров' }])

    const letters = []
    mailBroadcastService.sendEmail = async message => {
        letters.push(message)
    }

    let updateArgs
    MailBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    const now = new Date('2026-10-14T12:00:00.000Z')
    const { result, broadcast: updated } = await mailBroadcastService.sendBroadcast(9, {
        now,
        delayMs: 0
    })

    assert.deepEqual(letters, [
        {
            to: 'anna@mail.ru',
            userName: 'Анна',
            subject: 'Тема письма',
            body: 'Текст письма',
            ctaLabel: '',
            ctaUrl: ''
        },
        {
            to: 'ivan@mail.ru',
            userName: 'Иван',
            subject: 'Тема письма',
            body: 'Текст письма',
            ctaLabel: '',
            ctaUrl: ''
        }
    ])

    assert.deepEqual(first.updates, [{ status: 'sent', attempts: 1, error: null, sent_at: now }])
    assert.equal(result.total, 2)
    assert.equal(result.sent, 2)
    assert.equal(result.remaining, 0)
    assert.equal(result.done, true)

    assert.deepEqual(updateArgs.options, { where: { id: 9 } })
    assert.equal(updateArgs.values.status, 'sent')
    assert.equal(updateArgs.values.total_recipients, 2)
    assert.equal(updateArgs.values.sent_count, 2)
    assert.equal(updateArgs.values.failed_count, 0)
    assert.deepEqual(updateArgs.values.sent_at, now)
    assert.equal(updated.status, 'sent')
})

test('sendBroadcast продолжает рассылку, когда писем больше порции', async () => {
    MailBroadcast.findByPk = async () => fakeBroadcast({ id: 30 })
    const only = fakeRecipient({ id: 1, user_id: 1 })
    stubRecipientQueries({
        pending: [only],
        counters: statusCounts(1, 0, 0, 4),
        total: 5
    })
    stubRecipientNames([{ id: 1, name: 'Анна' }])
    mailBroadcastService.sendEmail = async () => {}

    let updateArgs
    MailBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    const { result, broadcast } = await mailBroadcastService.sendBroadcast(30, { delayMs: 0 })

    assert.equal(result.done, false)
    assert.equal(result.remaining, 4)
    assert.equal(updateArgs.values.status, 'sending')
    assert.equal(updateArgs.values.sent_at, null)
    assert.equal(broadcast.status, 'sending')
})

test('sendBroadcast помечает письмо ошибкой и продолжает остальные', async () => {
    MailBroadcast.findByPk = async () => fakeBroadcast({ id: 41 })
    const broken = fakeRecipient({ id: 1, user_id: 1, email: 'bad@mail.ru' })
    const healthy = fakeRecipient({ id: 2, user_id: 2, email: 'good@mail.ru' })
    stubRecipientQueries({
        pending: [broken, healthy],
        counters: statusCounts(1, 1),
        total: 2
    })
    stubRecipientNames([{ id: 1, name: 'Анна' }, { id: 2, name: 'Иван' }])

    mailBroadcastService.sendEmail = async ({ to }) => {
        if (to === 'bad@mail.ru') throw new Error('SMTP: ящик не существует')
    }
    MailBroadcast.update = async () => [1]

    const { result } = await mailBroadcastService.sendBroadcast(41, { delayMs: 0 })

    assert.equal(broken.status, 'failed')
    assert.match(broken.error, /ящик не существует/)
    assert.equal(broken.attempts, 1)
    assert.equal(healthy.status, 'sent')
    assert.equal(result.failed, 1)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].email, 'bad@mail.ru')
})

test('sendBroadcast пропускает получателя, которого удалили из базы', async () => {
    MailBroadcast.findByPk = async () => fakeBroadcast({ id: 52 })
    const orphan = fakeRecipient({ id: 1, user_id: 77, email: 'gone@mail.ru' })
    stubRecipientQueries({
        pending: [orphan],
        counters: statusCounts(0, 0, 1),
        total: 1
    })
    stubRecipientNames([])

    let sendCalled = false
    mailBroadcastService.sendEmail = async () => {
        sendCalled = true
    }
    let updateArgs
    MailBroadcast.update = async values => {
        updateArgs = values
        return [1]
    }

    const { result } = await mailBroadcastService.sendBroadcast(52, { delayMs: 0 })

    assert.equal(sendCalled, false)
    assert.equal(orphan.status, 'skipped')
    assert.equal(orphan.error, 'Пользователь удалён')
    assert.equal(result.skipped, 1)
    assert.equal(updateArgs.status, 'failed')
})

test('sendBroadcast ставит failed, если не ушло ни одного письма', async () => {
    MailBroadcast.findByPk = async () => fakeBroadcast({ id: 12 })
    stubRecipientQueries({
        pending: [fakeRecipient({ id: 1 }), fakeRecipient({ id: 2, user_id: 2 })],
        counters: statusCounts(0, 2),
        total: 2
    })
    stubRecipientNames([{ id: 1, name: 'Анна' }, { id: 2, name: 'Иван' }])
    mailBroadcastService.sendEmail = async () => {
        throw new Error('SMTP недоступен')
    }

    let updateArgs
    MailBroadcast.update = async values => {
        updateArgs = values
        return [1]
    }

    const { result } = await mailBroadcastService.sendBroadcast(12, { delayMs: 0 })

    assert.equal(result.sent, 0)
    assert.equal(updateArgs.status, 'failed')
    assert.equal(updateArgs.failed_count, 2)
})

test('sendBroadcast собирает аудиторию для режима «всем»', async () => {
    const broadcast = fakeBroadcast({ id: 21, target_mode: 'all' })
    MailBroadcast.findByPk = async () => broadcast

    MailBroadcastRecipient.count = async () => 0
    User.findAll = async () => [
        { id: 5, email: 'one@mail.ru' },
        { id: 6, email: 'broken-email' },
        { id: 7, email: 'two@mail.ru' }
    ]

    let bulkRows
    MailBroadcastRecipient.bulkCreate = async (rows, options) => {
        bulkRows = { rows, options }
        return rows
    }
    MailBroadcastRecipient.findAll = async options => {
        if (options.group) return []
        return []
    }
    let updateCalled = false
    MailBroadcast.update = async () => {
        updateCalled = true
        return [1]
    }

    const { result } = await mailBroadcastService.sendBroadcast(21, { delayMs: 0 })

    assert.equal(updateCalled, true)
    assert.deepEqual(bulkRows.rows, [
        { broadcast_id: 21, user_id: 5, email: 'one@mail.ru', status: 'pending' },
        { broadcast_id: 21, user_id: 7, email: 'two@mail.ru', status: 'pending' }
    ])
    assert.equal(result.total, 0)
    assert.equal(result.done, true)
})

test('createBroadcast отклоняет некорректные данные до обращения к базе', async () => {
    let transactionCalled = false
    sequelize.transaction = async () => {
        transactionCalled = true
    }

    await assert.rejects(
        () => mailBroadcastService.createBroadcast({ payload: { subject: '', body: 'ok' } }),
        /Укажите тему письма/
    )
    await assert.rejects(
        () => mailBroadcastService.createBroadcast({ payload: { subject: 'Тема', body: '' } }),
        /Укажите текст письма/
    )
    await assert.rejects(
        () => mailBroadcastService.createBroadcast({
            payload: { subject: 'Тема', body: 'Текст', ctaLabel: 'Открыть' }
        }),
        /подпись кнопки/
    )
    await assert.rejects(
        () => mailBroadcastService.createBroadcast({
            payload: { subject: 'Тема', body: 'Текст', targetMode: 'users', userIds: [] }
        }),
        /Выберите хотя бы одного получателя/
    )
    await assert.rejects(
        () => mailBroadcastService.createBroadcast({
            payload: {
                subject: 'Тема',
                body: 'Текст',
                scheduledFor: new Date(Date.now() - 60_000).toISOString()
            }
        }),
        /Время отправки должно быть в будущем/
    )

    assert.equal(transactionCalled, false)
})

test('createBroadcast кладёт получателей в очередь и не отправляет запланированное', async () => {
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000)
    let transactionCommitted = false
    let countWhere
    let createdValues
    let bulkRows
    let sendCalled = false

    sequelize.transaction = async callback => {
        const result = await callback('transaction')
        transactionCommitted = true
        return result
    }
    User.count = async options => {
        countWhere = options.where
        assert.equal(options.transaction, 'transaction')
        return 4
    }
    User.findAll = async options => {
        assert.equal(options.transaction, 'transaction')
        return [
            { id: 2, email: 'two@mail.ru' },
            { id: 3, email: 'three@mail.ru' }
        ]
    }
    MailBroadcast.create = async (values, options) => {
        assert.equal(options.transaction, 'transaction')
        createdValues = values
        return { id: 33, ...values }
    }
    MailBroadcastRecipient.bulkCreate = async (rows, options) => {
        assert.equal(options.transaction, 'transaction')
        bulkRows = rows
        return rows
    }
    MailBroadcast.update = async (values, options) => {
        assert.equal(options.transaction, 'transaction')
        return [1]
    }
    MailBroadcast.findByPk = async () => {
        throw new Error('для запланированной рассылки отправка запускаться не должна')
    }
    mailBroadcastService.sendEmail = async () => {
        sendCalled = true
    }

    const outcome = await mailBroadcastService.createBroadcast({
        adminId: 7,
        payload: {
            subject: 'Скоро весна',
            body: 'Текст письма',
            ctaLabel: 'Открыть сад',
            ctaUrl: '/home',
            targetMode: 'users',
            userIds: ['2', 2, 3],
            scheduledFor: scheduledFor.toISOString()
        }
    })

    assert.equal(transactionCommitted, true)
    assert.equal(sendCalled, false)
    assert.equal(outcome.sentResult, null)
    assert.equal(outcome.broadcast.id, 33)
    assert.equal(outcome.broadcast.total_recipients, 2)
    assert.equal(createdValues.status, 'pending')
    assert.equal(createdValues.subject, 'Скоро весна')
    assert.equal(createdValues.cta_label, 'Открыть сад')
    assert.equal(createdValues.cta_url, '/home')
    assert.deepEqual(createdValues.scheduled_for, scheduledFor)
    assert.equal(createdValues.created_by, 7)
    assert.deepEqual(countWhere.id[Op.in], [2, 3])
    assert.deepEqual(bulkRows, [
        { broadcast_id: 33, user_id: 2, email: 'two@mail.ru', status: 'pending' },
        { broadcast_id: 33, user_id: 3, email: 'three@mail.ru', status: 'pending' }
    ])
    assert.equal(outcome.recipients.length, 2)
})

test('createBroadcast помечает немедленную рассылку как отправляемую', async () => {
    let createdValues
    sequelize.transaction = async callback => callback('transaction')
    User.count = async () => 5
    MailBroadcast.create = async values => {
        createdValues = values
        return { id: 44, ...values }
    }
    MailBroadcast.update = async () => [1]

    const outcome = await mailBroadcastService.createBroadcast({
        payload: { subject: 'Сразу', body: 'Текст' }
    })

    assert.equal(createdValues.status, 'sending')
    assert.equal(createdValues.scheduled_for, null)
    assert.equal(createdValues.target_mode, 'all')
    assert.equal(createdValues.total_recipients, 5)
    assert.equal(outcome.sentResult, null)
})

test('cancelBroadcast отменяет только запланированные рассылки', async () => {
    let updateArgs
    MailBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    assert.deepEqual(await mailBroadcastService.cancelBroadcast(5), { canceled: true })
    assert.deepEqual(updateArgs.values, { status: 'canceled' })
    assert.deepEqual(updateArgs.options, { where: { id: 5, status: 'pending' } })

    MailBroadcast.update = async () => [0]
    assert.deepEqual(await mailBroadcastService.cancelBroadcast(6), { canceled: false })
})

test('listPendingDue выбирает только наступившие рассылки', async () => {
    let findAllOptions
    MailBroadcast.findAll = async options => {
        findAllOptions = options
        return []
    }

    const now = new Date('2026-10-14T12:00:00.000Z')
    await mailBroadcastService.listPendingDue({ now, limit: 5 })

    assert.equal(findAllOptions.where.status, 'pending')
    assert.equal(findAllOptions.where[Op.or][0].scheduled_for, null)
    assert.deepEqual(findAllOptions.where[Op.or][1].scheduled_for[Op.lte], now)
    assert.deepEqual(findAllOptions.order, [['scheduled_for', 'ASC']])
    assert.equal(findAllOptions.limit, 5)
})

test('listUnfinishedSending забирает незавершённые рассылки', async () => {
    let findAllOptions
    MailBroadcast.findAll = async options => {
        findAllOptions = options
        return []
    }

    await mailBroadcastService.listUnfinishedSending({ limit: 3 })

    assert.deepEqual(findAllOptions.where, { status: 'sending' })
    assert.equal(findAllOptions.limit, 3)
})

test('failStaleSending закрывает зависшие рассылки с остатком очереди', async () => {
    const now = new Date('2026-10-14T12:00:00.000Z')
    let findAllOptions
    MailBroadcast.findAll = async options => {
        findAllOptions = options
        return [{ id: 8, created_at: new Date('2026-10-13T12:00:00.000Z') }]
    }
    MailBroadcastRecipient.count = async () => 3

    const updates = []
    MailBroadcast.update = async (values, options) => {
        updates.push({ values, options })
        return [1]
    }

    const failed = await mailBroadcastService.failStaleSending({ now })

    assert.deepEqual(failed, [8])
    assert.equal(findAllOptions.where.status, 'sending')
    assert.deepEqual(updates[0].values, { status: 'failed' })
    assert.deepEqual(updates[0].options, { where: { id: 8, status: 'sending' } })
})

test('failStaleSending не трогает рассылку без остатка очереди', async () => {
    MailBroadcast.findAll = async () => [{ id: 9, created_at: new Date('2026-10-13T12:00:00.000Z') }]
    MailBroadcastRecipient.count = async () => 0

    let updateCalled = false
    MailBroadcast.update = async () => {
        updateCalled = true
        return [1]
    }

    assert.deepEqual(await mailBroadcastService.failStaleSending(), [])
    assert.equal(updateCalled, false)
})

test('listRecipients отдаёт адреса и признак пригодности', async () => {
    let receivedOptions
    User.findAndCountAll = async options => {
        receivedOptions = options
        return {
            rows: [
                { id: 1, email: 'anna@mail.ru', name: 'Анна', username: 'anna', role: 'USER' },
                { id: 2, email: 'broken', name: null, username: null, role: 'USER' }
            ],
            count: 2
        }
    }

    const { items, total } = await mailBroadcastService.listRecipients('ан', {
        limit: 10,
        offset: 0
    })

    assert.equal(total, 2)
    assert.equal(items[0].hasEmail, true)
    assert.equal(items[1].hasEmail, false)
    assert.equal(receivedOptions.limit, 10)
    assert.equal(receivedOptions.where[Op.or][0].email[Op.iLike], '%ан%')
    assert.equal(receivedOptions.where[Op.or][0].email[Op.iLike].includes('\\'), false)
})

test('listRecipients экранирует служебные символы LIKE', async () => {
    let receivedOptions
    User.findAndCountAll = async options => {
        receivedOptions = options
        return { rows: [], count: 0 }
    }

    await mailBroadcastService.listRecipients('100%_off', { limit: 5, offset: 0 })

    assert.equal(receivedOptions.where[Op.or][0].email[Op.iLike], '%100\\%\\_off%')
})

test('countAudience считает получателей с корректными адресами', async () => {
    const counts = []
    User.count = async options => {
        counts.push(options)
        return options ? 9 : 12
    }

    const audience = await mailBroadcastService.countAudience()

    assert.deepEqual(audience, { total: 12, withEmail: 9, withoutEmail: 3 })
    assert.equal(counts[0], undefined)
    assert.ok(counts[1].where.email[Op.regexp])
})
