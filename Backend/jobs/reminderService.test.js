import test from 'node:test'
import assert from 'node:assert/strict'
import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import Notification from '../models/Notification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import pushService from '../services/pushService.js'
import reminderService from './reminderService.js'

async function runOnDayWithSendResult(sendResult) {
    const plant = {
        id: 1,
        user_id: 2,
        name: 'Монстера',
        location: null,
        reminder_weekdays: [],
        next_watering_at: new Date(),
        metadata: {}
    }
    const originalFindAll = Plant.findAll
    const originalMethods = new Map()
    const replacements = {
        matchesWeekday: () => true,
        alreadyNotified: () => false,
        notify: async () => sendResult,
        markNotified: async () => { plant.marked = true }
    }

    Plant.findAll = async () => [plant]
    for (const [name, replacement] of Object.entries(replacements)) {
        originalMethods.set(name, {
            own: Object.hasOwn(reminderService, name),
            value: reminderService[name]
        })
        reminderService[name] = replacement
    }

    try {
        await reminderService.sendOnDay(new Date())
        return plant
    } finally {
        Plant.findAll = originalFindAll
        for (const [name, original] of originalMethods) {
            if (original.own) reminderService[name] = original.value
            else delete reminderService[name]
        }
    }
}

test('watering reminders remain retryable when no push was sent', async () => {
    const plant = await runOnDayWithSendResult({ success: false, sent: 0, failed: 1 })
    assert.equal(plant.marked, undefined)
})

test('watering reminders are marked after a push was sent', async () => {
    const plant = await runOnDayWithSendResult({ success: true, sent: 1, failed: 0 })
    assert.equal(plant.marked, true)
})

test('morning summary sends today due plants at Moscow day bounds and records success', async () => {
    const preference = {
        user_id: 7,
        last_morning_summary_date: null,
        async update(values) {
            Object.assign(this, values)
        }
    }
    const plant = { id: 3, name: 'Томат', location: 'Балкон' }
    const originalPreferenceFindAll = NotificationPreference.findAll
    const originalPlantFindAll = Plant.findAll
    const originalSendToUser = pushService.sendToUser
    const originalNotificationFindOrCreate = Notification.findOrCreate
    let plantQuery
    let pushArgs
    let notificationQuery
    Notification.findOrCreate = async query => {
        notificationQuery = query
        return [{ id: 11 }, true]
    }
    NotificationPreference.findAll = async () => [preference]
    Plant.findAll = async options => {
        plantQuery = options
        return [plant]
    }
    pushService.sendToUser = async (...args) => {
        pushArgs = args
        return { sent: 1 }
    }

    try {
        await reminderService.sendMorningSummary(new Date('2026-10-05T06:00:00.000Z'))
    } finally {
        NotificationPreference.findAll = originalPreferenceFindAll
        Plant.findAll = originalPlantFindAll
        pushService.sendToUser = originalSendToUser
        Notification.findOrCreate = originalNotificationFindOrCreate
    }

    assert.equal(plantQuery.where.user_id, 7)
    const dateLimit = plantQuery.where.next_watering_at[Op.lt]
    assert.equal(dateLimit.toISOString(), '2026-10-05T21:00:00.000Z')
    assert.equal(pushArgs[0], 7)
    assert.equal(pushArgs[1], '🌿 Утренняя сводка')
    assert.equal(pushArgs[2], 'Сегодня полить: Томат (Балкон)')
    assert.equal(notificationQuery.where.user_id, 7)
    assert.equal(notificationQuery.where.dedupe_key, 'morning-summary:2026-10-05')
    assert.equal(notificationQuery.defaults.type, 'morning_summary')
    assert.equal(notificationQuery.defaults.body, 'Сегодня полить: Томат (Балкон)')
    assert.equal(preference.last_morning_summary_date, '2026-10-05')
})

test('morning summary remains retryable when push delivery fails', async () => {
    const preference = {
        user_id: 8,
        last_morning_summary_date: null,
        async update(values) {
            Object.assign(this, values)
        }
    }
    const originalPreferenceFindAll = NotificationPreference.findAll
    const originalPlantFindAll = Plant.findAll
    const originalSendToUser = pushService.sendToUser
    const originalNotificationFindOrCreate = Notification.findOrCreate
    let notificationStored = false
    Notification.findOrCreate = async () => {
        notificationStored = true
        return [{ id: 12 }, true]
    }
    NotificationPreference.findAll = async () => [preference]
    Plant.findAll = async () => []
    pushService.sendToUser = async () => ({ sent: 0, failed: 1 })

    try {
        await reminderService.sendMorningSummary(new Date('2026-10-05T06:00:00.000Z'))
    } finally {
        NotificationPreference.findAll = originalPreferenceFindAll
        Plant.findAll = originalPlantFindAll
        pushService.sendToUser = originalSendToUser
        Notification.findOrCreate = originalNotificationFindOrCreate
    }

    assert.equal(notificationStored, true)
    assert.equal(preference.last_morning_summary_date, null)
})

test('watering reminder is stored before push delivery and deduplicated by scheduled watering time', async () => {
    const scheduledFor = new Date('2026-10-07T08:00:00.000Z')
    const plant = {
        id: 3,
        user_id: 7,
        name: 'Монстера',
        location: 'Окно',
        next_watering_at: scheduledFor
    }
    const originalNotificationFindOrCreate = Notification.findOrCreate
    const originalSendToUser = pushService.sendToUser
    const events = []
    Notification.findOrCreate = async query => {
        events.push(['store', query])
        return [{ id: 13 }, true]
    }
    pushService.sendToUser = async (...args) => {
        events.push(['push', args])
        return { sent: 0, failed: 1 }
    }

    try {
        const result = await reminderService.notify(plant, {
            title: '💧 Пора полить!',
            body: 'Монстера (Окно) ждёт воды',
            tag: 'on_day',
            type: 'watering_due'
        })

        assert.equal(result.sent, 0)
    } finally {
        Notification.findOrCreate = originalNotificationFindOrCreate
        pushService.sendToUser = originalSendToUser
    }

    assert.equal(events[0][0], 'store')
    assert.equal(events[0][1].where.dedupe_key, 'plant:3:on_day:2026-10-07T08:00:00.000Z')
    assert.equal(events[0][1].defaults.plant_id, 3)
    assert.equal(events[0][1].defaults.type, 'watering_due')
    assert.equal(events[1][0], 'push')
})
