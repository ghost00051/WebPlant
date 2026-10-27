import test from 'node:test'
import assert from 'node:assert/strict'

import {
    HEALTH_CHECK_MESSAGES,
    HEALTH_CHECK_METADATA_KEY,
    HEALTH_CHECK_QUESTION_MAX_LENGTH,
    buildHealthCheckRecord,
    buildHealthCheckResponse,
    mapVisionErrorResponse,
    mergePhotoDiagnosisMetadata,
    mergePlantHealthCheck,
    normalizeHealthCheckQuestion
} from './plantHealthCheck.js'

const DIAGNOSIS = {
    isPlant: true,
    plantName: 'Фикус',
    visibleSymptoms: ['жёлтые листья'],
    likelyProblems: [{ name: 'Перелив', confidence: 'medium', why: 'мокрый грунт' }],
    severity: 'medium',
    careAdvice: ['Проверьте дренаж'],
    photoQuality: 'fair',
    needsAnotherPhoto: false,
    summary: 'Похоже на перелив'
}

test('buildHealthCheckRecord: нормализует поля и дату', () => {
    const record = buildHealthCheckRecord({
        text: 'Разбор',
        diagnosis: DIAGNOSIS,
        photoUrl: 'https://api.example.com/uploads/plants/a.jpg',
        createdAt: '2026-11-01T09:00:00Z'
    })

    assert.deepEqual(record, {
        text: 'Разбор',
        diagnosis: DIAGNOSIS,
        photoUrl: 'https://api.example.com/uploads/plants/a.jpg',
        createdAt: '2026-11-01T09:00:00.000Z'
    })

    const fallback = buildHealthCheckRecord({ text: 42, diagnosis: 'bad', photoUrl: null })
    assert.equal(fallback.text, '')
    assert.equal(fallback.diagnosis, null)
    assert.equal(fallback.photoUrl, '')
    assert.match(fallback.createdAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('buildHealthCheckResponse: строгий контракт {text, diagnosis, photoUrl, createdAt, saved:true}', () => {
    const response = buildHealthCheckResponse({
        text: 'Разбор',
        diagnosis: DIAGNOSIS,
        photoUrl: 'https://api.example.com/uploads/plants/a.jpg',
        createdAt: '2026-11-01T09:00:00Z'
    })

    assert.deepEqual(Object.keys(response).sort(), [
        'createdAt',
        'diagnosis',
        'photoUrl',
        'saved',
        'text'
    ])
    assert.equal(response.saved, true)
    assert.equal(response.text, 'Разбор')
    assert.equal(response.diagnosis.isPlant, true)
})

test('mergePlantHealthCheck: не затирает остальные metadata', () => {
    const record = buildHealthCheckRecord({ text: 'ok', diagnosis: DIAGNOSIS, photoUrl: 'u' })
    const metadata = mergePlantHealthCheck(
        { prediction: { intervalDays: 7 }, notifications: { on_day: '2026-11-01' } },
        record
    )

    assert.deepEqual(metadata.prediction, { intervalDays: 7 })
    assert.deepEqual(metadata.notifications, { on_day: '2026-11-01' })
    assert.equal(metadata[HEALTH_CHECK_METADATA_KEY].text, 'ok')

    assert.deepEqual(mergePlantHealthCheck(null, record)[HEALTH_CHECK_METADATA_KEY].text, 'ok')
    assert.deepEqual(mergePlantHealthCheck('мусор', record)[HEALTH_CHECK_METADATA_KEY].text, 'ok')
})

test('mergePhotoDiagnosisMetadata: дописывает diagnosis и diagnosis_text в metadata фото', () => {
    const merged = mergePhotoDiagnosisMetadata(
        { taken_by: 'user', diagnosis: { old: true } },
        { diagnosis: DIAGNOSIS, text: 'Разбор с фото' }
    )

    assert.equal(merged.taken_by, 'user')
    assert.equal(merged.diagnosis_text, 'Разбор с фото')
    assert.equal(merged.diagnosis.plantName, 'Фикус')
    assert.deepEqual(mergePhotoDiagnosisMetadata(null, {}), { diagnosis: null, diagnosis_text: '' })
})

test('normalizeHealthCheckQuestion: строка, обрезка и невалидный тип', () => {
    assert.deepEqual(normalizeHealthCheckQuestion(undefined), { ok: true, question: '' })
    assert.deepEqual(normalizeHealthCheckQuestion('  что с ним?  '), { ok: true, question: 'что с ним?' })
    assert.equal(
        normalizeHealthCheckQuestion('я'.repeat(HEALTH_CHECK_QUESTION_MAX_LENGTH + 20)).question.length,
        HEALTH_CHECK_QUESTION_MAX_LENGTH
    )
    assert.deepEqual(normalizeHealthCheckQuestion(42), { ok: false, question: '' })
})

test('mapVisionErrorResponse: битое изображение -> 400, недоступность ИИ -> 503', () => {
    const unsupported = mapVisionErrorResponse({ code: 'AI_VISION_UNSUPPORTED_IMAGE' })
    assert.equal(unsupported.status, 400)
    assert.equal(unsupported.message, HEALTH_CHECK_MESSAGES.UNSUPPORTED_IMAGE)

    assert.equal(mapVisionErrorResponse({ code: 'AI_VISION_NO_IMAGE' }).status, 400)
    assert.equal(mapVisionErrorResponse({ code: 'CHAT_PHOTO_UNSUPPORTED' }).status, 400)

    const notConfigured = mapVisionErrorResponse({ code: 'AI_VISION_NOT_CONFIGURED' })
    assert.equal(notConfigured.status, 503)

    assert.equal(mapVisionErrorResponse({ code: 'AI_VISION_UNAVAILABLE' }).status, 503)
    assert.equal(mapVisionErrorResponse({ code: 'AI_VISION_FAILED' }).status, 503)

    const budget = mapVisionErrorResponse({ code: 'AI_BUDGET_EXCEEDED' })
    assert.equal(budget.status, 503)
    assert.match(budget.message, /лимит/i)

    const customUnavailable = mapVisionErrorResponse(
        { code: 'AI_VISION_UNAVAILABLE' },
        { unavailableMessage: 'Сервис проверки здоровья временно недоступен' }
    )
    assert.equal(customUnavailable.message, 'Сервис проверки здоровья временно недоступен')

    const unknown = mapVisionErrorResponse({ code: 'SOMETHING_ELSE' })
    assert.equal(unknown.status, 500)
    assert.equal(unknown.message, HEALTH_CHECK_MESSAGES.FAILED)
})
