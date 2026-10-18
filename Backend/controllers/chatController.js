import { Op } from 'sequelize'
import Plant from '../models/Plant.js'
import ChatLog from '../models/ChatLog.js'
import { analyzePlantPhoto, askAi } from '../services/aiService.js'
import { buildPlantsOverview, resolveLocalChatAnswer } from '../utils/chatIntent.js'
import { appTimeZone } from '../utils/localDay.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import { saveChatPhoto } from '../utils/chatPhoto.js'

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
const MAX_PHOTO_MESSAGE_LENGTH = 1000

async function resolveSession({ userId, guestToken, sessionId, now }) {
    if (sessionId) {
        const ownedSession = await ChatLog.findOne({
            where: {
                session_id: sessionId,
                ...getSessionOwner(userId, guestToken)
            },
            attributes: ['id']
        })
        return ownedSession ? { session: sessionId } : { notFound: true }
    }

    const where = userId
        ? { user_id: userId, role: 'user' }
        : { user_id: null, 'metadata.guestToken': guestToken, role: 'user' }

    const last = await ChatLog.findOne({
        where,
        order: [['created_at', 'DESC']]
    })
    if (!last) return { session: null }

    const hoursSince = (now - new Date(last.created_at)) / (60 * 60 * 1000)
    return { session: hoursSince < SESSION_GAP_HOURS ? last.session_id : null }
}

async function loadRecentHistory({ userId, guestToken, sessionId, excludeId }) {
    const rows = await ChatLog.findAll({
        where: {
            session_id: sessionId,
            ...getSessionOwner(userId, guestToken),
            role: { [Op.in]: ['user', 'assistant'] }
        },
        order: [['created_at', 'DESC']],
        limit: MAX_HISTORY
    })

    return rows
        .reverse()
        .filter(row => row.id !== excludeId && !isDegraded(row))
        .map(row => ({ role: row.role, text: row.text }))
}

async function loadPlantsContext(userId, { limit = MAX_PLANTS_IN_CONTEXT } = {}) {
    if (!userId) return { plants: [], plantsCount: 0 }

    const where = { user_id: userId, is_active: true }
    const [rows, total] = await Promise.all([
        Plant.findAll({
            where,
            order: [['next_watering_at', 'ASC']],
            limit
        }),
        Plant.count({ where })
    ])

    return { plants: rows, plantsCount: total }
}

