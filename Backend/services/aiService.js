import OpenAI from 'openai'
import dotenv from 'dotenv'

dotenv.config()

const FOLDER = process.env.YANDEX_CLOUD_FOLDER
const API_KEY = process.env.YANDEX_CLOUD_API_KEY
const MODEL = process.env.YANDEX_CLOUD_MODEL || 'deepseek-v4-flash/latest'

const client = FOLDER && API_KEY ? new OpenAI({
    apiKey: API_KEY,
    baseURL: 'https://ai.api.cloud.yandex.net/v1',
    timeout: 30_000,
    maxRetries: 1,
    defaultHeaders: {
        'OpenAI-Project': FOLDER
    }
}) : null

if (!client) {
    console.warn('⚠️ YANDEX_CLOUD_FOLDER или YANDEX_CLOUD_API_KEY не заданы; чат с ИИ отключён')
}

const SYSTEM_PROMPT = `Ты — Алиса, дружелюбный помощник приложения «Лейка» (CheckThePlants).

ТВОИ ЗАДАЧИ:
- Помогать пользователю поливать растения вовремя
- Отвечать на вопросы об уходе, болезнях, освещении, пересадке
- Показывать, что пора полить, когда пользователь спрашивает
- Отвечать на вопросы о самом приложении (как добавить растение, как работает напоминание)

ПРАВИЛА:
- Отвечай кратко, дружелюбно, по делу
- Используй эмодзи умеренно (🌱💚💧)
- Если вопрос не о растениях и не о приложении — мягко верни разговор к теме
- Не выдумывай факты. Если не знаешь — скажи честно
- Список растений выводи через перенос строки с маркером •
- Максимум 3-4 предложения, если не просят подробнее

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{context}`

function buildContext(context) {
    if (!context.isAuthorized) {
        return 'Пользователь не авторизован. Если спрашивает о своих растениях — предложи войти в приложение.'
    }

    if (context.plantsCount === 0) {
        return 'У пользователя пока нет растений. Если спрашивает о поливе — предложи добавить на вкладке «Растения».'
    }

    const now = new Date(context.today)
    const plantsList = context.plants.map(p => {
        const next = p.nextWatering ? new Date(p.nextWatering) : null
        const diffDays = next
            ? Math.floor((next - now) / (24 * 60 * 60 * 1000))
            : null

        let status
        if (diffDays === null) status = 'срок не задан'
        else if (diffDays < -1) status = `просрочен на ${-diffDays} дн.`
        else if (diffDays === -1) status = 'просрочен на 1 день'
        else if (diffDays === 0) status = 'пора полить сегодня'
        else if (diffDays === 1) status = 'завтра'
        else status = `через ${diffDays} дн.`

        return `• ${p.name}${p.location ? ` (${p.location})` : ''} — ${status}`
    }).join('\n')

    return `Сегодня: ${now.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    })}.
Всего растений: ${context.plantsCount}.
Список:
${plantsList}`
}

/**
 * Отправить запрос в агента Yandex AI Studio через OpenAI-совместимый API.
 *
 * @param {Object} params
 * @param {string} params.message — текущее сообщение юзера
 * @param {Array}  params.history — [{ role: 'user'|'assistant', text: '...' }]
 * @param {Object} params.context — данные о юзере и растениях
 * @returns {Promise<{text: string, usage: Object|null}>}
 */
export async function askAi({ message, history = [], context }) {
    if (!client) {
        throw new Error('AI service is not configured')
    }

    const contextText = buildContext(context)
    const instructions = SYSTEM_PROMPT.replace('{context}', contextText)


    const input = [
        ...history.slice(-10).map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.text || '').slice(0, 2000)
        })),
        { role: 'user', content: message }
    ]

    try {
        const response = await client.responses.create({
            model: `gpt://${FOLDER}/${MODEL}`,
            instructions,
            input,
            temperature: 0.6,
            max_output_tokens: 800,
            store: false,
            truncation: 'disabled'
        })

        const text = response.output_text || 'Не удалось получить ответ'

        return {
            text,
            usage: response.usage || null
        }
    } catch (error) {
        console.error('❌ Yandex Cloud AI error:', error.message || error)
        if (error.response?.data) {
            console.error('   Детали:', JSON.stringify(error.response.data).slice(0, 500))
        }
        throw new Error('AI временно недоступен')
    }
}