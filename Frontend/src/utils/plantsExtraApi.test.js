import test from 'node:test'
import assert from 'node:assert/strict'
import {
    isFeatureUnavailable,
    isUnavailableStatus,
    normalizeDiagnosis,
    normalizeHealthCheck,
    normalizePhotoList,
    normalizeSpeciesSuggestion,
    sortPhotosByDate,
    healthCheckLabel,
    checkFromPhotos,
    pickLatestHealthCheck,
    formatCheckDate
} from './plantsExtraApi.js'

test('isUnavailableStatus/isFeatureUnavailable: 404/501/503 = деградация', () => {
    assert.equal(isUnavailableStatus(404), true)
    assert.equal(isUnavailableStatus(503), true)
    assert.equal(isUnavailableStatus(501), true)
    assert.equal(isUnavailableStatus(400), false)
    assert.equal(isUnavailableStatus(undefined), false)

    const unavailable = new Error('нет ручки')
    unavailable.status = 404
    assert.equal(isFeatureUnavailable(unavailable), true)
    assert.equal(isFeatureUnavailable({ code: 'network' }), true)
    assert.equal(isFeatureUnavailable({ status: 500 }), false)
    assert.equal(isFeatureUnavailable(null), false)
})

test('normalizePhotoList: принимает массив, items и photos, дедуплицирует', () => {
    const items = normalizePhotoList({
        items: [
            { id: 1, url: 'https://x/e/2026/10/a.jpg', taken_at: '2026-10-20T09:00:00.000Z', is_main: true },
            { id: 2, url: 'https://x/e/2026/10/a.jpg' },
            { id: 3, url: '', created_at: '2026-09-01T09:00:00.000Z' },
            { id: 4, url: 'https://x/e/2026/10/b.jpg', created_at: '2026-09-01T09:00:00.000Z', metadata: { diagnosis: { summary: 'ok' } } }
        ]
    })
    assert.equal(items.length, 2)
    assert.equal(items[0].isMain, true)
    assert.equal(items[0].createdAt, '2026-10-20T09:00:00.000Z')
    assert.equal(items[1].metadata.diagnosis.summary, 'ok')

    const strings = normalizePhotoList(['https://x/e/2026/10/c.jpg', '  '])
    assert.equal(strings.length, 1)
    assert.equal(strings[0].url, 'https://x/e/2026/10/c.jpg')

    assert.deepEqual(normalizePhotoList(null), [])
    assert.deepEqual(normalizePhotoList({ photos: [{ url: 'u' }] }).length, 1)
})

test('sortPhotosByDate: старые сначала, фото без даты первыми', () => {
    const sorted = sortPhotosByDate([
        { url: 'c', createdAt: '2026-10-20T09:00:00.000Z' },
        { url: 'a', createdAt: null },
        { url: 'b', createdAt: '2026-09-01T09:00:00.000Z' }
    ])
    assert.deepEqual(sorted.map(photo => photo.url), ['a', 'b', 'c'])
})

test('normalizeDiagnosis: нормализует проблемы и симптомы', () => {
    const diagnosis = normalizeDiagnosis({
        isPlant: true,
        plantName: 'Монстера',
        severity: 'low',
        summary: 'В целом здорова',
        likelyProblems: [{ name: 'Паутинный клещ', confidence: 'low', why: 'паутина' }, { name: '' }, null],
        careAdvice: ['Протрите листья', '']
    })
    assert.equal(diagnosis.likelyProblems.length, 1)
    assert.equal(diagnosis.likelyProblems[0].name, 'Паутинный клещ')
    assert.deepEqual(diagnosis.careAdvice, ['Протрите листья'])
    assert.equal(diagnosis.isPlant, true)

    assert.equal(normalizeDiagnosis(null), null)
    assert.equal(normalizeDiagnosis({}), null)
    assert.equal(normalizeDiagnosis({ isPlant: false }).isPlant, false)
})

