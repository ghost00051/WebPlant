import test from 'node:test'
import assert from 'node:assert/strict'

import {
    assertUsableChatResponse,
    buildChatRequest,
    buildVisionRequest,
    extractResponseText,
    formatPlantDiagnosisText,
    getMaxAdviceQuestions,
    normalizeConfidence,
    normalizePhotoQuality,
    normalizeQuestionOptions,
    normalizeSeverity,
    normalizeSpeciesSuggestion,
    parsePlantDiagnosis,
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

test('assertUsableChatResponse: пустой и обрезанный ответ — ошибка, а не заглушка в кэш', () => {
    assert.equal(assertUsableChatResponse({ output_text: '  Ответ  ' }), 'Ответ')

    assert.throws(
        () => assertUsableChatResponse({ output_text: '   ' }),
        error => error.code === 'AI_EMPTY_RESPONSE'
    )
    assert.throws(
        () => assertUsableChatResponse({}),
        error => error.code === 'AI_EMPTY_RESPONSE'
    )
    assert.throws(
        () => assertUsableChatResponse({
            output_text: 'Обрыв',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' }
        }),
        error => error.code === 'AI_INCOMPLETE_RESPONSE'
    )
})

test('buildChatRequest: статусы полива считаются по календарным суткам пользователя', () => {
    const now = new Date('2026-10-17T20:00:00Z')
    const request = buildChatRequest({
        message: 'пора ли полить?',
        history: [],
        timeZone: 'Europe/Moscow',
        context: {
            isAuthorized: true,
            plantsCount: 2,
            today: now.toISOString(),
            plants: [
                { name: 'Завтрашняя', nextWatering: '2026-10-18T05:00:00Z', intervalDays: 7 },
                { name: 'Сегодняшняя', nextWatering: '2026-10-17T05:00:00Z', intervalDays: 3 }
            ]
        }
    })

    const contextText = request.input[0].content
    assert.match(contextText, /Завтрашняя.*— завтра/)
    assert.match(contextText, /Сегодняшняя.*— пора полить сегодня/)
    assert.match(contextText, /Europe\/Moscow/)
    assert.equal(request.instructions.includes('Алиса'), true)
})

test('buildChatRequest: счётчик растений отдельно от показанного списка', () => {
    const request = buildChatRequest({
        message: 'сколько у меня растений?',
        history: [],
        timeZone: 'Europe/Moscow',
        context: {
            isAuthorized: true,
            plantsCount: 120,
            today: new Date('2026-10-17T09:00:00Z').toISOString(),
            plants: [{ name: 'Монстера', nextWatering: '2026-10-20T05:00:00Z' }]
        }
    })

    const contextText = request.input[0].content
    assert.match(contextText, /Всего растений: 120/)
    assert.match(contextText, /Показаны первые 1 растений из 120/)
})

test('buildChatRequest: история ограничена десятью сообщениями и роли приведены к API', () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `сообщение ${index}`
    }))

    const request = buildChatRequest({
        message: 'новый вопрос',
        history,
        timeZone: 'UTC',
        context: { isAuthorized: false }
    })

    // контекст + 10 сообщений истории + текущее сообщение
    assert.equal(request.input.length, 12)
    assert.equal(request.input[1].content, 'сообщение 4')
    assert.equal(request.input[10].content, 'сообщение 13')
    assert.equal(request.input[11].content, 'новый вопрос')
    assert.equal(request.input[2].role, 'assistant')
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

