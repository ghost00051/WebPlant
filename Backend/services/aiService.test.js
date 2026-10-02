import test from 'node:test'
import assert from 'node:assert/strict'
import {
    createWateringAdviceResponse,
    extractResponseText,
    normalizeSpeciesSuggestion,
    parseWateringAdvice
} from './aiService.js'

test('species suggestions are trimmed and normalized to a single line', () => {
    assert.equal(
        normalizeSpeciesSuggestion('  Вид растения: Монстера\n(Monstera deliciosa)  '),
        'Монстера (Monstera deliciosa)'
    )
    assert.equal(
        normalizeSpeciesSuggestion('Вероятно, это томат «Дюймовочка» (Solanum lycopersicum). Это ранний сорт...'),
        'томат «Дюймовочка» (Solanum lycopersicum)'
    )
    assert.equal(
        normalizeSpeciesSuggestion('• Помидор «Дюймовочка» — ранний сорт для выращивания в горшках. Подходит для балкона.'),
        'Помидор «Дюймовочка» — ранний сорт для выращивания в горшках'
    )
    assert.equal(normalizeSpeciesSuggestion(''), null)
    assert.equal(normalizeSpeciesSuggestion(`${'x'.repeat(256)}. More details`), null)
    assert.equal(normalizeSpeciesSuggestion(null), null)
})

test('AI response text extraction supports Responses API content output', () => {
    assert.equal(
        extractResponseText({
            output: [
                { type: 'reasoning', content: [] },
                {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Томат Дюймовочка' }]
                }
            ]
        }),
        'Томат Дюймовочка'
    )
    assert.equal(
        extractResponseText({
            output_text: '  Томат Дюймовочка  ',
            output: []
        }),
        'Томат Дюймовочка'
    )
    assert.equal(extractResponseText({ output: [{ type: 'reasoning', content: [] }] }), '')
})

test('watering advice parser accepts questions and bounded recommendations', () => {
    assert.deepEqual(
        parseWateringAdvice('{"type":"question","question":"Растение стоит в помещении или на улице?"}'),
        { type: 'question', question: 'Растение стоит в помещении или на улице?' }
    )
    assert.deepEqual(
        parseWateringAdvice('```json\n{"type":"recommendation","intervalDays":7,"reason":"Проверяйте просыхание грунта.","confidence":"medium"}\n```'),
        {
            type: 'recommendation',
            intervalDays: 7,
            reason: 'Проверяйте просыхание грунта.',
            confidence: 'medium'
        }
    )
    assert.equal(
        parseWateringAdvice('{"type":"question","question":"Ещё вопрос?"}', { questionCount: 4 }),
        null
    )
    assert.equal(
        parseWateringAdvice('{"type":"recommendation","intervalDays":0,"reason":"Плохо","confidence":"high"}'),
        null
    )
    assert.equal(
        parseWateringAdvice('{"type":"recommendation","intervalDays":7,"reason":"","confidence":"high"}'),
        null
    )
})

test('watering advice retries once with a larger output budget after token exhaustion', async () => {
    const budgets = []
    const aiClient = {
        responses: {
            create: async request => {
                budgets.push(request.max_output_tokens)
                return budgets.length === 1
                    ? {
                        status: 'incomplete',
                        incomplete_details: { reason: 'max_output_tokens' }
                    }
                    : { status: 'completed', output_text: '{"type":"question","question":"Где стоит растение?"}' }
            }
        }
    }

    const response = await createWateringAdviceResponse(aiClient, {
        model: 'test',
        input: []
    })

    assert.deepEqual(budgets, [2000, 4000])
    assert.equal(response.status, 'completed')
})

test('watering advice does not retry failures unrelated to output-token exhaustion', async () => {
    let calls = 0
    const aiClient = {
        responses: {
            create: async () => {
                calls++
                return {
                    status: 'incomplete',
                    incomplete_details: { reason: 'content_filter' }
                }
            }
        }
    }

    await createWateringAdviceResponse(aiClient, { model: 'test', input: [] })
    assert.equal(calls, 1)
})
