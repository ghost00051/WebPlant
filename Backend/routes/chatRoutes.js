import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import chatController from '../controllers/chatController.js'

const router = Router()

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: (req) => ipKeyGenerator(req.ip),  
    message: { message: 'Слишком много сообщений. Подожди минуту 🌱' },
    standardHeaders: true,
    legacyHeaders: false
})

router.post('/chat', chatLimiter, chatController.send)
router.get('/history', chatController.history)
router.delete('/history', chatController.clear)

export default router