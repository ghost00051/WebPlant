import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CARE_ACTION_CODES,
    CARE_ACTION_TITLES,
    CARE_METHODS,
    careTitleFor,
    normalizeCareActionPayload,
    serializeCareLog
} from './careLogs.js'

const NOW = new Date('2026-10-25T12:00:00+03:00')

function normalize(body, options = {}) {
    return normalizeCareActionPayload(body, { now: NOW, ...options })
}

test('справочники действий ухода согласованы', () => {
    assert.deepEqual(CARE_ACTION_CODES, [
        'fertilize',
        'spray',
        'leaf_clean',
        'rotate',
        'pest_check',
        'humidity_support'
    ])
    assert.deepEqual(CARE_METHODS, ['spray_bottle', 'humidifier'])
    for (const code of CARE_ACTION_CODES) {
        assert.equal(typeof CARE_ACTION_TITLES[code], 'string')
        assert.ok(CARE_ACTION_TITLES[code].length > 0)
        assert.equal(careTitleFor(code), CARE_ACTION_TITLES[code])
    }
    assert.equal(CARE_ACTION_TITLES.fertilize, 'Подкормка')
    assert.equal(CARE_ACTION_TITLES.spray, 'Опрыскивание')
    assert.equal(careTitleFor('unknown'), null)
})

test('опрыскивание: метод по умолчанию и допустимые методы', () => {
    const result = normalize({ action_code: 'spray' })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value, {
        action_code: 'spray',
        product_name: null,
        dose: null,
        method: 'spray_bottle',
        note: null,
        performed_at: NOW
    })

    const humidifier = normalize({ action_code: 'spray', method: 'humidifier' })
    assert.equal(humidifier.ok, true)
    assert.equal(humidifier.value.method, 'humidifier')

    const invalid = normalize({ action_code: 'spray', method: 'watering_can' })
    assert.equal(invalid.ok, false)
    assert.equal(typeof invalid.error, 'string')
})

test('method сохраняется только для опрыскивания', () => {
    const result = normalize({ action_code: 'fertilize', product_name: 'Фикус', method: 'humidifier' })

    assert.equal(result.ok, true)
    assert.equal(result.value.method, null)
})

test('подкормка требует название средства', () => {
    const missing = normalize({ action_code: 'fertilize' })
    assert.equal(missing.ok, false)
    assert.match(missing.error, /средств/i)

    const blank = normalize({ action_code: 'fertilize', product_name: '   ' })
    assert.equal(blank.ok, false)

    const valid = normalize({ action_code: 'fertilize', product_name: '  Агрикола  ', dose: ' 5 мл ' })
    assert.equal(valid.ok, true)
    assert.equal(valid.value.product_name, 'Агрикола')
    assert.equal(valid.value.dose, '5 мл')
})

test('пустые строки превращаются в null, значения обрезаются', () => {
    const result = normalize({
        action_code: 'leaf_clean',
        product_name: '',
        dose: '   ',
        note: '  Протёрла листья  '
    })

    assert.equal(result.ok, true)
    assert.equal(result.value.product_name, null)
    assert.equal(result.value.dose, null)
    assert.equal(result.value.note, 'Протёрла листья')
    assert.equal(result.value.method, null)
})

test('действие обязательно и должно быть из списка', () => {
    assert.equal(normalize({}).ok, false)
    assert.equal(normalize({ action_code: '   ' }).ok, false)
    assert.equal(normalize({ action_code: 'water' }).ok, false)
    assert.equal(normalize(null).ok, false)
    assert.equal(normalize({ action_code: 'rotate' }).ok, true)
})

test('ограничения длины полей', () => {
    assert.equal(normalize({ action_code: 'fertilize', product_name: 'a'.repeat(160) }).ok, true)
    assert.equal(normalize({ action_code: 'fertilize', product_name: 'a'.repeat(161) }).ok, false)
    assert.equal(normalize({ action_code: 'rotate', dose: 'b'.repeat(120) }).ok, true)
    assert.equal(normalize({ action_code: 'rotate', dose: 'b'.repeat(121) }).ok, false)
    assert.equal(normalize({ action_code: 'rotate', note: 'c'.repeat(500) }).ok, true)
    assert.equal(normalize({ action_code: 'rotate', note: 'c'.repeat(501) }).ok, false)
})

test('performed_at: по умолчанию now, строка ISO и Date', () => {
    const fallback = normalize({ action_code: 'rotate' }, { now: NOW })
    assert.equal(fallback.value.performed_at.getTime(), NOW.getTime())

    const fromString = normalize({ action_code: 'rotate', performed_at: '2026-10-01T09:30:00+03:00' })
    assert.equal(fromString.ok, true)
    assert.equal(fromString.value.performed_at.toISOString(), '2026-10-01T06:30:00.000Z')

    const fromDate = normalize({ action_code: 'rotate', performed_at: new Date('2026-10-02T09:00:00Z') })
    assert.equal(fromDate.ok, true)
    assert.equal(fromDate.value.performed_at.toISOString(), '2026-10-02T09:00:00.000Z')
})

test('performed_at: будущее запрещено с допуском 5 минут', () => {
    const future = normalize({ action_code: 'rotate', performed_at: '2026-10-25T12:10:00+03:00' })
    assert.equal(future.ok, false)
    assert.match(future.error, /будущ/i)

    const nearFuture = normalize({ action_code: 'rotate', performed_at: '2026-10-25T12:04:00+03:00' })
    assert.equal(nearFuture.ok, true)

    const invalid = normalize({ action_code: 'rotate', performed_at: 'не дата' })
    assert.equal(invalid.ok, false)
})

test('performed_at: глубина хранения до 365 дней', () => {
    const acceptable = normalize({ action_code: 'rotate', performed_at: '2025-11-01T09:00:00+03:00' })
    assert.equal(acceptable.ok, true)

    const tooOld = normalize({ action_code: 'rotate', performed_at: '2025-10-01T09:00:00+03:00' })
    assert.equal(tooOld.ok, false)
    assert.match(tooOld.error, /365/)
})

test('serializeCareLog отдаёт плоский объект для API', () => {
    const serialized = serializeCareLog({
        id: 7,
        plant_id: 3,
        action_code: 'fertilize',
        product_name: 'Агрикола',
        dose: '5 мл',
        method: null,
        note: null,
        performed_at: new Date('2026-10-20T06:00:00Z'),
        created_at: new Date('2026-10-20T06:01:00Z')
    }, { plantName: 'Монстера' })

    assert.deepEqual(serialized, {
        id: 7,
        plant_id: 3,
        plant_name: 'Монстера',
        action_code: 'fertilize',
        title: 'Подкормка',
        product_name: 'Агрикола',
        dose: '5 мл',
        method: null,
        note: null,
        performed_at: '2026-10-20T06:00:00.000Z',
        created_at: '2026-10-20T06:01:00.000Z'
    })

    const empty = serializeCareLog({})
    assert.equal(empty.plant_name, null)
    assert.equal(empty.title, null)
    assert.equal(empty.performed_at, null)
})
