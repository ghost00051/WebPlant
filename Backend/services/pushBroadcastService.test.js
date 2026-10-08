import assert from 'node:assert/strict'
import test from 'node:test'
import { Op } from 'sequelize'
import PushBroadcast from '../models/PushBroadcast.js'
import PushBroadcastRecipient from '../models/PushBroadcastRecipient.js'
import PushSubscription from '../models/PushSubscription.js'
import pushService from './pushService.js'
import pushBroadcastService from './pushBroadcastService.js'

const sequelize = PushBroadcast.sequelize

const originals = {
    broadcastUpdate: PushBroadcast.update,
    broadcastFindByPk: PushBroadcast.findByPk,
    broadcastCreate: PushBroadcast.create,
    recipientFindAll: PushBroadcastRecipient.findAll,
    recipientBulkCreate: PushBroadcastRecipient.bulkCreate,
    subscriptionFindAll: PushSubscription.findAll,
    subscriptionCount: PushSubscription.count,
    sendToSubscriptions: pushService.sendToSubscriptions,
    transaction: sequelize.transaction
}

test.after(() => {
    PushBroadcast.update = originals.broadcastUpdate
    PushBroadcast.findByPk = originals.broadcastFindByPk
    PushBroadcast.create = originals.broadcastCreate
    PushBroadcastRecipient.findAll = originals.recipientFindAll
    PushBroadcastRecipient.bulkCreate = originals.recipientBulkCreate
    PushSubscription.findAll = originals.subscriptionFindAll
    PushSubscription.count = originals.subscriptionCount
    pushService.sendToSubscriptions = originals.sendToSubscriptions
    sequelize.transaction = originals.transaction
})

function fakeBroadcast(overrides = {}) {
    return {
        id: 9,
        status: 'sending',
        target_mode: 'all',
        include_guests: false,
        title: 'Заголовок',
        body: 'Текст',
        icon: null,
        url: '/home',
        ...overrides
    }
}

test('buildSubscriptionWhere selects explicit users and never guests', () => {
    const where = pushBroadcastService.buildSubscriptionWhere({
        targetMode: 'users',
        userIds: [3, 7],
        includeGuests: true
    })

    assert.deepEqual(Object.keys(where), ['user_id'])
    assert.deepEqual(where.user_id[Op.in], [3, 7])
})

test('buildSubscriptionWhere returns an empty filter for all including guests', () => {
    const where = pushBroadcastService.buildSubscriptionWhere({
        targetMode: 'all',
        includeGuests: true
    })

    assert.deepEqual(where, {})
})

test('buildSubscriptionWhere excludes guests for all without guests', () => {
    const where = pushBroadcastService.buildSubscriptionWhere({
        targetMode: 'all',
        includeGuests: false
    })

    assert.deepEqual(Object.keys(where), ['user_id'])
    assert.equal(where.user_id[Op.ne], null)
})

test('sendBroadcast does nothing when the broadcast is not sending', async () => {
    PushBroadcast.findByPk = async () => fakeBroadcast({ id: 4, status: 'sent' })
    let sendCalled = false
    pushService.sendToSubscriptions = async () => {
        sendCalled = true
        return { total: 1, sent: 1, failed: 0, removed: 0 }
    }

    const { result } = await pushBroadcastService.sendBroadcast(4)

    assert.equal(result, null)
    assert.equal(sendCalled, false)
})

test('sendBroadcast returns a null result for a missing broadcast', async () => {
    PushBroadcast.findByPk = async () => null
    let sendCalled = false
    pushService.sendToSubscriptions = async () => {
        sendCalled = true
        return { total: 1, sent: 1, failed: 0, removed: 0 }
    }

    const { broadcast, result } = await pushBroadcastService.sendBroadcast(404)

    assert.equal(broadcast, null)
    assert.equal(result, null)
    assert.equal(sendCalled, false)
})

