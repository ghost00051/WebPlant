import assert from 'node:assert/strict'

const pushRoutes = (await import('../../../Backend/routes/pushRoutes.js')).default
const adminPushRoutes = (await import('../../../Backend/routes/adminPushRoutes.js')).default
const notificationRoutes = (await import('../../../Backend/routes/notificationRoutes.js')).default
const userRoutes = (await import('../../../Backend/routes/userRoutes.js')).default
const pushController = (await import('../../../Backend/controllers/pushController.js')).default
const adminPushController = (await import('../../../Backend/controllers/adminPushController.js')).default

// Интеграция с контроллерами push-auditor (task-6).
assert.equal(typeof adminPushController.retryBroadcast, 'function', 'adminPushController.retryBroadcast must exist')
assert.equal(typeof pushController.unsubscribe, 'function', 'pushController.unsubscribe must exist')
for (const legacy of ['sendToUser', 'sendToAll', 'getStats']) {
    assert.equal(
        pushController[legacy],
        undefined,
        `legacy controller method ${legacy} should be removed by push-auditor`
    )
}

function describe(router) {
    return router.stack
        .filter(layer => layer.route)
        .flatMap(layer => Object.keys(layer.route.methods)
            .map(method => `${method.toUpperCase()} ${layer.route.path}`))
}

const push = describe(pushRoutes)
const adminPush = describe(adminPushRoutes)
const notifications = describe(notificationRoutes)
const users = describe(userRoutes)

console.log('pushRoutes:', push)
console.log('adminPushRoutes:', adminPush)
console.log('notificationRoutes:', notifications)
console.log('userRoutes (notif):', users.filter(r => r.includes('notification')))

const expectPush = [
    'GET /vapid-public-key',
    'POST /subscribe',
    'POST /unsubscribe'
]
for (const route of expectPush) assert.ok(push.includes(route), `pushRoutes missing ${route}`)
assert.ok(!push.some(route => /\/(send|send-all|stats)$/.test(route)), 'legacy push routes still registered')

for (const route of [
    'GET /overview',
    'GET /recipients',
    'POST /broadcasts',
    'POST /broadcasts/:id/cancel',
    'POST /broadcasts/:id/retry'
]) {
    assert.ok(adminPush.includes(route), `adminPushRoutes missing ${route}`)
}

for (const route of [
    'GET /unread-count',
    'GET /',
    'PATCH /read-all',
    'PATCH /:id/read'
]) {
    assert.ok(notifications.includes(route), `notificationRoutes missing ${route}`)
}

assert.ok(users.includes('GET /me/notification-preferences'), 'prefs GET missing')
assert.ok(users.includes('PATCH /me/notification-preferences'), 'prefs PATCH missing')

// Проверяем, что лимитеры реально навешаны: у route-слоя >1 handler.
function handlerCount(router, method, path) {
    const layer = router.stack.find(item =>
        item.route &&
        item.route.path === path &&
        Boolean(item.route.methods[method])
    )
    return layer ? layer.route.stack.length : 0
}

assert.ok(handlerCount(pushRoutes, 'post', '/subscribe') >= 4, 'subscribe: optionalAuth + 2 limiters + controller')
assert.ok(handlerCount(pushRoutes, 'post', '/unsubscribe') >= 3, 'unsubscribe: limiter + optionalAuth + controller')
assert.ok(handlerCount(notificationRoutes, 'get', '/') >= 2, 'list: limiter + controller')
assert.ok(handlerCount(notificationRoutes, 'patch', '/read-all') >= 2)
assert.ok(handlerCount(adminPushRoutes, 'post', '/broadcasts') >= 3)
assert.ok(handlerCount(userRoutes, 'patch', '/me/notification-preferences') >= 3)

// requireAuth/requireAdmin навешаны на уровне роутера (router.use), а не route-слоя.
for (const [name, router] of [['notificationRoutes', notificationRoutes], ['adminPushRoutes', adminPushRoutes]]) {
    const routerLevel = router.stack.filter(layer => !layer.route).length
    assert.ok(routerLevel >= 1, `${name}: router-level middleware missing`)
}

console.log('ROUTES PROBE OK')
// express-rate-limit MemoryStore держит интервалы очистки — завершаем процесс явно.
process.exit(0)
