import test from 'node:test'
import assert from 'node:assert/strict'

import {
    MAX_AUDIT_LIMIT,
    MAX_PAYLOAD_BYTES,
    createAdminAuditLister,
    createAdminAuditRecorder,
    fitAuditPayload,
    normalizeAuditIp,
    sanitizeAuditPayload
} from './adminAudit.js'

test('sanitizeAuditPayload: вырезает password, token, cookie и secret на любой глубине', () => {
    const payload = sanitizeAuditPayload({
        password: 'p',
        passwordConfirmation: 'p2',
        access_token: 't',
        cookies: { a: 1 },
        ClientSecret: 's',
        nested: {
            refreshToken: 't2',
            secret_key: 's2',
            keep: 'ok'
        },
        items: [{ cookie: 'c', keep: 1 }, { token: 'x', keep: 2 }],
        from: 'USER',
        to: 'ADMIN'
    })

    assert.deepEqual(payload, {
        nested: { keep: 'ok' },
        items: [{ keep: 1 }, { keep: 2 }],
        from: 'USER',
        to: 'ADMIN'
    })
})

test('sanitizeAuditPayload: не падает на null, циклах и примитивах', () => {
    assert.equal(sanitizeAuditPayload(null), null)
    assert.equal(sanitizeAuditPayload(undefined), null)
    assert.equal(sanitizeAuditPayload('строка'), 'строка')
    assert.deepEqual(sanitizeAuditPayload([null, undefined]), [null, null])

    const circular = { a: 1 }
    circular.self = circular
    assert.deepEqual(sanitizeAuditPayload(circular), { a: 1, self: '[circular]' })
})

test('fitAuditPayload: маленький payload сохраняется без изменений', () => {
    assert.deepEqual(
        fitAuditPayload({ from: 'USER', to: 'ADMIN' }),
        { from: 'USER', to: 'ADMIN' }
    )
    assert.equal(fitAuditPayload(null), null)
})

test('fitAuditPayload: обрезает payload до 4000 байт валидным JSON и без секретов', () => {
    const payload = fitAuditPayload({
        note: 'я'.repeat(6000),
        password: 'super-secret-token'
    })
    const text = JSON.stringify(payload)

    assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_PAYLOAD_BYTES)
    assert.equal(payload.truncated, true)
    assert.ok(payload.original_bytes > MAX_PAYLOAD_BYTES)
    assert.ok(payload.preview.length > 0)
    assert.ok(!text.includes('super-secret-token'), 'секрет не должен попасть даже в превью')
})

test('normalizeAuditIp: пропускает только валидные адреса', () => {
    assert.equal(normalizeAuditIp('203.0.113.9'), '203.0.113.9')
    assert.equal(normalizeAuditIp('::ffff:203.0.113.9'), '::ffff:203.0.113.9')
    assert.equal(normalizeAuditIp('203.0.113.9, 10.0.0.1'), '203.0.113.9')
    assert.equal(normalizeAuditIp('not-an-ip'), null)
    assert.equal(normalizeAuditIp(''), null)
    assert.equal(normalizeAuditIp(undefined), null)
})

test('recordAdminAction: пишет admin_id, цель, ip и user-agent без PII', async () => {
    const created = []
    const recordAdminAction = createAdminAuditRecorder({
        model: { create: async row => { created.push(row); return row } }
    })

    const ok = await recordAdminAction({
        requestId: 'req-1',
        user: { id: 5, email: 'admin@example.com' },
        ip: '::ffff:10.0.0.7',
        get: header => (header.toLowerCase() === 'user-agent' ? 'Mozilla/5.0 Test' : undefined)
    }, {
        action: 'user.role_changed',
        targetType: 'user',
        targetId: 12,
        payload: { from: 'USER', to: 'ADMIN', password: 'secret' }
    })

    assert.equal(ok, true)
    assert.deepEqual(created[0], {
        admin_id: 5,
        action: 'user.role_changed',
        target_type: 'user',
        target_id: '12',
        payload: { from: 'USER', to: 'ADMIN' },
        ip: '::ffff:10.0.0.7',
        user_agent: 'Mozilla/5.0 Test'
    })
})

test('recordAdminAction: без корректного action запись не создаётся', async () => {
    let calls = 0
    const recordAdminAction = createAdminAuditRecorder({
        model: { create: async () => { calls++ } }
    })

    assert.equal(await recordAdminAction({}, {}), false)
    assert.equal(await recordAdminAction({}, { action: '   ' }), false)
    assert.equal(await recordAdminAction({}, { action: 'x'.repeat(100) }), false)
    assert.equal(calls, 0)
})

test('recordAdminAction: ошибка модели логируется с requestId и не пробрасывается', async () => {
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args)

    try {
        const recordAdminAction = createAdminAuditRecorder({
            model: { create: async () => { throw new Error('db down') } }
        })

        const result = await recordAdminAction(
            { requestId: 'req-123', user: { id: 7 }, ip: '127.0.0.1' },
            { action: 'user.deleted', targetType: 'user', targetId: 42 }
        )

        assert.equal(result, false)
        assert.equal(warnings.length, 1)
        assert.match(String(warnings[0][0]), /req-123/)
        assert.match(String(warnings[0][0]), /аудит/)
        assert.match(String(warnings[0][1]), /db down/)
    } finally {
        console.warn = originalWarn
    }
})

test('recordAdminAction: циклический payload не роняет запись', async () => {
    const rows = []
    const recordAdminAction = createAdminAuditRecorder({
        model: { create: async row => { rows.push(row) } }
    })

    const payload = { plantId: 3 }
    payload.self = payload

    assert.equal(
        await recordAdminAction({ user: { id: 1 } }, { action: 'plant.deleted', payload }),
        true
    )
    assert.equal(rows[0].payload.self, '[circular]')
})

test('listAdminActions: limit ограничен 200, фильтры уходят в where', async () => {
    let captured
    const listAdminActions = createAdminAuditLister({
        model: {
            findAndCountAll: async options => {
                captured = options
                return {
                    rows: [{
                        get: () => ({
                            id: '9007199254740993',
                            admin_id: 2,
                            action: 'user.deleted',
                            target_type: 'user',
                            target_id: '3',
                            payload: { was_admin: false },
                            ip: '127.0.0.1',
                            user_agent: null,
                            created_at: new Date('2026-01-01T00:00:00.000Z')
                        })
                    }],
                    count: 1
                }
            }
        }
    })

    const result = await listAdminActions({
        limit: 1000,
        offset: 5,
        action: 'user.deleted',
        adminId: 2
    })

    assert.equal(captured.limit, MAX_AUDIT_LIMIT)
    assert.equal(captured.offset, 5)
    assert.deepEqual(captured.where, { action: 'user.deleted', admin_id: 2 })
    assert.equal(result.total, 1)
    assert.equal(result.limit, MAX_AUDIT_LIMIT)
    assert.equal(result.items[0].adminId, 2)
    assert.equal(result.items[0].targetId, '3')
    assert.equal(result.items[0].id, '9007199254740993', 'BIGINT вне safe integer остаётся строкой')
})
