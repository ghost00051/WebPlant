import test from 'node:test'
import assert from 'node:assert/strict'

import {
    ALLOWED_EVENTS,
    MAX_EVENTS_PER_BATCH,
    MAX_PROPS_BYTES,
    isAllowedEvent,
    isForbiddenPropKey,
    parseEventsBody,
    sanitizeProps,
    validateEventItem
} from './eventValidation.js'

function bodyWith(events, extra = {}) {
    return { events, ...extra }
}

test('ALLOWED_EVENTS: allowlist F01 ровно из 10 событий', () => {
    assert.deepEqual(ALLOWED_EVENTS, [
        'landing_view',
        'register',
        'plant_created',
        'watering_marked',
        'push_subscribed',
        'chat_message',
        'photo_added',
        'plant_id_started',
        'plant_id_success',
        'share_clicked'
    ])
    for (const event of ALLOWED_EVENTS) assert.equal(isAllowedEvent(event), true)
    assert.equal(isAllowedEvent('unknown_event'), false)
    assert.equal(isAllowedEvent(null), false)
    assert.equal(isAllowedEvent(42), false)
})

test('parseEventsBody: принимает валидный батч и проставляет props/path по умолчанию', () => {
    const parsed = parseEventsBody(bodyWith(
        [{ event: 'landing_view', path: '/' }, { event: 'share_clicked', props: { channel: 'telegram' } }],
        { visitorId: 'visitor-12345678' }
    ))

    assert.equal(parsed.ok, true)
    assert.equal(parsed.visitorId, 'visitor-12345678')
    assert.deepEqual(parsed.events, [
        { event: 'landing_view', props: {}, path: '/' },
        { event: 'share_clicked', props: { channel: 'telegram' }, path: null }
    ])
})

test('parseEventsBody: пустой массив событий допустим (accepted=0)', () => {
    const parsed = parseEventsBody(bodyWith([]))
    assert.equal(parsed.ok, true)
    assert.deepEqual(parsed.events, [])
    assert.equal(parsed.visitorId, null)
})

test('parseEventsBody: лимит 20 событий за запрос', () => {
    const event = { event: 'landing_view' }
    const twenty = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => event)
    assert.equal(parseEventsBody(bodyWith(twenty)).ok, true)

    const twentyOne = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => event)
    const parsed = parseEventsBody(bodyWith(twentyOne))
    assert.equal(parsed.ok, false)
    assert.match(parsed.message, /20/)
})

test('parseEventsBody: мусор в теле — 400-совместимая ошибка', () => {
    for (const body of [null, undefined, [], 'events', 42]) {
        const parsed = parseEventsBody(body)
        assert.equal(parsed.ok, false)
    }
    assert.equal(parseEventsBody({}).ok, false)
    assert.equal(parseEventsBody({ events: 'nope' }).ok, false)
    assert.equal(parseEventsBody({ events: [null] }).ok, false)
    assert.equal(parseEventsBody({ events: [{ event: 'landing_view' }, { event: 'evil' }] }).ok, false)
})

test('transform: props допускает только plain object с примитивами', () => {
    assert.deepEqual(sanitizeProps({ count: 1, ok: true, label: 'x', empty: null }), {
        count: 1,
        ok: true,
        label: 'x',
        empty: null
    })
    assert.deepEqual(sanitizeProps(undefined), {})
    assert.deepEqual(sanitizeProps(null), {})

    assert.equal(sanitizeProps([]), null)
    assert.equal(sanitizeProps('text'), null)
    assert.equal(sanitizeProps({ nested: { a: 1 } }), null)
    assert.equal(sanitizeProps({ list: [1, 2] }), null)
    assert.equal(sanitizeProps({ bad: Number.POSITIVE_INFINITY }), null)
})

test(`props: JSON не больше ${MAX_PROPS_BYTES} байт`, () => {
    const fits = sanitizeProps({ note: 'a'.repeat(MAX_PROPS_BYTES - 20) })
    assert.ok(fits)

    const tooBig = sanitizeProps({ note: 'a'.repeat(MAX_PROPS_BYTES) })
    assert.equal(tooBig, null)

    const item = validateEventItem({ event: 'chat_message', props: { note: 'a'.repeat(MAX_PROPS_BYTES) } })
    assert.equal(item.ok, false)
})

test('props: PII-ключи email/phone/name/password/token и их вариации запрещены', () => {
    for (const key of ['email', 'phone', 'name', 'password', 'token']) {
        assert.equal(isForbiddenPropKey(key), true, `ключ ${key} должен быть запрещён`)
        assert.equal(sanitizeProps({ [key]: 'x' }), null)
    }
    for (const key of ['user_email', 'userEmail', 'phone_number', 'auth_token', 'Password']) {
        assert.equal(isForbiddenPropKey(key), true, `ключ ${key} должен быть запрещён`)
    }
    assert.equal(isForbiddenPropKey('plant_name'), false)
    assert.equal(isForbiddenPropKey('channel'), false)
    assert.deepEqual(sanitizeProps({ plant_name: 'Монстера', channel: 'push' }), {
        plant_name: 'Монстера',
        channel: 'push'
    })
})

test('sanitizeProps: не загрязняет прототип через __proto__', () => {
    const dirty = JSON.parse('{"__proto__":{"polluted":true},"keep":1}')
    const cleaned = sanitizeProps(dirty)

    assert.deepEqual(cleaned, { keep: 1 })
    assert.equal(Object.getPrototypeOf(cleaned), Object.prototype)
    assert.equal({}.polluted, undefined)
})

test('validateEventItem: path — только абсолютный и не длиннее 300 символов', () => {
    assert.deepEqual(validateEventItem({ event: 'landing_view', path: '/plants/42' }), {
        ok: true,
        event: { event: 'landing_view', props: {}, path: '/plants/42' }
    })
    assert.equal(validateEventItem({ event: 'landing_view', path: 'plants' }).ok, false)
    assert.equal(validateEventItem({ event: 'landing_view', path: `/${'a'.repeat(300)}` }).ok, false)
    assert.equal(validateEventItem({ event: 'landing_view', props: 'x' }).ok, false)
})

test('parseEventsBody: visitorId по regex ^[A-Za-z0-9._:-]{8,64}$', () => {
    assert.equal(parseEventsBody(bodyWith([], { visitorId: 'abc-DEF_12.34:56' })).ok, true)
    assert.equal(parseEventsBody(bodyWith([], { visitorId: 'short' })).ok, false)
    assert.equal(parseEventsBody(bodyWith([], { visitorId: 'bad id!!' })).ok, false)
    assert.equal(parseEventsBody(bodyWith([], { visitorId: null })).ok, true)
})