test('sendBroadcast sends to all subscribed users and stores counters', async () => {
    const broadcast = fakeBroadcast()
    PushBroadcast.findByPk = async () => broadcast

    let subscriptionWhere
    PushSubscription.findAll = async options => {
        subscriptionWhere = options.where
        return [{ id: 1 }, { id: 2 }, { id: 3 }]
    }

    let sendArgs
    pushService.sendToSubscriptions = async (...args) => {
        sendArgs = args
        return { success: true, total: 3, sent: 2, failed: 1, removed: 1 }
    }

    let updateArgs
    PushBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    const now = new Date('2026-10-09T12:00:00.000Z')
    const { broadcast: updated, result } = await pushBroadcastService.sendBroadcast(9, { now })

    assert.equal(result.sent, 2)
    assert.equal(sendArgs[1], 'Заголовок')
    assert.equal(sendArgs[2], 'Текст')
    assert.equal(sendArgs[3], '/icons/icon-192.png')
    assert.deepEqual(sendArgs[4], { url: '/home' })
    assert.deepEqual(Object.keys(subscriptionWhere), ['user_id'])
    assert.equal(subscriptionWhere.user_id[Op.ne], null)

    assert.deepEqual(updateArgs.options, { where: { id: 9 } })
    assert.equal(updateArgs.values.status, 'sent')
    assert.equal(updateArgs.values.total_subscriptions, 3)
    assert.equal(updateArgs.values.sent_count, 2)
    assert.equal(updateArgs.values.failed_count, 1)
    assert.equal(updateArgs.values.removed_count, 1)
    assert.deepEqual(updateArgs.values.sent_at, now)

    assert.equal(updated.status, 'sent')
    assert.equal(updated.sent_count, 2)
})

test('sendBroadcast marks the broadcast as failed when nothing was delivered', async () => {
    PushBroadcast.findByPk = async () => fakeBroadcast({ id: 12 })
    PushSubscription.findAll = async () => [{ id: 1 }, { id: 2 }]
    pushService.sendToSubscriptions = async () => ({
        success: false,
        total: 2,
        sent: 0,
        failed: 2,
        removed: 0
    })

    let updateArgs
    PushBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    const { result } = await pushBroadcastService.sendBroadcast(12)

    assert.equal(result.sent, 0)
    assert.equal(updateArgs.values.status, 'failed')
    assert.equal(updateArgs.values.sent_count, 0)
    assert.equal(updateArgs.values.failed_count, 2)
})

test('sendBroadcast resolves recipients for users mode and keeps the custom icon', async () => {
    PushBroadcast.findByPk = async () => fakeBroadcast({
        id: 21,
        target_mode: 'users',
        include_guests: false,
        icon: '/icons/custom.png'
    })
    PushBroadcastRecipient.findAll = async () => [{ user_id: 5 }, { user_id: 6 }]

    let subscriptionWhere
    PushSubscription.findAll = async options => {
        subscriptionWhere = options.where
        return []
    }

    let sendArgs
    pushService.sendToSubscriptions = async (...args) => {
        sendArgs = args
        return { success: false, total: 0, sent: 0, failed: 0, removed: 0 }
    }
    PushBroadcast.update = async () => [1]

    await pushBroadcastService.sendBroadcast(21)

    assert.deepEqual(subscriptionWhere.user_id[Op.in], [5, 6])
    assert.equal(sendArgs[3], '/icons/custom.png')
})

test('createBroadcast rejects invalid payloads before touching the database', async () => {
    let transactionCalled = false
    sequelize.transaction = async () => {
        transactionCalled = true
    }

    await assert.rejects(
        () => pushBroadcastService.createBroadcast({ payload: { title: '', body: 'ok' } }),
        /Укажите заголовок/
    )
    await assert.rejects(
        () => pushBroadcastService.createBroadcast({
            payload: { title: 'ok', body: 'ok', targetMode: 'users', userIds: [] }
        }),
        /Выберите хотя бы одного получателя/
    )
    await assert.rejects(
        () => pushBroadcastService.createBroadcast({
            payload: { title: 'ok', body: 'ok', scheduledFor: new Date(Date.now() - 60_000).toISOString() }
        }),
        /Время отправки должно быть в будущем/
    )

    assert.equal(transactionCalled, false)
})

