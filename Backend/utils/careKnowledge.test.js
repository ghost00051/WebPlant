import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildCareAdviceContext,
    CARE_PLAN_INSTRUCTIONS,
    buildCarePlanContext,
    buildDefaultCarePlan,
    buildFallbackCareAdvice,
    getCareCandidates,
    normalizeCarePlan,
    parseCareAdvice,
    parseCarePlan,
    sanitizeCarePlan,
    summarizeCarePlan,
    validateCareAdvice
} from './careKnowledge.js'

const TIME_ZONE = 'Europe/Moscow'
const NOW = new Date('2026-10-19T10:00:00+03:00')

function plant(overrides = {}) {
    return {
        id: 1,
        name: 'Монстера',
        species: 'Monstera deliciosa',
        location: 'зал',
        created_at: new Date('2025-10-19T10:00:00+03:00'),
        watering_interval_days: 8,
        next_watering_at: new Date('2026-10-22T09:00:00+03:00'),
        ...overrides
    }
}

function advice(overrides = {}) {
    return {
        plantId: 1,
        actionCode: 'spray',
        title: 'Опрыскивание',
        createdAt: new Date('2026-10-09T10:00:00+03:00'),
        ...overrides
    }
}

function candidateCodes(result) {
    return result.candidates.map(item => item.code)
}

function carePlanWith(actionCode, overrides = {}) {
    return {
        ...buildDefaultCarePlan({ plant: plant() }),
        [actionCode]: {
            minIntervalDays: 14,
            maxPerMonth: 2,
            seasons: ['winter', 'spring', 'summer', 'autumn'],
            ...overrides
        }
    }
}

test('без AI-плана осенью предлагает только универсально безопасные действия', () => {
    const result = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE })

    assert.equal(result.seasonInfo.season, 'autumn')
    assert.ok(!candidateCodes(result).includes('spray'))
    assert.ok(!candidateCodes(result).includes('fertilize'))
    assert.ok(candidateCodes(result).includes('pest_check'))
    assert.ok(candidateCodes(result).includes('leaf_clean'))
    assert.ok(candidateCodes(result).includes('rotate'))
    assert.ok(candidateCodes(result).includes('humidity_support'))
})

test('базовый план не содержит действий, требующих знаний о виде', () => {
    const plan = buildDefaultCarePlan({ plant: plant() })

    assert.equal(plan.spray, undefined)
    assert.equal(plan.fertilize, undefined)
    assert.ok(plan.pest_check)
    assert.ok(plan.leaf_clean)
    assert.ok(plan.rotate)
})

test('явный план растения может разрешить опрыскивание', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        plan: carePlanWith('spray', { seasons: ['autumn', 'winter'] })
    })

    const spray = result.candidates.find(item => item.code === 'spray')
    assert.ok(spray)
    assert.equal(spray.notificationType, 'care_tip')
    assert.equal(result.candidates.find(item => item.code === 'pest_check')?.notificationType, 'care_reminder')
})

test('суккулентам не предлагает опрыскивание и увлажнение воздуха', () => {
    const result = getCareCandidates({
        plant: plant({ name: 'Кактус', species: 'Mammillaria' }),
        now: NOW,
        timeZone: TIME_ZONE
    })

    assert.ok(!candidateCodes(result).includes('spray'))
    assert.ok(!candidateCodes(result).includes('humidity_support'))
    assert.ok(candidateCodes(result).includes('pest_check'))
})

test('растениям с опушёнными листьями не предлагает опрыскивание', () => {
    const result = getCareCandidates({
        plant: plant({ name: 'Фиалка', species: 'Saintpaulia' }),
        now: NOW,
        timeZone: TIME_ZONE
    })

    assert.ok(!candidateCodes(result).includes('spray'))
    const leafClean = result.candidates.find(item => item.code === 'leaf_clean')
    assert.equal(leafClean?.methodHint, 'dry')
})

