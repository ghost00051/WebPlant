import {
    askAi,
    suggestPlantSpecies,
    suggestWateringAdvice,
    suggestWateringTimeAdvice
} from '../services/aiService.js'

const WINTER = new Date('2026-01-15T09:00:00Z')
const SUMMER = new Date('2026-07-15T09:00:00Z')

const answers = (...items) => items.map(([question, answer]) => ({ question, answer }))

const typicalMonsteraAnswers = answers(
    ['Где стоит и сколько света?', 'Восточное окно, рассеянный свет 4 часа утром'],
    ['Какой горшок и есть ли дренаж?', 'Керамический 5 л, дренаж и поддон есть'],
    ['Как быстро просыхает грунт?', 'Верхние 3 см сухие примерно за неделю']
)

const CASES = [
    {
        id: 'cactus-first-step',
        title: 'Кактус: первый шаг — вопрос про просыхание грунта',
        run: () => suggestWateringAdvice({ plantName: 'Кактус', species: 'Opuntia' }),
        expect: advice => [
            [advice.type === 'question', 'вернулся уточняющий вопрос'],
            [Array.isArray(advice.options) && advice.options.length <= 4, 'вариантов ответа не больше четырёх'],
            [Number(advice.maxQuestions) >= 4, 'клиенту передан лимит вопросов'],
            [/просыхан|грунт|сух|земл/i.test(String(advice.question)), 'вопрос про грунт и просыхание']
        ]
    },
    {
        id: 'orchid-first-step',
        title: 'Орхидея: вопрос про корни и листья',
        run: () => suggestWateringAdvice({ plantName: 'Орхидея', species: 'Phalaenopsis' }),
        expect: advice => [
            [advice.type === 'question', 'вернулся уточняющий вопрос'],
            [String(advice.question || '').length > 10, 'вопрос содержательный']
        ],
        soft: advice => [
            [/корн|лист|горшок|просыхан/i.test(String(advice.question)), 'упомянуты корни, листья или грунт']
        ]
    },
    {
        id: 'basil-first-step',
        title: 'Базилик: вопрос про место и свет',
        run: () => suggestWateringAdvice({ plantName: 'Базилик', species: 'Ocimum basilicum' }),
        expect: advice => [
            [advice.type === 'question', 'вернулся уточняющий вопрос']
        ],
        soft: advice => [
            [/окн|балкон|свет|мест|тепл/i.test(String(advice.question)), 'упомянуты место или свет']
        ]
    },
    {
        id: 'monstera-recommendation',
        title: 'Монстера с условиями: рекомендация в разумном коридоре',
        run: () => suggestWateringAdvice({
            plantName: 'Монстера',
            species: 'Monstera deliciosa',
            answers: typicalMonsteraAnswers
        }),
        expect: advice => [
            [advice.type === 'recommendation', 'вернулась рекомендация, а не вопрос'],
            [Number.isInteger(advice.intervalDays) && advice.intervalDays >= 4 && advice.intervalDays <= 14,
                'интервал в коридоре 4–14 дней'],
            [['medium', 'high'].includes(advice.confidence), 'уверенность medium или high, а не low']
        ]
    },
    {
        id: 'unknown-plant',
        title: 'Неизвестное растение: без ложной уверенности',
        run: () => suggestWateringAdvice({ plantName: 'Абвгд', species: '' }),
        expect: advice => [
            [['question', 'recommendation'].includes(advice.type), 'ответ одного из двух типов'],
            [advice.type !== 'recommendation' || advice.confidence !== 'high',
                'при неизвестном виде нет уверенности high'],
            [advice.type !== 'recommendation' || (advice.intervalDays >= 1 && advice.intervalDays <= 30),
                'интервал в широком допустимом коридоре']
        ]
    },
    {
        id: 'forced-recommendation',
        title: 'Режим рекомендации: отвечает рекомендацией без вопросов',
        run: () => suggestWateringAdvice({
            plantName: 'Фикус Бенджамина',
            species: 'Ficus benjamina',
            mode: 'recommendation'
        }),
        expect: advice => [
            [advice.type === 'recommendation', 'рекомендация без уточняющих вопросов'],
            [/грунт|провер/i.test(String(advice.reason)), 'в причине есть проверка грунта']
        ]
    },
    {
        id: 'forced-question',
        title: 'Режим вопроса: спрашивает даже при готовности ответить',
        run: () => suggestWateringAdvice({
            plantName: 'Сансевиерия',
            species: 'Sansevieria trifasciata',
            mode: 'question'
        }),
        expect: advice => [
            [advice.type === 'question', 'вернулся вопрос'],
            [String(advice.question || '').trim().length > 0, 'вопрос не пустой'],
            [/[?？]$/.test(String(advice.question || '').trim()), 'вопрос заканчивается знаком вопроса']
        ]
    },
    {
        id: 'questions-counted',
        title: 'Счётчик вопросов отражает число ответов пользователя',
        run: () => suggestWateringAdvice({
            plantName: 'Монстера',
            species: 'Monstera deliciosa',
            answers: typicalMonsteraAnswers.slice(0, 2)
        }),
        expect: advice => [
            [advice.questionsAsked === 2, 'questionsAsked = 2'],
            [Number.isInteger(advice.questionsLeft) && advice.questionsLeft === advice.maxQuestions - 2,
                'остаток вопросов посчитан от лимита']
        ]
    },
    {
        id: 'cactus-winter-summer',
        title: 'Кактус: зимой не чаще, чем летом',
        run: async () => {
            const winter = await suggestWateringAdvice({
                plantName: 'Кактус',
                species: 'Opuntia',
                mode: 'recommendation',
                now: WINTER
            })
            const summer = await suggestWateringAdvice({
                plantName: 'Кактус',
                species: 'Opuntia',
                mode: 'recommendation',
                now: SUMMER
            })
            return { winter, summer }
        },
        expect: ({ winter, summer }) => [
            [winter.type === 'recommendation' && summer.type === 'recommendation', 'обе рекомендации получены'],
            [winter.intervalDays >= summer.intervalDays, `зимой (${winter.intervalDays}) не чаще, чем летом (${summer.intervalDays})`]
        ]
    },
    {
        id: 'time-tomato-balcony',
        title: 'Томат на балконе летом: вечер или утро',
        run: () => suggestWateringTimeAdvice({
            plantName: 'Томат',
            species: 'Solanum lycopersicum',
            intervalDays: 2,
            location: 'Балкон, южная сторона',
            now: SUMMER
        }),
        expect: advice => [
            [['morning', 'day', 'evening'].includes(advice.timeOfDay), 'время суток из допустимых'],
            [['evening', 'morning'].includes(advice.timeOfDay), 'для жаркого балкона не выбран день'],
            [/грунт|влажн|провер/i.test(String(advice.reason)), 'в причине сказано, что проверять']
        ]
    },
    {
        id: 'time-cactus-winter',
        title: 'Кактус зимой: день или утро, но не вечер',
        run: () => suggestWateringTimeAdvice({
            plantName: 'Кактус',
            species: 'Opuntia',
            intervalDays: 21,
            now: WINTER
        }),
        expect: advice => [
            [['morning', 'day', 'evening'].includes(advice.timeOfDay), 'время суток из допустимых'],
            [advice.timeOfDay !== 'evening', 'зимой не советует вечер']
        ],
        soft: advice => [
            [['morning', 'day'].includes(advice.timeOfDay), 'выбрано утро или день']
        ]
    },
    {
        id: 'time-fern-summer',
        title: 'Папоротник летом: время суток допустимое',
        run: () => suggestWateringTimeAdvice({
            plantName: 'Нефролепис',
            species: 'Nephrolepis exaltata',
            intervalDays: 3,
            now: SUMMER
        }),
        expect: advice => [
            [['morning', 'day', 'evening'].includes(advice.timeOfDay), 'время суток из допустимых'],
            [String(advice.reason || '').length > 20, 'причина содержательная']
        ],
        soft: advice => [
            [advice.timeOfDay === 'morning', 'для папоротника выбрано утро']
        ]
    },
    {
        id: 'species-monstera',
        title: 'Вид растения: монстера определяется',
        run: () => suggestPlantSpecies('монстера'),
        expect: species => [
            [typeof species === 'string' && species.length > 2, 'вернулось название'],
            [/монстер|monstera/i.test(String(species)), 'в ответе есть монстера']
        ]
    },
    {
        id: 'species-unknown-fallback',
        title: 'Вид растения: мусорный ввод не ломает подсказку',
        run: () => suggestPlantSpecies('ыфва'),
        expect: species => [
            [typeof species === 'string' && species.length > 0, 'вернулось хоть что-то осмысленное']
        ],
        soft: species => [
            [String(species).length <= 60, 'ответ короткий, без рассуждений']
        ]
    },
    {
        id: 'chat-counts-plants',
        title: 'Чат: считает растения из контекста',
        run: () => askAi({
            message: 'Сколько у меня растений?',
            history: [],
            context: {
                isAuthorized: true,
                plantsCount: 3,
                plants: [
                    { name: 'Монстера', species: 'Monstera deliciosa', nextWatering: '2026-10-17T06:00:00Z' },
                    { name: 'Фикус', species: 'Ficus benjamina', nextWatering: '2026-10-20T06:00:00Z' },
                    { name: 'Кактус', species: 'Opuntia', nextWatering: '2026-10-30T06:00:00Z' }
                ],
                today: '2026-10-16T09:00:00Z'
            }
        }),
        expect: answer => [
            [/\b3\b|три/i.test(String(answer.text)), 'в ответе есть число 3'],
            [String(answer.text).length > 10, 'ответ содержательный']
        ]
    },
    {
        id: 'chat-what-to-water',
        title: 'Чат: подсказывает, что полить, по данным приложения',
        run: () => askAi({
            message: 'Что полить сегодня?',
            history: [],
            context: {
                isAuthorized: true,
                plantsCount: 2,
                plants: [
                    { name: 'Монстера', species: 'Monstera deliciosa', nextWatering: '2026-10-15T06:00:00Z' },
                    { name: 'Кактус', species: 'Opuntia', nextWatering: '2026-10-30T06:00:00Z' }
                ],
                today: '2026-10-16T09:00:00Z'
            }
        }),
        expect: answer => [
            [/монстер/i.test(String(answer.text)), 'упомянута монстера, которой пора пить'],
            [String(answer.text).length > 10, 'ответ содержательный']
        ]
    }
]

