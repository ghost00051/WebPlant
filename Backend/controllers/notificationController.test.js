import assert from 'node:assert/strict'
import test from 'node:test'
import Notification from '../models/Notification.js'
import notificationController from './notificationController.js'

const originals = {
    findAndCountAll: Notification.findAndCountAll,
    count: Notification.count,
    update: Notification.update,
    findOne: Notification.findOne
}

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
    Object.assign(Notification, originals)
})

test('notification list is scoped to the authenticated user and returns unread count', async () => {
    let listQuery
    let countQuery
    const item = {
        id: 5,
        user_id: 42,
        type: 'watering_due',
        read_at: null,
        toJSON() {
            return {
                id: this.id,
                type: this.type,
                read_at: this.read_at
            }
        }
    }
    Notification.findAndCountAll = async query => {
        listQuery = query
        return { rows: [item], count: 23 }
    }
    Notification.count = async query => {
        countQuery = query
        return 4
    }
    const res = createResponse()

    await notificationController.list({
        user: { id: 42 },
        query: { limit: '10', offset: '10' }
    }, res)

    assert.deepEqual(listQuery.where, { user_id: 42 })
    assert.deepEqual(listQuery.order, [['created_at', 'DESC'], ['id', 'DESC']])
    assert.equal(listQuery.limit, 10)
    assert.equal(listQuery.offset, 10)
    assert.deepEqual(countQuery.where, { user_id: 42, read_at: null })
    assert.deepEqual(res.body, {
        items: [{ id: 5, type: 'watering_due', read_at: null }],
        total: 23,
        unreadCount: 4,
        limit: 10,
        offset: 10,
        nextOffset: 11
    })
})

test('notification list rejects invalid pagination parameters', async () => {
    const res = createResponse()

    await notificationController.list({
        user: { id: 42 },
        query: { limit: '51' }
    }, res)

    assert.equal(res.statusCode, 400)
})

test('unread count only counts the authenticated user notifications', async () => {
    let query
    Notification.count = async options => {
        query = options
        return 3
    }
    const res = createResponse()

    await notificationController.unreadCount({ user: { id: 42 } }, res)

    assert.deepEqual(query.where, { user_id: 42, read_at: null })
    assert.deepEqual(res.body, { unreadCount: 3 })
})

test('mark read updates an unread notification belonging to the user', async () => {
    let updateQuery
    let findQuery
    const notification = {
        toJSON: () => ({ id: 9, read_at: '2026-10-06T10:00:00.000Z' })
    }
    Notification.update = async (_values, query) => {
        updateQuery = query
        return [1]
    }
    Notification.findOne = async query => {
        findQuery = query
        return notification
    }
    const res = createResponse()

    await notificationController.markRead({
        user: { id: 42 },
        params: { id: '9' }
    }, res)

    assert.deepEqual(updateQuery.where, { id: 9, user_id: 42, read_at: null })
    assert.deepEqual(findQuery.where, { id: 9, user_id: 42 })
    assert.equal(res.body.changed, true)
    assert.deepEqual(res.body.item, { id: 9, read_at: '2026-10-06T10:00:00.000Z' })
})

test('mark read does not disclose a notification belonging to another user', async () => {
    Notification.update = async () => [0]
    Notification.findOne = async () => null
    const res = createResponse()

    await notificationController.markRead({
        user: { id: 42 },
        params: { id: '9' }
    }, res)

    assert.equal(res.statusCode, 404)
})

test('mark all read only updates unread notifications belonging to the user', async () => {
    let query
    Notification.update = async (_values, options) => {
        query = options
        return [6]
    }
    const res = createResponse()

    await notificationController.markAllRead({ user: { id: 42 } }, res)

    assert.deepEqual(query.where, { user_id: 42, read_at: null })
    assert.deepEqual(res.body, { updatedCount: 6 })
})
