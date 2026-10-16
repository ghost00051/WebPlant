import test from 'node:test'
import assert from 'node:assert/strict'

import {
    extractResponseText,
    getMaxAdviceQuestions,
    normalizeConfidence,
    normalizeQuestionOptions,
    normalizeSpeciesSuggestion,
    parseWateringAdvice,
    parseWateringTimeAdvice
} from './aiService.js'
import {
    buildIntervalReference,
    detectPlantGroup,
    fallbackWateringAdvice,
    fallbackWateringTimeAdvice,
    getSeasonInfo
} from '../utils/wateringKnowledge.js'

const TZ = 'Europe/Moscow'
const at = iso => new Date(iso)

test('parseWateringAdvice: вопрос с вариантами очищается и ограничивается четырьмя', () => {
    const parsed = parseWateringAdvice(JSON.stringify({
        type: 'question',
        question: '  Где стоит растение?  ',
        options: [' у окна ', 'в тени', 'у окна', 42, 'на балконе', 'в теплице', 'лишний']
    }))

    assert.equal(parsed.type, 'question')
    assert.equal(parsed.question, 'Где стоит растение?')
    assert.deepEqual(parsed.options, ['у окна', 'в тени', 'на балконе', 'в теплице'])
})

test('parseWateringAdvice: вопрос без вариантов и слишком длинный вопрос', () => {
    assert.deepEqual(
        parseWateringAdvice('{"type":"question","question":"Свет?"}'),
        { type: 'question', question: 'Свет?', options: [] }
    )
    assert.equal(parseWateringAdvice(JSON.stringify({ type: 'question', question: 'я'.repeat(401) })), null)
    assert.equal(parseWateringAdvice('{"type":"question","question":"   "}'), null)
})

test('parseWateringAdvice: рекомендация, уверенность и приведение типов', () => {
    const parsed = parseWateringAdvice(JSON.stringify({
        type: 'recommendation',
        intervalDays: '7',
        reason: '  Проверяйте грунт  ',
        confidence: 'Высокая'
    }))

    assert.deepEqual(parsed, {
        type: 'recommendation',
        intervalDays: 7,
        reason: 'Проверяйте грунт',
        confidence: 'high'
    })

    const withoutConfidence = parseWateringAdvice('{"type":"recommendation","intervalDays":5,"reason":"тест"}')
    assert.equal(withoutConfidence.confidence, 'medium', 'без уверенности не занижаем до low')
})

test('parseWateringAdvice: границы интервала и обязательный reason', () => {
    const build = (intervalDays, reason = 'ок') => JSON.stringify({ type: 'recommendation', intervalDays, reason })

    assert.equal(parseWateringAdvice(build(1)).intervalDays, 1)
    assert.equal(parseWateringAdvice(build(365)).intervalDays, 365)
    assert.equal(parseWateringAdvice(build(0)), null)
    assert.equal(parseWateringAdvice(build(366)), null)
    assert.equal(parseWateringAdvice(build(7.5)), null)
    assert.equal(parseWateringAdvice(build(7, '')), null)
    assert.equal(parseWateringAdvice(build(7, 'я'.repeat(1001))), null)
})

test('parseWateringAdvice: markdown-обёртка, мусор и не-строки', () => {
    const fenced = parseWateringAdvice('```json\n{"type":"recommendation","intervalDays":9,"reason":"ок"}\n```')
    assert.equal(fenced.intervalDays, 9)
    assert.equal(parseWateringAdvice('не json'), null)
    assert.equal(parseWateringAdvice(undefined), null)
    assert.equal(parseWateringAdvice('{"type":"unknown"}'), null)
})

test('parseWateringTimeAdvice: допустимые значения и отбраковка', () => {
    assert.deepEqual(
        parseWateringTimeAdvice('{"timeOfDay":"evening","reason":"жарко"}'),
        { timeOfDay: 'evening', reason: 'жарко' }
    )
    assert.equal(parseWateringTimeAdvice('{"timeOfDay":"night","reason":"ок"}'), null)
    assert.equal(parseWateringTimeAdvice('{"timeOfDay":"day"}'), null)
    assert.equal(parseWateringTimeAdvice('{"timeOfDay":"day","reason":"  "}'), null)
    assert.equal(parseWateringTimeAdvice('[]'), null)
})

test('normalizeConfidence: синонимы и безопасное значение по умолчанию', () => {
    assert.equal(normalizeConfidence('высокая'), 'high')
    assert.equal(normalizeConfidence('СРЕДНЯЯ'), 'medium')
    assert.equal(normalizeConfidence('низкая'), 'low')
    assert.equal(normalizeConfidence(''), 'medium')
    assert.equal(normalizeConfidence(null), 'medium')
})

test('normalizeQuestionOptions: только строки, без дублей, максимум четыре', () => {
    assert.deepEqual(normalizeQuestionOptions(['a', 'a', 'b']), ['a', 'b'])
    assert.deepEqual(normalizeQuestionOptions('a'), [])
    assert.deepEqual(normalizeQuestionOptions(['a'.repeat(80)]), ['a'.repeat(60)])
})

test('getMaxAdviceQuestions: значение по умолчанию, env и потолок', () => {
    assert.equal(getMaxAdviceQuestions({}), 6)
    assert.equal(getMaxAdviceQuestions({ WATERING_ADVICE_MAX_QUESTIONS: '8' }), 8)
    assert.equal(getMaxAdviceQuestions({ WATERING_ADVICE_MAX_QUESTIONS: '100' }), 10)
    assert.equal(getMaxAdviceQuestions({ WATERING_ADVICE_MAX_QUESTIONS: '0' }), 6)
    assert.equal(getMaxAdviceQuestions({ WATERING_ADVICE_MAX_QUESTIONS: 'abc' }), 6)
})

