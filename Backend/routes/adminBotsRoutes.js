import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import adminBotsController from '../controllers/adminBotsController.js'
import { requireAdmin } from '../middleware/admin.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(requireAdmin)

function adminKey(req) {
    return req.user?.id ? `admin:${req.user.id}` : ipKeyGenerator(req.ip)
}

const adminBotsReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: adminKey,
    message: { message: 'Слишком много запросов к аналитике ботов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-bots-read')
})

router.get('/analytics', adminBotsReadLimiter, adminBotsController.getAnalytics)

export default router
