import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import adminMailController from '../controllers/adminMailController.js'
import { requireAdmin } from '../middleware/admin.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const testMailLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много тестовых писем. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-mail-test')
})

const broadcastLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много рассылок за короткое время. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-mail-broadcast')
})

router.use(requireAdmin)

router.get('/overview', adminMailController.getOverview)
router.get('/recipients', adminMailController.listRecipients)
router.post('/preview', adminMailController.preview)
router.post('/test', testMailLimiter, adminMailController.sendTest)
router.post('/broadcasts', broadcastLimiter, adminMailController.createBroadcast)
router.post('/broadcasts/:id/cancel', adminMailController.cancelBroadcast)

export default router
