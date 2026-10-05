import test from 'node:test'
import assert from 'node:assert/strict'
import Plant from '../models/Plant.js'
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
