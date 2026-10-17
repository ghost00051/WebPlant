import test from 'node:test'
import assert from 'node:assert/strict'

import { isValidTimeZone, resolveHemisphere, resolveTimeZone } from './timeZone.js'

test('isValidTimeZone: принимает IANA-пояса и отвергает мусор', () => {
    assert.equal(isValidTimeZone('Europe/Moscow'), true)
    assert.equal(isValidTimeZone('Asia/Vladivostok'), true)
    assert.equal(isValidTimeZone('Москва'), false)
    assert.equal(isValidTimeZone(''), false)
    assert.equal(isValidTimeZone(null), false)
    assert.equal(isValidTimeZone('x'.repeat(65)), false)
})

test('resolveTimeZone: невалидное значение заменяется поясом по умолчанию', () => {
    assert.equal(resolveTimeZone('Asia/Novosibirsk'), 'Asia/Novosibirsk')
    assert.equal(resolveTimeZone('  Europe/Moscow  '), 'Europe/Moscow')
    assert.equal(resolveTimeZone('nope'), 'Europe/Moscow')
    assert.equal(resolveTimeZone(undefined), 'Europe/Moscow')
})

test('resolveHemisphere: личная настройка важнее глобального флага', () => {
    assert.equal(resolveHemisphere({ hemisphere: 'south' }, {}), 'south')
    assert.equal(resolveHemisphere({ hemisphere: 'north' }, { HEMISPHERE: 'south' }), 'north')
    assert.equal(resolveHemisphere({ hemisphere: ' ЮГ ' }, {}), 'north', 'чужое значение игнорируется')
})

test('resolveHemisphere: без личной настройки работает env, по умолчанию север', () => {
    assert.equal(resolveHemisphere({}, { HEMISPHERE: 'south' }), 'south')
    assert.equal(resolveHemisphere({}, { HEMISPHERE: 'SOUTH' }), 'south')
    assert.equal(resolveHemisphere({}, {}), 'north')
    assert.equal(resolveHemisphere(null, {}), 'north')
    assert.equal(resolveHemisphere(undefined, { HEMISPHERE: 'восток' }), 'north')
})
