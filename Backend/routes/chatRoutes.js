import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import chatController from '../controllers/chatController.js'
import { optionalAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(optionalAuth)

const DAY_MS = 24 * 60 * 60 * 1000

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const GUEST_DAILY_LIMIT = positiveInt(process.env.AI_CHAT_GUEST_DAILY_LIMIT, 40)
const USER_DAILY_LIMIT = positiveInt(process.env.AI_CHAT_USER_DAILY_LIMIT, 300)

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { message: 'Слишком много сообщений. Подожди минуту 🌱' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat')
})

const chatGuestDailyLimiter = rateLimit({
    windowMs: DAY_MS,
    limit: GUEST_DAILY_LIMIT,
    skip: req => Boolean(req.user),
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: {
        message: 'На сегодня лимит сообщений исчерпан. Зарегистрируйтесь — и продолжим без ограничений 🌱'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat-guest-daily')
})

const chatUserDailyLimiter = rateLimit({
    windowMs: DAY_MS,
    limit: USER_DAILY_LIMIT,
    skip: req => !req.user,
    keyGenerator: (req) => String(req.user.id),
    message: {
        message: 'На сегодня лимит сообщений исчерпан. Алиса вернётся завтра 🌱'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat-user-daily')
})

const chatHistoryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { message: 'Слишком много запросов истории. Подожди минуту 🌱' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat-history')
})

router.post('/chat', chatLimiter, chatGuestDailyLimiter, chatUserDailyLimiter, chatController.send)
router.get('/history', chatHistoryLimiter, chatController.history)
router.delete('/history', chatHistoryLimiter, chatController.clear)

export default router