test('createBroadcast stores recipients and skips sending for future schedules', async () => {
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
    PushSubscription.count = async options => {
        countWhere = options.where
        assert.equal(options.transaction, 'transaction')
        return 4
    }
    PushBroadcast.create = async (values, options) => {
        assert.equal(options.transaction, 'transaction')
        createdValues = values
        return { id: 33, ...values }
    }
    PushBroadcastRecipient.bulkCreate = async (rows, options) => {
        assert.equal(options.transaction, 'transaction')
        bulkRows = rows
        return rows
    }
    PushBroadcast.findByPk = async () => {
        throw new Error('sendBroadcast must not run for a scheduled broadcast')
    }
    pushService.sendToSubscriptions = async () => {
        sendCalled = true
        return { sent: 1 }
    }

    const outcome = await pushBroadcastService.createBroadcast({
        adminId: 7,
        payload: {
            title: 'Заголовок',
            body: 'Текст',
            targetMode: 'users',
            userIds: ['2', 2, 3],
            scheduledFor: scheduledFor.toISOString()
        }
    })

    assert.equal(transactionCommitted, true)
    assert.equal(sendCalled, false)
    assert.equal(outcome.sentResult, null)
    assert.equal(outcome.broadcast.id, 33)
    assert.equal(createdValues.status, 'pending')
    assert.deepEqual(createdValues.scheduled_for, scheduledFor)
    assert.equal(createdValues.total_subscriptions, 4)
    assert.equal(createdValues.created_by, 7)
    assert.equal(createdValues.target_mode, 'users')
    assert.deepEqual(countWhere.user_id[Op.in], [2, 3])
    assert.deepEqual(bulkRows, [
        { broadcast_id: 33, user_id: 2 },
        { broadcast_id: 33, user_id: 3 }
    ])
    assert.equal(outcome.recipients.length, 2)
})

test('createBroadcast sends immediately and returns the push result', async () => {
    let createdValues
    sequelize.transaction = async callback => callback('transaction')
    PushSubscription.count = async () => 2
    PushBroadcast.create = async values => {
        createdValues = values
        return { id: 44, ...values }
    }
    PushBroadcast.findByPk = async () => fakeBroadcast({ id: 44 })
    PushSubscription.findAll = async () => [{ id: 1 }, { id: 2 }]
    pushService.sendToSubscriptions = async () => ({
        success: true,
        total: 2,
        sent: 2,
        failed: 0,
        removed: 0
    })
    PushBroadcast.update = async () => [1]

    const outcome = await pushBroadcastService.createBroadcast({
        payload: { title: 'Сразу', body: 'Текст' }
    })

    assert.equal(createdValues.status, 'sending')
    assert.equal(createdValues.scheduled_for, null)
    assert.equal(outcome.sentResult.sent, 2)
    assert.equal(outcome.broadcast.status, 'sent')
    assert.deepEqual(outcome.recipients, [])
})

test('cancelBroadcast only cancels pending records', async () => {
    let updateArgs
    PushBroadcast.update = async (values, options) => {
        updateArgs = { values, options }
        return [1]
    }

    assert.deepEqual(await pushBroadcastService.cancelBroadcast(5), { canceled: true })
    assert.deepEqual(updateArgs.values, { status: 'canceled' })
    assert.deepEqual(updateArgs.options, { where: { id: 5, status: 'pending' } })

    PushBroadcast.update = async () => [0]
    assert.deepEqual(await pushBroadcastService.cancelBroadcast(6), { canceled: false })
})

test('listPendingDue filters by status and schedule', async () => {
    let findAllOptions
    PushBroadcast.findAll = async options => {
        findAllOptions = options
        return []
    }

    const now = new Date('2026-10-09T12:00:00.000Z')
    await pushBroadcastService.listPendingDue({ now, limit: 5 })

    assert.equal(findAllOptions.where.status, 'pending')
    assert.equal(findAllOptions.where[Op.or][0].scheduled_for, null)
    assert.deepEqual(findAllOptions.where[Op.or][1].scheduled_for[Op.lte], now)
    assert.deepEqual(findAllOptions.order, [['scheduled_for', 'ASC']])
    assert.equal(findAllOptions.limit, 5)
})