test('normalizeSpeciesSuggestion: префиксы, маркеры и ограничение длины', () => {
    assert.equal(normalizeSpeciesSuggestion('Это Монстера деликатесная.'), 'Монстера деликатесная')
    assert.equal(normalizeSpeciesSuggestion('Вид: Фикус Бенджамина'), 'Фикус Бенджамина')
    assert.equal(normalizeSpeciesSuggestion('- Монстера (Monstera deliciosa)'), 'Монстера (Monstera deliciosa)')
    assert.equal(normalizeSpeciesSuggestion('"Сансевиерия"'), 'Сансевиерия')
    assert.equal(normalizeSpeciesSuggestion('я'.repeat(300)), null)
    assert.equal(normalizeSpeciesSuggestion(null), null)
})

test('extractResponseText: обе формы ответа Responses API', () => {
    assert.equal(extractResponseText({ output_text: '  Привет  ' }), 'Привет')
    assert.equal(
        extractResponseText({
            output: [
                { content: [{ type: 'output_text', text: 'Первая' }] },
                { content: [{ type: 'text', text: 'Вторая' }] }
            ]
        }),
        'Первая\nВторая'
    )
    assert.equal(extractResponseText({}), '')
})

test('detectPlantGroup: группы определяются по названию и виду', () => {
    assert.equal(detectPlantGroup({ name: 'Опунция', species: 'Opuntia' }).id, 'cactus_succulent')
    assert.equal(detectPlantGroup({ name: 'Орхидея', species: 'Phalaenopsis' }).id, 'orchid')
    assert.equal(detectPlantGroup({ name: 'Папоротник', species: 'Nephrolepis' }).id, 'fern')
    assert.equal(detectPlantGroup({ name: 'Монстера', species: 'Monstera deliciosa' }).id, 'tropical_foliage')
    assert.equal(detectPlantGroup({ name: 'Базилик', species: 'Ocimum basilicum' }).id, 'herbs_vegetables')
    assert.equal(detectPlantGroup({ name: 'Неизвестное растение' }).id, 'default')
})

test('getSeasonInfo: сезоны по месяцу и переворот для южного полушария', () => {
    assert.equal(getSeasonInfo(at('2026-01-15T12:00:00Z'), TZ).season, 'winter')
    assert.equal(getSeasonInfo(at('2026-04-15T12:00:00Z'), TZ).season, 'spring')
    assert.equal(getSeasonInfo(at('2026-07-15T12:00:00Z'), TZ).season, 'summer')
    assert.equal(getSeasonInfo(at('2026-10-15T12:00:00Z'), TZ).season, 'autumn')

    const previous = process.env.HEMISPHERE
    process.env.HEMISPHERE = 'south'
    try {
        assert.equal(getSeasonInfo(at('2026-01-15T12:00:00Z'), TZ).season, 'summer')
    } finally {
        if (previous === undefined) delete process.env.HEMISPHERE
        else process.env.HEMISPHERE = previous
    }
})

test('fallbackWateringAdvice: зима реже лета, уверенность растёт с ответами', () => {
    const winter = fallbackWateringAdvice({
        plantName: 'Опунция',
        species: 'Opuntia',
        now: at('2026-01-15T12:00:00Z'),
        timeZone: TZ
    })
    const summer = fallbackWateringAdvice({
        plantName: 'Опунция',
        species: 'Opuntia',
        now: at('2026-07-15T12:00:00Z'),
        timeZone: TZ
    })

    assert.ok(winter.intervalDays > summer.intervalDays, `${winter.intervalDays} должно быть больше ${summer.intervalDays}`)
    assert.equal(winter.type, 'recommendation')
    assert.equal(winter.confidence, 'low')
    assert.match(winter.reason, /проверяйте грунт/i)

    const withAnswers = fallbackWateringAdvice({
        plantName: 'Опунция',
        species: 'Opuntia',
        answers: [{ question: 'Свет?', answer: 'юг' }, { question: 'Горшок?', answer: '3 л' }],
        now: at('2026-01-15T12:00:00Z'),
        timeZone: TZ
    })
    assert.equal(withAnswers.confidence, 'medium')
})

test('fallbackWateringTimeAdvice: сезон, место и группа влияют на выбор', () => {
    const balconySummer = fallbackWateringTimeAdvice({
        plantName: 'Томат',
        intervalDays: 2,
        location: 'Балкон, южная сторона',
        now: at('2026-07-15T12:00:00Z'),
        timeZone: TZ
    })
    assert.equal(balconySummer.timeOfDay, 'evening')

    const cactusWinter = fallbackWateringTimeAdvice({
        plantName: 'Кактус',
        species: 'Opuntia',
        intervalDays: 21,
        now: at('2026-01-15T12:00:00Z'),
        timeZone: TZ
    })
    assert.equal(cactusWinter.timeOfDay, 'day')

    const fernSummer = fallbackWateringTimeAdvice({
        plantName: 'Нефролепис',
        species: 'Nephrolepis',
        intervalDays: 3,
        now: at('2026-07-15T12:00:00Z'),
        timeZone: TZ
    })
    assert.equal(fernSummer.timeOfDay, 'morning')

    assert.match(balconySummer.reason, /проверять влажность грунта/i)
})

test('buildIntervalReference: ориентиры и сезонная поправка попадают в промпт', () => {
    const winter = buildIntervalReference('winter')
    assert.match(winter, /кактусы и суккуленты/)
    assert.match(winter, /зима/i)

    const summer = buildIntervalReference('summer')
    assert.match(summer, /лето/i)
})
