import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import pushController from '../controllers/pushController.js'
import { optionalAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000
const SUBSCRIBE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000
const UNSUBSCRIBE_WINDOW_MS = 15 * 60 * 1000

function subscriptionKey(req) {
    return req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)
}

const subscriptionLimiter = rateLimit({
    windowMs: SUBSCRIBE_WINDOW_MS,
    limit: 10,
    keyGenerator: subscriptionKey,
    message: { message: 'Слишком много попыток обновить push-подписку. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,

    ...rateLimitStoreOptions('push-subscription')
})

const subscriptionDailyLimiter = rateLimit({
    windowMs: SUBSCRIBE_DAILY_WINDOW_MS,
    limit: 50,
    keyGenerator: subscriptionKey,
    message: { message: 'Дневной лимит обновлений push-подписки исчерпан. Попробуйте завтра.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('push-subscription-daily')
})

const unsubscribeLimiter = rateLimit({
    windowMs: UNSUBSCRIBE_WINDOW_MS,
    limit: 30,
    message: { message: 'Слишком много запросов на отписку от push. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('push-unsubscribe')
})

router.get('/vapid-public-key', pushController.getVapidPublicKey)

router.post(
    '/subscribe',
    optionalAuth,
    subscriptionLimiter,
    subscriptionDailyLimiter,
    pushController.subscribe
)

router.post('/unsubscribe', unsubscribeLimiter, optionalAuth, pushController.unsubscribe)

export default router