function visionFailureMessage(error) {
    switch (error?.code) {
        case 'AI_BUDGET_EXCEEDED':
            return 'На сегодня лимит обращений к ИИ исчерпан. Попробуйте завтра 🌱'
        case 'AI_VISION_NOT_CONFIGURED':
            return 'Анализ фото пока недоступен.'
        case 'AI_VISION_UNSUPPORTED_IMAGE':
            return 'Не удалось прочитать фото. Попробуйте JPEG или PNG.'
        default:
            return 'Не получилось разобрать фото. Попробуйте другое фото или повторите позже.'
    }
}

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

            const now = new Date()
            const timeZone = getUserTimeZone(req, userId)

            const resolvedSession = await resolveSession({ userId, guestToken, sessionId, now })
            if (resolvedSession.notFound) {
                return res.status(404).json({ message: 'Сессия не найдена' })
            }
            let session = resolvedSession.session

            const userMsg = await ChatLog.create({
                user_id: userId,
                session_id: session || undefined,
                role: 'user',
                text: message,
                metadata: { ip: req.ip, userAgent: req.headers['user-agent'], guestToken }
            })
            session = userMsg.session_id

            const history = await loadRecentHistory({
                userId,
                guestToken,
                sessionId: session,
                excludeId: userMsg.id
            })


            const { plants, plantsCount } = await loadPlantsContext(userId)

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

    async analyzePhoto(req, res) {
        try {
            const userId = getUserId(req)
            const guestToken = req.guestToken
            const file = req.file

            if (!file?.buffer?.length) {
                return res.status(400).json({ message: 'Фото не загружено' })
            }

            const { sessionId } = req.body || {}
            if (sessionId && !isSessionId(sessionId)) {
                return res.status(400).json({ message: 'Некорректный sessionId' })
            }

            const rawMessage = req.body?.message
            const message = typeof rawMessage === 'string'
                ? rawMessage.trim().slice(0, MAX_PHOTO_MESSAGE_LENGTH)
                : ''
            const now = new Date()
            const timeZone = getUserTimeZone(req, userId)

            const resolvedSession = await resolveSession({ userId, guestToken, sessionId, now })
            if (resolvedSession.notFound) {
                return res.status(404).json({ message: 'Сессия не найдена' })
            }
            let session = resolvedSession.session

            const photo = await saveChatPhoto(file.buffer)
            const photoUrl = `${req.protocol}://${req.get('host')}/uploads/chat/${photo.filename}`

            const userMsg = await ChatLog.create({
                user_id: userId,
                session_id: session || undefined,
                role: 'user',
                text: message || 'Фото растения для диагностики',
                metadata: {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    guestToken,
                    photoUrl
                }
            })
            session = userMsg.session_id

            let result
            try {
                result = await analyzePlantPhoto({
                    imageBuffer: file.buffer,
                    question: message,
                    timeZone
                })
            } catch (visionError) {
                const budgetExceeded = visionError?.code === 'AI_BUDGET_EXCEEDED'
                const failureText = visionFailureMessage(visionError)

                await ChatLog.create({
                    user_id: userId,
                    session_id: session,
                    role: 'assistant',
                    text: failureText,
                    error: visionError.message || 'AI vision error',
                    metadata: {
                        guestToken,
                        photoUrl,
                        degraded: true,
                        degradeReason: budgetExceeded ? 'budget' : (visionError.code || 'vision-error')
                    }
                })

                console.warn('⚠️ Анализ фото без модели:', visionError.message || visionError)

                if (!userId && budgetExceeded) {
                    return res.status(503).json({
                        message: 'На сегодня лимит анализа фото исчерпан — продолжим завтра 🌱'
                    })
                }

                return res.json({
                    text: failureText,
                    sessionId: session,
                    photoUrl,
                    degraded: true
                })
            }

            await ChatLog.create({
                user_id: userId,
                session_id: session,
                role: 'assistant',
                text: result.text,
                input_tokens: result.usage?.input_tokens || null,
                output_tokens: result.usage?.output_tokens || null,
                metadata: {
                    guestToken,
                    photoUrl,
                    diagnosis: result.diagnosis,
                    source: result.source,
                    latencyMs: result.latencyMs
                }
            })

            return res.json({
                text: result.text,
                sessionId: session,
                photoUrl,
                diagnosis: result.diagnosis,
                source: result.source,
                cached: result.cached,
                usage: result.usage
            })
        } catch (error) {
            console.error('❌ Ошибка анализа фото в чате:', error)

            const unsupportedCodes = [
                'CHAT_PHOTO_EMPTY',
                'CHAT_PHOTO_UNSUPPORTED',
                'AI_VISION_NO_IMAGE',
                'AI_VISION_UNSUPPORTED_IMAGE'
            ]
            if (unsupportedCodes.includes(error?.code)) {
                return res.status(400).json({ message: 'Не удалось прочитать фото. Попробуйте JPEG или PNG.' })
            }

            const unavailableCodes = [
                'CHAT_PHOTO_UNAVAILABLE',
                'AI_VISION_UNAVAILABLE',
                'AI_VISION_NOT_CONFIGURED'
            ]
            if (unavailableCodes.includes(error?.code)) {
                return res.status(503).json({ message: 'Обработка фото временно недоступна' })
            }

            return res.status(500).json({ message: 'Не удалось проанализировать фото. Попробуйте позже.' })
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
                    degraded: isDegraded(r) || undefined,
                    photoUrl: r.metadata?.photoUrl || null,
                    diagnosis: r.metadata?.diagnosis || null
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