test('после двух опрыскиваний в месяце третье не предлагает', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        history: [
            advice({ createdAt: new Date('2026-10-03T10:00:00+03:00') }),
            advice({ createdAt: new Date('2026-10-01T10:00:00+03:00') })
        ],
        plan: carePlanWith('spray')
    })

    assert.ok(!candidateCodes(result).includes('spray'))
    assert.ok(candidateCodes(result).includes('leaf_clean'))
})

test('не предлагает опрыскивание раньше минимального интервала', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        history: [advice({ createdAt: new Date('2026-10-09T10:00:00+03:00') })],
        plan: carePlanWith('spray')
    })

    assert.ok(!candidateCodes(result).includes('spray'))
})

test('предлагает опрыскивание после минимального интервала', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        history: [advice({ createdAt: new Date('2026-10-04T10:00:00+03:00') })],
        plan: carePlanWith('spray')
    })

    assert.ok(candidateCodes(result).includes('spray'))
})

test('зимой не предлагает подкормку', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: new Date('2026-01-15T10:00:00+03:00'),
        timeZone: TIME_ZONE
    })

    assert.ok(!candidateCodes(result).includes('fertilize'))
})

test('недавно добавленному растению не предлагает подкормку', () => {
    const result = getCareCandidates({
        plant: plant({ created_at: new Date('2026-07-10T10:00:00+03:00') }),
        now: new Date('2026-07-15T10:00:00+03:00'),
        timeZone: TIME_ZONE
    })

    assert.ok(!candidateCodes(result).includes('fertilize'))
})

test('явный план взрослого растения летом разрешает подкормку', () => {
    const result = getCareCandidates({
        plant: plant(),
        now: new Date('2026-07-15T10:00:00+03:00'),
        timeZone: TIME_ZONE,
        plan: carePlanWith('fertilize', { seasons: ['spring', 'summer'] })
    })

    assert.ok(candidateCodes(result).includes('fertilize'))
})

test('парсит ответ ИИ в Markdown-обёртке', () => {
    const parsed = parseCareAdvice('```json\n{"decision":"recommend","actionCode":"pest_check","title":"🌿 Осмотрите листья","body":"Проверьте нижнюю сторону листьев на вредителей.","whyNow":"Профилактика.","confidence":"high"}\n```')

    assert.equal(parsed?.decision, 'recommend')
    assert.equal(parsed?.actionCode, 'pest_check')
    assert.equal(parsed?.confidence, 'high')
})

test('отклоняет действие, которого нет в разрешённых', () => {
    const candidates = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'fertilize',
        title: 'Подкормка',
        body: 'Подкормите растение комплексным удобрением.',
        whyNow: 'Рост',
        confidence: 'medium'
    }, candidates)

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'action-not-allowed')
})

test('отклоняет совет с дозировкой', () => {
    const candidates = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'pest_check',
        title: 'Обработка',
        body: 'Разведите 2 мл препарата в литре воды и обработайте листья.',
        whyNow: 'Профилактика',
        confidence: 'medium'
    }, candidates)

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'dosage')
})

test('не путает возраст растения с дозировкой', () => {
    const candidates = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'pest_check',
        title: 'Осмотр',
        body: 'Молодые листья появляются через 2 года после черенкования, поэтому осматривайте их внимательнее.',
        whyNow: 'Профилактика',
        confidence: 'medium'
    }, candidates)

    assert.equal(result.ok, true)
})

test('отклоняет совет с частотой чаще лимита', () => {
    const candidates = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        plan: carePlanWith('spray')
    }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'spray',
        title: 'Опрыскивание',
        body: 'Опрыскивайте листья 4 раза в месяц, чтобы повысить влажность.',
        whyNow: 'Сухой воздух',
        confidence: 'medium'
    }, candidates)

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'frequency')
})

test('отклоняет ежедневный совет', () => {
    const candidates = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'leaf_clean',
        title: 'Протирание',
        body: 'Протирайте листья каждый день влажной тканью.',
        whyNow: 'Пыль',
        confidence: 'medium'
    }, candidates)

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'daily-routine')
})

