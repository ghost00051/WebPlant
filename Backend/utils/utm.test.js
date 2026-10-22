import test from 'node:test'
import assert from 'node:assert/strict'

import { UTM_MAX_LENGTH, cleanUtmValue, hasUtm, parseUtm } from './utm.js'

test('cleanUtmValue: тримминг и пустые значения', () => {
    assert.equal(cleanUtmValue('  yandex  '), 'yandex')
    assert.equal(cleanUtmValue(''), null)
    assert.equal(cleanUtmValue('   '), null)
    assert.equal(cleanUtmValue(null), null)
    assert.equal(cleanUtmValue(undefined), null)
    assert.equal(cleanUtmValue(42), null)
    assert.equal(cleanUtmValue({}), null)
})

test('cleanUtmValue: вырезает control-символы', () => {
    assert.equal(cleanUtmValue('ya\u0000ndex\u001F.ru'), 'yandex.ru')
    assert.equal(cleanUtmValue('line\nbreak'), 'linebreak')
})

test('cleanUtmValue: вырезает HTML-скобки', () => {
    assert.equal(cleanUtmValue('<script>alert(1)</script>'), 'scriptalert(1)/script')
    assert.equal(cleanUtmValue('tg<>&"'), 'tg&"')
})

test(`cleanUtmValue: обрезает до ${UTM_MAX_LENGTH} символов`, () => {
    const long = 'a'.repeat(UTM_MAX_LENGTH + 50)
    const cleaned = cleanUtmValue(long)
    assert.equal(cleaned.length, UTM_MAX_LENGTH)
    assert.equal(Array.from(cleaned).length, UTM_MAX_LENGTH)
})

test('parseUtm: достаёт source/medium/campaign', () => {
    assert.deepEqual(parseUtm({
        source: 'yandex',
        medium: 'cpc',
        campaign: 'autumn_2026'
    }), {
        source: 'yandex',
        medium: 'cpc',
        campaign: 'autumn_2026'
    })
})

test('parseUtm: частичный и мусорный вход даёт null в отсутствующих полях', () => {
    assert.deepEqual(parseUtm({ source: 'tg' }), { source: 'tg', medium: null, campaign: null })
    assert.deepEqual(parseUtm('not-an-object'), { source: null, medium: null, campaign: null })
    assert.deepEqual(parseUtm(['yandex']), { source: null, medium: null, campaign: null })
    assert.deepEqual(parseUtm(null), { source: null, medium: null, campaign: null })
    assert.deepEqual(parseUtm(undefined), { source: null, medium: null, campaign: null })
})

test('parseUtm: чистит значения и не падает на нестроковых полях', () => {
    assert.deepEqual(parseUtm({
        source: '  yandex ',
        medium: '<cpc>',
        campaign: 123
    }), {
        source: 'yandex',
        medium: 'cpc',
        campaign: null
    })
})

test('hasUtm: true только при непустом хотя бы одном поле', () => {
    assert.equal(hasUtm({ source: 'yandex', medium: null, campaign: null }), true)
    assert.equal(hasUtm({ source: null, medium: null, campaign: 'x' }), true)
    assert.equal(hasUtm({ source: null, medium: null, campaign: null }), false)
    assert.equal(hasUtm(null), false)
})
