import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import ChatLog from '../models/ChatLog.js'
import { askAi } from '../services/aiService.js'
import { buildPlantsOverview, resolveLocalChatAnswer } from '../utils/chatIntent.js'
import { appTimeZone } from '../utils/localDay.js'
import { resolveTimeZone } from '../utils/timeZone.js'

function getUserId(req) {
    return req.user?.id ?? null
}

function getUserTimeZone(req, userId) {
    if (!userId) return appTimeZone()
    return resolveTimeZone(req.user?.timezone)
}

function getSessionOwner(userId, guestToken) {
    return userId
        ? { user_id: userId }
        : { user_id: null, 'metadata.guestToken': guestToken }
}

function isDegraded(row) {
    return Boolean(row?.metadata?.degraded)
}

function isSessionId(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const MAX_HISTORY = 20          
const SESSION_GAP_HOURS = 6
const MAX_PLANTS_IN_CONTEXT = 50

class ChatController {

    async send(req, res) {
        try {
            const userId = getUserId(req)
            const guestToken = req.guestToken
            const { message, sessionId } = req.body || {}

            if (!message || typeof message !== 'string') {
                return res.status(400).json({ message: 'Сообщение обязательно' })
            }
            if (message.length > 1000) {
                return res.status(400).json({ message: 'Сообщение слишком длинное' })
            }
            if (sessionId && !isSessionId(sessionId)) {
                return res.status(400).json({ message: 'Некорректный sessionId' })
            }

            let session = sessionId
            const now = new Date()
            const timeZone = getUserTimeZone(req, userId)

            if (session) {
                const ownedSession = await ChatLog.findOne({
                    where: {
                        session_id: session,
                        ...getSessionOwner(userId, guestToken)
                    },
                    attributes: ['id']
                })
                if (!ownedSession) {
                    return res.status(404).json({ message: 'Сессия не найдена' })
                }
            }

            if (!session) {
                const where = userId
                    ? { user_id: userId, role: 'user' }
                    : { user_id: null, 'metadata.guestToken': guestToken, role: 'user' }

                const last = await ChatLog.findOne({
                    where,
                    order: [['created_at', 'DESC']]
                })

                if (last) {
                    const hoursSince = (now - new Date(last.created_at)) / (60 * 60 * 1000)
                    session = hoursSince < SESSION_GAP_HOURS
                        ? last.session_id
                        : null   
                }
            }


            const userMsg = await ChatLog.create({
                user_id: userId,
                session_id: session || undefined,  
                role: 'user',
                text: message,
                metadata: { ip: req.ip, userAgent: req.headers['user-agent'], guestToken }
            })
            session = userMsg.session_id


            const historyRows = await ChatLog.findAll({
                where: {
                    session_id: session,
                    ...getSessionOwner(userId, guestToken),
                    role: { [Op.in]: ['user', 'assistant'] }
                },
                order: [['created_at', 'DESC']],
                limit: MAX_HISTORY
            })


            const history = historyRows
                .reverse()
                .filter(r => r.id !== userMsg.id && !isDegraded(r))
                .map(r => ({ role: r.role, text: r.text }))


            let plants = []
            let plantsCount = 0
            if (userId) {
                const plantsWhere = { user_id: userId, is_active: true }
                const [rows, total] = await Promise.all([
                    Plant.findAll({
                        where: plantsWhere,
                        order: [['next_watering_at', 'ASC']],
                        limit: MAX_PLANTS_IN_CONTEXT
                    }),
                    Plant.count({ where: plantsWhere })
                ])
                plants = rows
                plantsCount = total
            }

            const plantContext = plants.map(p => ({
                name: p.name,
                species: p.species,
                location: p.location,
                lastWatered: p.last_watered_at,
                nextWatering: p.next_watering_at,
                intervalDays: p.watering_interval_days
            }))


            const localAnswer = resolveLocalChatAnswer({
                message,
                plants: plantContext,
                isAuthorized: !!userId,
                now,
                timeZone
            })

            if (localAnswer) {
                await ChatLog.create({
                    user_id: userId,
                    session_id: session,
                    role: 'assistant',
                    text: localAnswer.text,
                    metadata: { guestToken, local: true, intent: localAnswer.intent }
                })

                return res.json({
                    text: localAnswer.text,
                    sessionId: session,
                    usage: null,
                    local: true
                })
            }

            let answer
            try {
                answer = await askAi({
                    message,
                    history,
                    timeZone,
                    context: {
                        isAuthorized: !!userId,
                        plantsCount,
                        plants: plantContext,
                        today: now.toISOString(),
                        timeZone
                    }
                })
            } catch (aiError) {
                const budgetExceeded = aiError?.code === 'AI_BUDGET_EXCEEDED'
                const degradedText = buildPlantsOverview({
                    plants: plantContext,
                    isAuthorized: !!userId,
                    now,
                    timeZone
                })

                await ChatLog.create({
                    user_id: userId,
                    session_id: session,
                    role: 'assistant',
                    text: degradedText,
                    error: aiError.message || 'AI error',
                    metadata: {
                        guestToken,
                        degraded: true,
                        degradeReason: budgetExceeded ? 'budget' : (aiError.code || 'ai-error')
                    }
                })

                console.warn('⚠️ Чат без модели, отвечаю по данным приложения:', aiError.message || aiError)

                if (!userId && budgetExceeded) {
                    return res.status(503).json({
                        message: 'Алиса сегодня ответила на максимум вопросов — продолжим завтра 🌱'
                    })
                }

                return res.json({
                    text: userId
                        ? `${degradedText}

(Модель сейчас недоступна, поэтому отвечаю по данным приложения.)`
                        : 'Модель сейчас недоступна. Попробуйте, пожалуйста, чуть позже.',
                    sessionId: session,
                    usage: null,
                    degraded: true
                })
            }

            await ChatLog.create({
                user_id: userId,
                session_id: session,
                role: 'assistant',
                text: answer.text,
                input_tokens: answer.usage?.input_tokens || null,
                output_tokens: answer.usage?.output_tokens || null,
                metadata: { guestToken }
            })

            return res.json({
                text: answer.text,
                sessionId: session,
                usage: answer.usage
            })
        } catch (error) {
            console.error('❌ Ошибка чата:', error)
            return res.status(500).json({ message: 'Алиса задумалась, попробуй позже' })
        }
    }


    async history(req, res) {
        try {
            const userId = getUserId(req)
            const guestToken = req.guestToken
            const { sessionId, limit = 50 } = req.query

            if (sessionId && !isSessionId(sessionId)) {
                return res.status(400).json({ message: 'Некорректный sessionId' })
            }

            let activeSession = sessionId
            if (!activeSession) {
                const latest = await ChatLog.findOne({
                    where: getSessionOwner(userId, guestToken),
                    attributes: ['session_id'],
                    order: [['created_at', 'DESC'], ['id', 'DESC']]
                })
                activeSession = latest?.session_id
            }
            if (!activeSession) {
                return res.json({ sessionId: null, items: [] })
            }

            const where = {
                ...getSessionOwner(userId, guestToken),
                session_id: activeSession
            }
            const parsedLimit = Number.parseInt(limit, 10)

            const rows = await ChatLog.findAll({
                where,
                order: [['created_at', 'DESC']],
                limit: Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 200)) : 50
            })

            const items = rows
                .reverse()
                .map(r => ({
                    id: r.id,
                    role: r.role,
                    text: r.text,
                    createdAt: r.created_at,
                    degraded: isDegraded(r) || undefined
                }))

            return res.json({
                sessionId: activeSession,
                items
            })
        } catch (error) {
            console.error('❌ Ошибка истории:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }


    async clear(req, res) {
        try {
            const userId = getUserId(req)
            const guestToken = req.guestToken
            const { sessionId } = req.body || {}

            if (!sessionId) {
                return res.status(400).json({ message: 'sessionId обязателен' })
            }
            if (!isSessionId(sessionId)) {
                return res.status(400).json({ message: 'Некорректный sessionId' })
            }

            const where = {
                session_id: sessionId,
                ...getSessionOwner(userId, guestToken)
            }

            await ChatLog.destroy({ where })

            return res.json({ message: 'Чат очищен' })
        } catch (error) {
            console.error('❌ Ошибка очистки:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new ChatController()