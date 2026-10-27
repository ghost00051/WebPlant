import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import gardenShareController from '../controllers/gardenShareController.js'
import { optionalAuth, requireAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const shareWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много запросов на управление ссылкой. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('garden-share-write')
})

const shareStatusLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('garden-share-status')
})

const publicGardenLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: req => ipKeyGenerator(req.ip),
    message: { message: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('garden-share-public')
})

router.get('/share', requireAuth, shareStatusLimiter, gardenShareController.status)
router.post('/share', requireAuth, shareWriteLimiter, gardenShareController.create)
router.delete('/share', requireAuth, shareWriteLimiter, gardenShareController.revoke)

router.get('/:token', publicGardenLimiter, optionalAuth, gardenShareController.getPublic)

export default router
