import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import adminPushController from '../controllers/adminPushController.js'
import { requireAdmin } from '../middleware/admin.js'
import { integerParam } from '../middleware/validateParam.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(requireAdmin)
router.param('id', integerParam)

function adminKey(req) {
    return req.user?.id ? `admin:${req.user.id}` : ipKeyGenerator(req.ip)
}

const broadcastHourlyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    keyGenerator: adminKey,
    message: { message: 'Слишком много push-рассылок за последний час. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-push-broadcast')
})

const broadcastDailyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 60,
    keyGenerator: adminKey,
    message: { message: 'Дневной лимит push-рассылок исчерпан. Попробуйте завтра.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-push-broadcast-daily')
})

const broadcastMutationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,
    keyGenerator: adminKey,
    message: { message: 'Слишком много операций с push-рассылками. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-push-broadcast-mutation')
})

router.get('/overview', adminPushController.getOverview)
router.get('/recipients', adminPushController.listRecipients)

router.post(
    '/broadcasts',
    broadcastHourlyLimiter,
    broadcastDailyLimiter,
    adminPushController.createBroadcast
)
router.post(
    '/broadcasts/:id/cancel',
    broadcastMutationLimiter,
    adminPushController.cancelBroadcast
)

router.post('/broadcasts/:id/retry', broadcastMutationLimiter, (req, res, next) => {
    if (typeof adminPushController.retryBroadcast !== 'function') {
        return res.status(501).json({ message: 'Повтор рассылки пока не поддерживается сервером' })
    }
    return adminPushController.retryBroadcast(req, res, next)
})

export default router
