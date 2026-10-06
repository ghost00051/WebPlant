import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import test from 'node:test'
import Plant from '../models/Plant.js'
import WateringLog from '../models/WateringLog.js'
import sequelize from '../db.js'
import { Op } from 'sequelize'

process.env.SECRET_KEY = 'plant-controller-tests-secret'
const { default: plantController } = await import('./plantController.js')

const originalPlantFindOne = Plant.findOne
const originalPlantFindAll = Plant.findAll
const originalWateringLogFindOne = WateringLog.findOne
const originalTransaction = sequelize.transaction

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

function setupDeletion({ latestActionId, latestWatering }) {
    const targetLog = {
        id: 12,
        scheduled_for: new Date('2026-10-05T08:00:00.000Z'),
        action_at: new Date('2026-10-05T09:00:00.000Z'),
        async destroy() {
            this.destroyed = true
        }
    }
    const updates = []
    const plant = {
        id: 4,
        next_watering_at: new Date('2026-10-12T09:00:00.000Z'),
        async update(values) {
            updates.push(values)
            Object.assign(this, values)
        }
    }

    Plant.findOne = async () => plant
    WateringLog.findOne = async ({ where }) => {
        if (where.id) return targetLog
        if (where.action === 'watered') return latestWatering
        return { id: latestActionId }
    }
    sequelize.transaction = async () => ({
        LOCK: { UPDATE: 'UPDATE' },
        finished: null,
        async commit() {
            this.finished = 'commit'
        },
        async rollback() {
            this.finished = 'rollback'
        }
    })

    return { plant, targetLog, updates }
}

test.after(() => {
    Plant.findOne = originalPlantFindOne
    Plant.findAll = originalPlantFindAll
    WateringLog.findOne = originalWateringLogFindOne
    sequelize.transaction = originalTransaction
})

test('need-watering includes plants scheduled for later today', async () => {
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)
    let query
    const plants = [{ id: 4, next_watering_at: new Date(tomorrow.getTime() - 1) }]
    Plant.findAll = async options => {
        query = options
        return plants
    }
    const res = createResponse()

    await plantController.getNeedWatering({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, plants)
    assert.equal(query.where.next_watering_at[Op.lt].getTime(), tomorrow.getTime())
})

test('deleting the latest watering restores its scheduled date and prior last-watered value', async () => {
    const previousWateredAt = new Date('2026-09-28T08:00:00.000Z')
    const { targetLog, updates } = setupDeletion({
        latestActionId: 12,
        latestWatering: { action_at: previousWateredAt }
    })
    const res = createResponse()

    await plantController.deleteWatering({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        },
        params: { id: '4', logId: '12' }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(targetLog.destroyed, true)
    assert.deepEqual(updates, [{
        last_watered_at: previousWateredAt,
        next_watering_at: targetLog.scheduled_for
    }])
    assert.equal(res.body.scheduleRestored, true)
    assert.equal(res.body.next_watering_at, targetLog.scheduled_for)
})

test('deleting an older watering keeps the current schedule unchanged', async () => {
    const { targetLog, plant, updates } = setupDeletion({
        latestActionId: 99,
        latestWatering: { action_at: new Date('2026-10-01T08:00:00.000Z') }
    })
    const res = createResponse()

    await plantController.deleteWatering({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        },
        params: { id: '4', logId: '12' }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(targetLog.destroyed, true)
    assert.deepEqual(updates, [])
    assert.equal(res.body.scheduleRestored, false)
    assert.equal(res.body.next_watering_at, plant.next_watering_at)
})

test('deleting the only watering restores its original due date', async () => {
    const { targetLog, updates } = setupDeletion({
        latestActionId: 12,
        latestWatering: null
    })
    const res = createResponse()

    await plantController.deleteWatering({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        },
        params: { id: '4', logId: '12' }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(updates, [{
        last_watered_at: null,
        next_watering_at: targetLog.scheduled_for
    }])
})

test('updating a plant stores reminder settings and recalculates its schedule', async () => {
    const updates = []
    const plant = {
        id: 4,
        watering_interval_days: 7,
        watering_time_of_day: 'morning',
        last_watered_at: null,
        metadata: { notes: 'near window', notifications: { on_day: '2026-10-01T08:00:00.000Z' } },
        async update(values) {
            updates.push(values)
            Object.assign(this, values)
        }
    }
    Plant.findOne = async () => plant
    const res = createResponse()

    await plantController.update({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        },
        params: { id: '4' },
        body: {
            name: '  Monstera  ',
            species: 'Monstera deliciosa',
            watering_interval_days: 14,
            watering_time_of_day: 'evening',
            notify_morning: false,
            notify_day_before: true,
            reminder_weekdays: [1, 4]
        }
    }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].name, 'Monstera')
    assert.equal(updates[0].notify_morning, false)
    assert.equal(updates[0].notify_day_before, true)
    assert.deepEqual(updates[0].reminder_weekdays, [1, 4])
    assert.deepEqual(updates[0].metadata, {
        notes: 'near window',
        notifications: {}
    })
    assert.ok(updates[0].next_watering_at instanceof Date)
    assert.equal(updates[0].next_watering_at.getHours(), 19)
})

test('updating a plant rejects invalid reminder weekdays', async () => {
    let updated = false
    Plant.findOne = async () => ({
        id: 4,
        async update() {
            updated = true
        }
    })
    const res = createResponse()

    await plantController.update({
        cookies: {
            token: jwt.sign({ id: 7 }, process.env.SECRET_KEY)
        },
        params: { id: '4' },
        body: { reminder_weekdays: [1, 1] }
    }, res)

    assert.equal(res.statusCode, 400)
    assert.equal(updated, false)
})
