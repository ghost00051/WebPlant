import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import botController from '../controllers/botController.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const LINK_CODE_WINDOW_MS = 60 * 60 * 1000
const LINK_CODE_LIMIT = 10

function userKey(req) {
    return req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`
}

const linkCodeLimiter = rateLimit({
    windowMs: LINK_CODE_WINDOW_MS,
    limit: LINK_CODE_LIMIT,
    keyGenerator: userKey,
    message: { message: 'Слишком много запросов кода привязки. Попробуйте через час.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('bot-link-code')
})

router.get('/', requireAuth, botController.listChannels)
router.post('/link-code', requireAuth, linkCodeLimiter, botController.createLinkCode)
router.post('/unlink', requireAuth, botController.unlink)
router.patch('/preferences', requireAuth, botController.updatePreferences)

router.post('/telegram/webhook', botController.telegramWebhook)
router.post('/max/webhook', botController.maxWebhook)

export default router
