import test from 'node:test'
import assert from 'node:assert/strict'

import uploadRoutes, { UPLOAD_RATE_LIMIT_PER_HOUR } from './uploadRoutes.js'

test('INT-09: лимит /api/upload поднят до 30 загрузок в час', () => {
    assert.equal(UPLOAD_RATE_LIMIT_PER_HOUR, 30)

    const layer = uploadRoutes.stack.find(item => item.route && item.route.path === '/')
    assert.ok(layer, 'POST /api/upload остаётся на месте')
    assert.ok(layer.route.stack.some(item => item.method === 'post'))
})
