import test from 'node:test'
import assert from 'node:assert/strict'

import { notifyGardenShareViews } from './gardenShareService.js'

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