test('принимает корректный совет и нормализует уверенность', () => {
    const candidates = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE }).candidates
    const result = validateCareAdvice({
        decision: 'recommend',
        actionCode: 'leaf_clean',
        title: 'Протрите листья',
        body: 'Протрите листья мягкой влажной тканью, чтобы убрать пыль.',
        whyNow: 'Пыль мешает фотосинтезу.',
        confidence: 'высокая'
    }, candidates)

    assert.equal(result.ok, true)
    assert.equal(result.advice.confidence, 'high')
})

test('принимает решение skip', () => {
    const result = validateCareAdvice({ decision: 'skip', reason: 'Ничего не нужно' }, [])
    assert.equal(result.ok, true)
    assert.equal(result.advice.decision, 'skip')
})

test('строит контекст с ограничениями и историей', () => {
    const result = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE })
    const context = JSON.parse(buildCareAdviceContext({
        plant: plant(),
        candidates: result.candidates,
        recentAdvice: [advice({ createdAt: new Date('2026-10-09T10:00:00+03:00') })],
        careHints: {
            watering_answers: [{ question: 'Как быстро просыхает грунт?', answer: 'За неделю' }],
            watering_advice: { intervalDays: 8, confidence: 'medium' }
        },
        seasonInfo: result.seasonInfo,
        group: result.group,
        now: NOW,
        timeZone: TIME_ZONE
    }))

    assert.equal(context.plant.group, result.group.title)
    assert.equal(context.season, 'autumn')
    assert.equal(context.careHints.wateringAdvice.intervalDays, 8)
    assert.equal(context.recentAdvice[0].actionCode, 'spray')
    assert.ok(context.allowedActions.some(item => item.code === 'pest_check'))
})

test('динамический план позволяет чаще двух раз в месяц', () => {
    const plan = {
        spray: {
            minIntervalDays: 3,
            maxPerMonth: 8,
            seasons: ['winter', 'spring', 'summer', 'autumn']
        }
    }
    const history = [
        advice({ createdAt: new Date('2026-10-15T10:00:00+03:00') }),
        advice({ createdAt: new Date('2026-10-12T10:00:00+03:00') })
    ]

    const result = getCareCandidates({
        plant: plant(),
        history,
        now: NOW,
        timeZone: TIME_ZONE,
        plan
    })
    const spray = result.candidates.find(item => item.code === 'spray')

    assert.ok(spray)
    assert.equal(spray.maxPerMonth, 8)
    assert.equal(spray.minIntervalDays, 3)
})

test('динамический план останавливает опрыскивание после восьми раз в месяце', () => {
    const plan = {
        spray: {
            minIntervalDays: 3,
            maxPerMonth: 8,
            seasons: ['winter', 'spring', 'summer', 'autumn']
        }
    }
    const history = Array.from({ length: 8 }, (_, index) => advice({
        createdAt: new Date(`2026-10-${String(index + 1).padStart(2, '0')}T10:00:00+03:00`)
    }))

    const result = getCareCandidates({
        plant: plant(),
        history,
        now: NOW,
        timeZone: TIME_ZONE,
        plan
    })

    assert.ok(!candidateCodes(result).includes('spray'))
})

test('нормализует план и ограничивает опасные значения', () => {
    const group = { id: 'default', title: 'комнатные растения' }
    const plan = normalizeCarePlan({
        spray: { minIntervalDays: 0, maxPerMonth: 30, seasons: ['summer'] }
    }, { plant: plant(), group })

    assert.equal(plan.spray.maxPerMonth, 14)
    assert.equal(plan.spray.minIntervalDays, 2)
    assert.deepEqual(plan.spray.seasons, ['summer'])
})

test('план может полностью отключить действие', () => {
    const group = { id: 'default', title: 'комнатные растения' }
    const plan = normalizeCarePlan({ spray: { maxPerMonth: 0 } }, { plant: plant(), group })
    const result = getCareCandidates({
        plant: plant(),
        now: NOW,
        timeZone: TIME_ZONE,
        plan
    })

    assert.equal(plan.spray.maxPerMonth, 0)
    assert.ok(!candidateCodes(result).includes('spray'))
})

