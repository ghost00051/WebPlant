import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import chatController from '../controllers/chatController.js'
import { optionalAuth } from '../middleware/auth.js'
import { uploadChatPhoto, validateChatPhoto } from '../middleware/upload.js'
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

const chatPhotoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 12,
    keyGenerator: (req) => req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip),
    message: { message: 'Слишком много фото за час. Подожди немного 🌱' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat-photo')
})

function chatPhotoUpload(req, res, next) {
    uploadChatPhoto.single('photo')(req, res, error => {
        if (!error) return next()

        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'Фото слишком большое. Максимум 5 МБ.' })
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ message: 'Можно прикрепить только одно фото' })
        }
        return next(error)
    })
}

router.post('/chat', chatLimiter, chatGuestDailyLimiter, chatUserDailyLimiter, chatController.send)
router.post(
    '/photo',
    chatLimiter,
    chatPhotoLimiter,
    chatGuestDailyLimiter,
    chatUserDailyLimiter,
    chatPhotoUpload,
    validateChatPhoto,
    chatController.analyzePhoto
)
router.get('/history', chatHistoryLimiter, chatController.history)
router.delete('/history', chatHistoryLimiter, chatController.clear)

export default router
