import test from 'node:test'
import assert from 'node:assert/strict'

import plantRoutes from './plantRoutes.js'

function findRoute(router, path, method) {
    for (const layer of router.stack) {
        if (!layer.route || layer.route.path !== path) continue
        if (layer.route.stack.some(item => item.method === method)) return layer.route
    }
    return null
}

test('INT-01: POST /api/plants/:id/health-check зарегистрирован в роутере', () => {
    const route = findRoute(plantRoutes, '/:id/health-check', 'post')
    assert.ok(route, 'маршрут health-check должен существовать')

    const handlerNames = route.stack.map(item => item.handle?.name || '')
    assert.ok(
        handlerNames.some(name => name.includes('healthCheck')),
        `health-check handler не найден среди ${handlerNames.join(', ')}`
    )
    assert.ok(
        handlerNames.some(name => name.includes('validateOptionalChatPhoto')),
        'должна быть валидация опционального фото (JSON-режим)'
    )
})

test('роутер растений не потерял существующие маршруты фото/полива', () => {
    assert.ok(findRoute(plantRoutes, '/:id/photos', 'post'))
    assert.ok(findRoute(plantRoutes, '/:id/photos', 'get'))
    assert.ok(findRoute(plantRoutes, '/:id/photos/:photoId', 'delete'))
    assert.ok(findRoute(plantRoutes, '/:id/water', 'post'))
    assert.ok(findRoute(plantRoutes, '/suggest-species-photo', 'post'))
})
