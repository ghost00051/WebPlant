import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import eventController from '../controllers/eventController.js'
import { optionalAuth } from '../middleware/auth.js'
import { parseVisitorId } from '../utils/adminAnalytics.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const EVENTS_WINDOW_MS = 60 * 1000
const EVENTS_LIMIT = 60

function eventKey(req) {
    const visitorId = parseVisitorId(req.body?.visitorId)
    return visitorId
        ? `ip:${ipKeyGenerator(req.ip)}:visitor:${visitorId}`
        : `ip:${ipKeyGenerator(req.ip)}`
}

const eventLimiter = rateLimit({
    windowMs: EVENTS_WINDOW_MS,
    limit: EVENTS_LIMIT,
    keyGenerator: eventKey,
    message: { message: 'Слишком много событий. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('events')
})

router.post('/', optionalAuth, eventLimiter, eventController.track)

export default router
