import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAdviceLogRow, normalizeAdviceSource } from './aiAdviceLog.js'

test('buildAdviceLogRow: нормализует поля записи', () => {
    const row = buildAdviceLogRow({
        userId: '7',
        kind: 'watering',
        plantName: '  Монстера  ',
        species: 'Monstera deliciosa',
        season: 'winter',
        resultType: 'recommendation',
        intervalDays: 9,
        confidence: 'high',
        questionsAsked: 3,
        source: 'cache',
        latencyMs: 1234
    })

    assert.deepEqual(row, {
        user_id: 7,
        kind: 'watering',
        plant_name: 'Монстера',
        species: 'Monstera deliciosa',
        season: 'winter',
        result_type: 'recommendation',
        interval_days: 9,
        time_of_day: null,
        confidence: 'high',
        questions_asked: 3,
        source: 'cache',
        latency_ms: 1234
    })
})

test('buildAdviceLogRow: чистит пустые строки и неизвестный источник', () => {
    const row = buildAdviceLogRow({
        kind: 'time',
        plantName: '   ',
        species: undefined,
        source: 'нечто',
        timeOfDay: 'evening'
    })

    assert.equal(row.plant_name, null)
    assert.equal(row.species, null)
    assert.equal(row.source, 'unknown', 'неизвестный источник не выдаём за ответ модели')
    assert.equal(row.time_of_day, 'evening')
    assert.equal(row.questions_asked, 0)
})

test('buildAdviceLogRow: обрезает длинные значения и отбрасывает чужой тип', () => {
    const row = buildAdviceLogRow({ kind: 'species', plantName: 'я'.repeat(400) })
    assert.equal(row.plant_name.length, 255)

    assert.equal(buildAdviceLogRow({ kind: 'chat' }), null)
    assert.equal(buildAdviceLogRow({}), null)
})

test('normalizeAdviceSource: пропускает только известные значения', () => {
    assert.equal(normalizeAdviceSource('fallback'), 'fallback')
    assert.equal(normalizeAdviceSource('cache'), 'cache')
    assert.equal(normalizeAdviceSource('ai'), 'ai')
    assert.equal(normalizeAdviceSource(''), 'unknown')
    assert.equal(normalizeAdviceSource(null), 'unknown')
    assert.equal(normalizeAdviceSource('ai '), 'unknown', 'значение должно быть передано точным')
})
