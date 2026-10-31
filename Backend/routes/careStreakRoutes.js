import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.js'
import careStreakController from '../controllers/careStreakController.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const careStreakLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-care-streak')
})

router.get('/me/care-streak', requireAuth, careStreakLimiter, careStreakController.get)

export default router
