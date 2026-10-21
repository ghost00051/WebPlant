import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import notificationController from '../controllers/notificationController.js'
import { requireAuth } from '../middleware/auth.js'
import { integerParam } from '../middleware/validateParam.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(requireAuth)
router.param('id', integerParam)

function notificationKey(req) {
    return req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)
}

const notificationReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    keyGenerator: notificationKey,
    message: { message: 'Слишком много запросов к уведомлениям. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('notification-read')
})

const notificationMutationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: notificationKey,
    message: { message: 'Слишком много изменений уведомлений. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('notification-mutation')
})

router.get('/unread-count', notificationReadLimiter, notificationController.unreadCount)
router.get('/', notificationReadLimiter, notificationController.list)
router.patch('/read-all', notificationMutationLimiter, notificationController.markAllRead)
router.patch('/:id/read', notificationMutationLimiter, notificationController.markRead)

export default router