test('базовый план не включает опрыскивание для суккулентов', () => {
    const cactus = plant({ name: 'Кактус', species: 'Mammillaria' })
    const result = getCareCandidates({ plant: cactus, now: NOW, timeZone: TIME_ZONE })
    const plan = buildDefaultCarePlan({ plant: cactus, group: result.group })

    assert.equal(plan.spray, undefined)
    assert.equal(plan.humidity_support, undefined)
})

test('пример плана в промпте не задаёт частое опрыскивание', () => {
    assert.ok(CARE_PLAN_INSTRUCTIONS.includes('"spray":{"minIntervalDays":14'))
    assert.ok(!CARE_PLAN_INSTRUCTIONS.includes('"minIntervalDays":3'))
})

test('sanitizeCarePlan убирает из сохранённого плана действия, запрещённые правилами', () => {
    const storedPlan = {
        spray: { minIntervalDays: 14, maxPerMonth: 2, seasons: ['autumn'] },
        rotate: { minIntervalDays: 14, maxPerMonth: 2, seasons: ['autumn'] }
    }
    const fuzzy = plant({ name: 'Фиалка', species: 'Saintpaulia' })
    const fuzzyResult = getCareCandidates({ plant: fuzzy, now: NOW, timeZone: TIME_ZONE })
    const cleaned = sanitizeCarePlan(storedPlan, { plant: fuzzy, group: fuzzyResult.group })

    assert.equal(cleaned.spray, undefined)
    assert.deepEqual(cleaned.rotate, storedPlan.rotate)

    const monstera = plant()
    const monsteraResult = getCareCandidates({ plant: monstera, now: NOW, timeZone: TIME_ZONE })
    const kept = sanitizeCarePlan(storedPlan, { plant: monstera, group: monsteraResult.group })

    assert.deepEqual(kept.spray, storedPlan.spray)
})

test('summarizeCarePlan делит действия на рекомендованные и исключённые', () => {
    const plan = {
        spray: { minIntervalDays: 14, maxPerMonth: 0, seasons: [] },
        leaf_clean: { minIntervalDays: 14, maxPerMonth: 2, seasons: ['winter', 'spring', 'summer', 'autumn'] },
        fertilize: { minIntervalDays: 14, maxPerMonth: 2, seasons: ['spring', 'summer'] }
    }

    const autumn = summarizeCarePlan(plan, { season: 'autumn' })

    assert.deepEqual(autumn.avoided, ['Опрыскивание'])
    assert.ok(autumn.recommended.includes('Протирание листьев'))
    assert.ok(!autumn.recommended.includes('Подкормка'))
})

test('sanitizeCarePlan не ломается на некорректном плане', () => {
    assert.deepEqual(sanitizeCarePlan(null), {})
    assert.deepEqual(sanitizeCarePlan([]), {})
    assert.deepEqual(sanitizeCarePlan({ unknown_action: {} }), {})
})

test('контекст плана содержит жёсткие границы действий', () => {
    const testPlant = plant()
    const result = getCareCandidates({ plant: testPlant, now: NOW, timeZone: TIME_ZONE })
    const context = JSON.parse(buildCarePlanContext({
        plant: testPlant,
        group: result.group,
        seasonInfo: result.seasonInfo,
        now: NOW,
        timeZone: TIME_ZONE
    }))

    assert.ok(context.actions.some(item => item.code === 'spray' && item.hardMaxPerMonth === 14))
})

test('парсит план из Markdown-обёртки', () => {
    const parsed = parseCarePlan('```json\n{"actions":{"spray":{"minIntervalDays":3,"maxPerMonth":8}}}\n```')

    assert.equal(parsed?.spray?.maxPerMonth, 8)
    assert.equal(parsed?.spray?.minIntervalDays, 3)
})


test('строит запасной совет из первого кандидата', () => {
    const result = getCareCandidates({ plant: plant(), now: NOW, timeZone: TIME_ZONE })
    const fallback = buildFallbackCareAdvice({
        plant: plant(),
        candidates: result.candidates,
        group: result.group
    })

    assert.equal(fallback?.decision, 'recommend')
    assert.equal(fallback?.actionCode, result.candidates[0].code)
    assert.ok(fallback?.title.includes('Монстера'))
    assert.equal(fallback?.confidence, 'low')
})