test('normalizeHealthCheck: понимает text/reply, diagnosis и дату', () => {
    const check = normalizeHealthCheck({
        text: '  Листья чистые  ',
        diagnosis: { summary: 'Здорова', likelyProblems: [] },
        photoUrl: 'https://x/e/2026/10/a.jpg',
        createdAt: '2026-10-21T10:00:00.000Z'
    })
    assert.equal(check.text, 'Листья чистые')
    assert.equal(check.diagnosis.summary, 'Здорова')
    assert.equal(check.createdAt, '2026-10-21T10:00:00.000Z')
    assert.equal(check.photoUrl, 'https://x/e/2026/10/a.jpg')

    const replyShape = normalizeHealthCheck({ reply: 'Похоже на фикус', diagnosis: null })
    assert.equal(replyShape.text, 'Похоже на фикус')
    assert.equal(replyShape.diagnosis, null)

    assert.equal(normalizeHealthCheck({}), null)
    assert.equal(normalizeHealthCheck(null), null)
})

test('healthCheckLabel: статус для карточки растения', () => {
    assert.equal(healthCheckLabel(null), null)
    assert.deepEqual(healthCheckLabel({ diagnosis: { isPlant: true, likelyProblems: [], visibleSymptoms: [], summary: 'Ок' } }), {
        tone: 'ok',
        label: 'здорова'
    })
    assert.equal(healthCheckLabel({
        diagnosis: { isPlant: true, likelyProblems: [{ name: 'Щитовка' }], visibleSymptoms: [], summary: '' }
    }).label, 'есть проблемы: Щитовка')
    assert.equal(healthCheckLabel({
        diagnosis: { isPlant: true, likelyProblems: [], visibleSymptoms: ['жёлтые листья'], summary: '' }
    }).tone, 'attention')
    assert.equal(healthCheckLabel({ diagnosis: { isPlant: false } }).label, 'на фото не растение')
    assert.equal(healthCheckLabel({ text: 'нет диагноза' }).tone, 'unknown')
})

test('checkFromPhotos: берёт самый свежий диагноз из metadata фото', () => {
    const check = checkFromPhotos([
        { url: 'a', createdAt: '2026-09-01T09:00:00.000Z', metadata: { diagnosis: { summary: 'старый' } } },
        { url: 'b', createdAt: '2026-10-01T09:00:00.000Z', metadata: { diagnosis: { summary: 'новый' } } }
    ])
    assert.equal(check.diagnosis.summary, 'новый')
    assert.equal(check.photoUrl, 'b')
    assert.equal(checkFromPhotos([]), null)
    assert.equal(checkFromPhotos([{ url: 'a', metadata: {} }]), null)
})

test('pickLatestHealthCheck: сравнивает локальную проверку и фото', () => {
    const checks = { 7: { text: 't', diagnosis: { summary: 'ok' }, createdAt: '2026-10-05T09:00:00.000Z' } }
    const older = pickLatestHealthCheck({
        checks,
        plantId: 7,
        photos: [{ url: 'a', createdAt: '2026-09-01T09:00:00.000Z', metadata: { diagnosis: { summary: 'old' } } }]
    })
    assert.equal(older.createdAt, '2026-10-05T09:00:00.000Z')

    const newer = pickLatestHealthCheck({
        checks,
        plantId: 7,
        photos: [{ url: 'b', createdAt: '2026-10-20T09:00:00.000Z', metadata: { diagnosis: { summary: 'new' } } }]
    })
    assert.equal(newer.createdAt, '2026-10-20T09:00:00.000Z')

    assert.equal(pickLatestHealthCheck({ checks, plantId: 8, photos: [] }), null)
})

test('formatCheckDate: короткая дата по-русски', () => {
    assert.equal(formatCheckDate('2026-10-20T09:00:00.000Z'), '20 октября')
    assert.equal(formatCheckDate(''), '')
})

test('normalizeSpeciesSuggestion: приводит ответ vision к элементам справочника', () => {
    const suggestions = normalizeSpeciesSuggestion({
        suggestions: [
            { name: 'Монстера', latin: 'Monstera deliciosa', species: 'Monstera deliciosa', confidence: 0.7 },
            { name: 'Монстера' },
            { species: 'Ficus benjamina' }
        ]
    })
    assert.equal(suggestions.length, 2)
    assert.equal(suggestions[0].name, 'Монстера')
    assert.equal(suggestions[0].guide.slug, 'monstera')
    assert.equal(suggestions[1].species, 'Ficus benjamina')

    assert.equal(normalizeSpeciesSuggestion({ species: 'Sansevieria trifasciata' })[0].species, 'Sansevieria trifasciata')
    assert.deepEqual(normalizeSpeciesSuggestion(null), [])
    assert.deepEqual(normalizeSpeciesSuggestion({ suggestions: [] }), [])
})