function evaluate(result, caseItem) {
    const hard = []
    const soft = []

    if (caseItem.expect) {
        try {
            for (const [ok, label] of caseItem.expect(result)) hard.push({ ok: Boolean(ok), label })
        } catch (error) {
            hard.push({ ok: false, label: `проверка упала: ${error.message}` })
        }
    }
    if (caseItem.soft) {
        try {
            for (const [ok, label] of caseItem.soft(result)) soft.push({ ok: Boolean(ok), label })
        } catch (error) {
            soft.push({ ok: false, label: `мягкая проверка упала: ${error.message}` })
        }
    }
    return { hard, soft }
}

function sourceOf(result) {
    if (!result || typeof result !== 'object') return null
    if (result.source) return result.source
    if (result.cached) return 'cache'
    return null
}

function usageOf(result) {
    return result?.usage || null
}

function statusIcon(hard, soft) {
    if (hard.some(check => !check.ok)) return '✖'
    if (soft.some(check => !check.ok)) return '⚠'
    return '✔'
}

async function main() {
    const args = process.argv.slice(2)
    const asJson = args.includes('--json')
    const only = args.find(arg => arg.startsWith('--only='))?.slice('--only='.length)

    const selected = only ? CASES.filter(item => item.id === only) : CASES
    if (!selected.length) {
        console.error(`Не найдено ни одного кейса по фильтру «${only}»`)
        process.exit(2)
    }

    const results = []
    let tokensIn = 0
    let tokensOut = 0

    for (const caseItem of selected) {
        const startedAt = Date.now()
        let result = null
        let error = null
        try {
            result = await caseItem.run()
        } catch (runError) {
            error = runError
        }
        const latencyMs = Date.now() - startedAt

        const usage = usageOf(result)
        if (usage) {
            tokensIn += Number(usage.input_tokens) || 0
            tokensOut += Number(usage.output_tokens) || 0
        }

        const { hard, soft } = error
            ? { hard: [{ ok: false, label: `запрос упал: ${error.message}` }], soft: [] }
            : evaluate(result, caseItem)

        results.push({
            id: caseItem.id,
            title: caseItem.title,
            status: statusIcon(hard, soft),
            passed: hard.every(check => check.ok),
            hard,
            soft,
            latencyMs,
            source: sourceOf(result),
            error: error ? error.message : null
        })
    }

    const passed = results.filter(item => item.passed).length

    if (asJson) {
        console.log(JSON.stringify({
            passed,
            total: results.length,
            tokensIn,
            tokensOut,
            results
        }, null, 2))
    } else {
        console.log('\n🧪 Eval Алисы\n')
        for (const item of results) {
            const source = item.source ? ` [${item.source}]` : ''
            console.log(`${item.status} ${item.id} — ${item.title} (${item.latencyMs} мс)${source}`)
            for (const check of item.hard) {
                if (!check.ok) console.log(`    ✖ ${check.label}`)
            }
            for (const check of item.soft) {
                if (!check.ok) console.log(`    ⚠ ${check.label} (мягкая проверка)`)
            }
            if (item.error) console.log(`    ✖ ${item.error}`)
        }
        console.log(`\nИтог: ${passed}/${results.length} кейсов без жёстких ошибок`)
        console.log(`Токены: вход ${tokensIn}, выход ${tokensOut}`)
        console.log('Мягкие предупреждения не влияют на результат — это наблюдения за качеством.\n')
    }

    process.exit(passed === results.length ? 0 : 1)
}

main().catch(error => {
    console.error('❌ Eval упал:', error)
    process.exit(2)
})
