import test from 'node:test'
import assert from 'node:assert/strict'
import {
    LIGHT_OPTIONS,
    buildConditionsMetadata,
    conditionsSummary,
    findGuidePlantBySpecies,
    guideIntervalDays,
    guidePlants,
    lightFromPlant,
    lightLabel,
    matchGuidePlants,
    normalizeLight,
    normalizeRoom,
    parseGuideInterval,
    resolveAddPlantPrefill,
    roomFromPlant
} from './plantConditions.js'

test('normalizeLight: принимает id, русские подписи и мусор', () => {
    assert.equal(normalizeLight('sun'), 'sun')
    assert.equal(normalizeLight(' Полутень '), 'partial')
    assert.equal(normalizeLight('ТЕНЬ'), 'shade')
    assert.equal(normalizeLight('partial_shade'), 'partial')
    assert.equal(normalizeLight('яркое'), '')
    assert.equal(normalizeLight(null), '')
    assert.equal(lightLabel('shade'), 'Тень')
    assert.equal(lightLabel('unknown'), '')
    assert.deepEqual(LIGHT_OPTIONS.map(option => option.id), ['sun', 'partial', 'shade'])
})

test('normalizeRoom: обрезает пробелы и ограничивает длину', () => {
    assert.equal(normalizeRoom('  Гостиная '), 'Гостиная')
    assert.equal(normalizeRoom(null), '')
    assert.equal(normalizeRoom('x'.repeat(400)).length, 255)
})

test('lightFromPlant/roomFromPlant: читают колонку и фолбэк из metadata', () => {
    assert.equal(lightFromPlant({ light: 'sun' }), 'sun')
    assert.equal(lightFromPlant({ metadata: { care_hints: { light: 'shade' } } }), 'shade')
    assert.equal(lightFromPlant({}), '')
    assert.equal(roomFromPlant({ location: 'Кухня' }), 'Кухня')
    assert.equal(roomFromPlant({ room: 'Спальня' }), 'Спальня')
    assert.equal(roomFromPlant(null), '')
})

test('buildConditionsMetadata: сохраняет существующие care_hints', () => {
    const merged = buildConditionsMetadata('partial', {
        care_hints: { watering_answers: [{ question: 'q', answer: 'a' }] }
    })
    assert.equal(merged.care_hints.light, 'partial')
    assert.equal(merged.care_hints.watering_answers.length, 1)

    const empty = buildConditionsMetadata('', { care_hints: { light: 'sun' } })
    assert.equal(empty.care_hints.light, 'sun')

    assert.deepEqual(buildConditionsMetadata('sun'), { care_hints: { light: 'sun' } })
})

test('conditionsSummary: склеивает комнату и свет без дублей', () => {
    assert.equal(conditionsSummary('Гостиная', 'sun'), 'Гостиная · солнце')
    assert.equal(conditionsSummary('', 'shade'), 'тень')
    assert.equal(conditionsSummary('Кухня', ''), 'Кухня')
    assert.equal(conditionsSummary('', ''), '')
})

test('parseGuideInterval: диапазоны с тире и одним числом', () => {
    assert.deepEqual(parseGuideInterval('7–10'), { min: 7, max: 10 })
    assert.deepEqual(parseGuideInterval('7-10'), { min: 7, max: 10 })
    assert.deepEqual(parseGuideInterval('14 — 21'), { min: 14, max: 21 })
    assert.deepEqual(parseGuideInterval('5'), { min: 5, max: 5 })
    assert.deepEqual(parseGuideInterval(9), { min: 9, max: 9 })
    assert.equal(parseGuideInterval(''), null)
    assert.equal(parseGuideInterval(null), null)
})

test('guideIntervalDays: безопасный верх диапазона и дефолт', () => {
    assert.equal(guideIntervalDays({ intervalDays: '7–10' }), 10)
    assert.equal(guideIntervalDays({ intervalDays: '4–7' }), 7)
    assert.equal(guideIntervalDays({ intervalDays: '400–500' }), 365)
    assert.equal(guideIntervalDays({}), 7)
    assert.equal(guideIntervalDays(null), 7)
})

test('guidePlants: отдаёт справочник с автоматическими интервалами', () => {
    const list = guidePlants()
    assert.ok(list.length >= 6)
    const monstera = list.find(item => item.slug === 'monstera')
    assert.equal(monstera.intervalDays, 10)
    assert.equal(monstera.species, 'Monstera deliciosa')
    assert.equal(guidePlants(6).length, 6)
})

test('matchGuidePlants: находит виды по русскому имени и латыни в тексте', () => {
    assert.equal(matchGuidePlants('На фото, скорее всего, монстера.')[0].slug, 'monstera')
    assert.equal(matchGuidePlants('Ficus benjamina у окна')[0].slug, 'ficus-benjamina')
    assert.equal(matchGuidePlants('Похоже на орхидею')[0].slug, 'orchid-phalaenopsis')
    assert.deepEqual(matchGuidePlants('совсем непонятное фото'), [])
    assert.equal(matchGuidePlants('', 1).length, 0)
})

test('findGuidePlantBySpecies: сверяет species/латынь/имя', () => {
    assert.equal(findGuidePlantBySpecies('Monstera deliciosa').slug, 'monstera')
    assert.equal(findGuidePlantBySpecies('сансевиерия').slug, 'sansevieria')
    assert.equal(findGuidePlantBySpecies('Unknown plant'), null)
    assert.equal(findGuidePlantBySpecies(''), null)
})

test('resolveAddPlantPrefill: slug из справочника подставляет вид и интервал', () => {
    const prefill = resolveAddPlantPrefill(new URLSearchParams('species=monstera&days=8'))
    assert.equal(prefill.slug, 'monstera')
    assert.equal(prefill.matchedGuide, true)
    assert.equal(prefill.name, 'Монстера')
    assert.equal(prefill.species, 'Monstera deliciosa')
    assert.equal(prefill.intervalDays, 8)
})

test('resolveAddPlantPrefill: без days берёт интервал справочника', () => {
    const prefill = resolveAddPlantPrefill(new URLSearchParams('species=sansevieria'))
    assert.equal(prefill.intervalDays, 21)
    assert.equal(prefill.name, 'Сансевиерия')
})

test('resolveAddPlantPrefill: латынь, комната и свет из query', () => {
    const prefill = resolveAddPlantPrefill({
        species: 'Ficus benjamina',
        name: 'Фикус с работы',
        days: '5',
        room: ' Кухня ',
        light: 'Солнце'
    })
    assert.equal(prefill.slug, '')
    assert.equal(prefill.matchedGuide, false)
    assert.equal(prefill.name, 'Фикус с работы')
    assert.equal(prefill.species, 'Ficus benjamina')
    assert.equal(prefill.intervalDays, 5)
    assert.equal(prefill.room, 'Кухня')
    assert.equal(prefill.light, 'sun')
})

test('resolveAddPlantPrefill: пустые и битые параметры безопасны', () => {
    assert.deepEqual(resolveAddPlantPrefill(new URLSearchParams('')), {
        slug: '',
        matchedGuide: false,
        name: '',
        species: '',
        intervalDays: null,
        room: '',
        light: ''
    })
    assert.equal(resolveAddPlantPrefill(null).intervalDays, null)
    assert.equal(resolveAddPlantPrefill(new URLSearchParams('species=monstera&days=999')).intervalDays, 10)
    assert.equal(resolveAddPlantPrefill(new URLSearchParams('species=monstera&days=abc')).intervalDays, 10)
})
