import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import chatController from '../controllers/chatController.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: (req) => ipKeyGenerator(req.ip),  
    message: { message: 'Слишком много сообщений. Подожди минуту 🌱' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('chat')
})

router.post('/chat', chatLimiter, chatController.send)
router.get('/history', chatController.history)
router.delete('/history', chatController.clear)

export default router