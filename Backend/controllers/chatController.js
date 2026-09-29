import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import ChatLog from '../models/ChatLog.js'
import { askAi } from '../services/aiService.js'

function getUserId(req) {
    const token = req.cookies?.token
    if (!token) return null
    try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY)
        return decoded.id
    } catch {
        return null
    }
}

function getSessionOwner(userId, guestToken) {
    return userId
        ? { user_id: userId }
        : { user_id: null, 'metadata.guestToken': guestToken }
}

function isSessionId(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const MAX_HISTORY = 20          
const SESSION_GAP_HOURS = 6    

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
                    role: { [Op.in]: ['user', 'assistant'] },
                    error: null
                },
                order: [['created_at', 'DESC']],
                limit: MAX_HISTORY
            })


            const history = historyRows
                .reverse()
                .filter(r => r.id !== userMsg.id)
                .map(r => ({ role: r.role, text: r.text }))


            let plants = []
            if (userId) {
                plants = await Plant.findAll({
                    where: { user_id: userId, is_active: true },
                    order: [['next_watering_at', 'ASC']],
                    limit: 50
                })
            }

            const plantContext = plants.map(p => ({
                name: p.name,
                species: p.species,
                location: p.location,
                lastWatered: p.last_watered_at,
                nextWatering: p.next_watering_at,
                intervalDays: p.watering_interval_days
            }))


            let answer
            try {
                answer = await askAi({
                    message,
                    history,
                    context: {
                        isAuthorized: !!userId,
                        plantsCount: plants.length,
                        plants: plantContext,
                        today: now.toISOString()
                    }
                })
            } catch (aiError) {

                await ChatLog.create({
                    user_id: userId,
                    session_id: session,
                    role: 'assistant',
                    text: '',
                    error: aiError.message || 'AI error',
                    metadata: { guestToken }
                })
                throw aiError
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
                    where: {
                        ...getSessionOwner(userId, guestToken),
                        error: null
                    },
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
                session_id: activeSession,
                error: null
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
                    createdAt: r.created_at
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