test('parsePlantDiagnosis: полный JSON, уверенность и ограничения размеров', () => {
    const raw = JSON.stringify({
        isPlant: true,
        plantName: '  Перец (Capsicum)  ',
        visibleSymptoms: Array.from({ length: 8 }, (_, index) => 'Симптом ' + (index + 1)),
        likelyProblems: [
            { name: ' Паутинный клещ ', confidence: 'Высокая', why: '  Видны клещи и паутина  ' },
            { name: 'Хлороз', confidence: 'medium' },
            { name: 'Перелив', confidence: 'low' },
            { name: 'Недостаток света', confidence: 'high' },
            { name: 'Пятая проблема', confidence: 'high' }
        ],
        severity: 'Тяжёлая',
        careAdvice: ['  Полейте растение  '],
        photoQuality: 'хорошая',
        needsAnotherPhoto: true,
        summary: '  Растение поражено клещом.  '
    })

    const parsed = parsePlantDiagnosis(raw)

    assert.ok(parsed)
    assert.equal(parsed.plantName, 'Перец (Capsicum)')
    assert.equal(parsed.visibleSymptoms.length, 6)
    assert.equal(parsed.likelyProblems.length, 4)
    assert.deepEqual(parsed.likelyProblems[0], {
        name: 'Паутинный клещ',
        confidence: 'high',
        why: 'Видны клещи и паутина'
    })
    assert.equal(parsed.severity, 'severe')
    assert.equal(parsed.photoQuality, 'good')
    assert.equal(parsed.needsAnotherPhoto, true)
    assert.equal(parsed.summary, 'Растение поражено клещом.')
    assert.deepEqual(parsed.careAdvice, ['Полейте растение'])
})

test('parsePlantDiagnosis: markdown-обёртка, русские значения и пустые ответы', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const fenced = parsePlantDiagnosis(fence + 'json{"isPlant":true,"plantName":"Фикус","severity":"лёгкая","photoQuality":"средняя"}' + fence)
    assert.ok(fenced)
    assert.equal(fenced.severity, 'mild')
    assert.equal(fenced.photoQuality, 'fair')

    const notPlant = parsePlantDiagnosis(JSON.stringify({ isPlant: false, summary: '' }))
    assert.equal(notPlant.isPlant, false)
    assert.match(notPlant.summary, /не удалось/i)

    assert.equal(parsePlantDiagnosis('не json'), null)
    assert.equal(parsePlantDiagnosis(null), null)
    assert.equal(parsePlantDiagnosis(JSON.stringify({})), null)
})

test('normalizeSeverity / normalizePhotoQuality: неизвестные значения не ломают разбор', () => {
    assert.equal(normalizeSeverity('Тяжёлая'), 'severe')
    assert.equal(normalizeSeverity('нечто'), 'unknown')
    assert.equal(normalizeSeverity(undefined), 'unknown')
    assert.equal(normalizePhotoQuality('плохая'), 'poor')
    assert.equal(normalizePhotoQuality('???'), 'fair')
})

test('buildVisionRequest: фото и вопрос попадают в запрос, длинный вопрос обрезается', () => {
    const { instructions, input } = buildVisionRequest({
        imageDataUrl: 'data:image/jpeg;base64,AAAA',
        question: 'я'.repeat(700),
        plantName: 'Перец'
    })

    assert.match(instructions, /ботанический/i)
    assert.match(instructions, /JSON/)

    const parts = input[0].content
    assert.equal(parts[0].type, 'input_text')
    assert.equal(parts[1].type, 'input_image')
    assert.equal(parts[1].image_url, 'data:image/jpeg;base64,AAAA')
    assert.match(parts[0].text, /Перец/)
    assert.ok(parts[0].text.includes('я'.repeat(500)))
    assert.ok(!parts[0].text.includes('я'.repeat(501)))
})

test('formatPlantDiagnosisText: карточка диагноза, дисклеймер и случай «не растение»', () => {
    const text = formatPlantDiagnosisText({
        isPlant: true,
        plantName: 'Перец',
        visibleSymptoms: ['Пожелтение'],
        likelyProblems: [{ name: 'Хлороз', confidence: 'medium', why: 'Бледные листья' }],
        severity: 'moderate',
        careAdvice: ['Проверьте полив'],
        photoQuality: 'good',
        needsAnotherPhoto: false,
        summary: 'Похоже на дефицит питания.'
    })

    assert.match(text, /Перец/)
    assert.match(text, /Хлороз/)
    assert.match(text, /уверенность: средняя/)
    assert.match(text, /Проверьте полив/)
    assert.match(text, /предварительная оценка/i)

    const notPlant = formatPlantDiagnosisText({ isPlant: false, summary: 'Похоже на стену.' })
    assert.match(notPlant, /стену/)
    assert.match(notPlant, /не диагноз/i)
})
