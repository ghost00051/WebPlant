import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import pushController from '../controllers/pushController.js'
import { requireAdmin } from '../middleware/admin.js'
import { optionalAuth, requireAuth } from '../middleware/auth.js'

const router = Router()

const subscriptionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: { message: 'Слишком много попыток обновить push-подписку. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

router.get('/vapid-public-key', pushController.getVapidPublicKey)
router.post('/subscribe', subscriptionLimiter, optionalAuth, pushController.subscribe)
router.post('/unsubscribe', requireAuth, pushController.unsubscribe)

router.post('/send', requireAdmin, pushController.sendToUser)
router.post('/send-all', requireAdmin, pushController.sendToAll)
router.get('/stats', requireAdmin, pushController.getStats)

export default router