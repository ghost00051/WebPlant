import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import plantController from '../controllers/plantController.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(requireAuth)

const speciesSuggestionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много запросов к подсказкам. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('plant-species')
})

const wateringAdviceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много запросов советов по поливу. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('plant-watering-advice')
})

const wateringWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много изменений полива. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('plant-watering-write')
})

router.post('/suggest-species', speciesSuggestionLimiter, plantController.suggestSpecies)
router.post('/watering-advice', wateringAdviceLimiter, plantController.suggestWateringAdvice)
router.post('/watering-time-advice', wateringAdviceLimiter, plantController.suggestWateringTime)
router.get('/need-watering', plantController.getNeedWatering)
router.get('/schedule', plantController.getSchedule)
router.get('/history', plantController.getHistoryAll)
router.get('/timeline', plantController.getTimeline)
router.get('/stats/completion', plantController.getCompletionStats)

router.get('/', plantController.getAll)
router.post('/', wateringWriteLimiter, plantController.create)

router.get('/:id', plantController.getOne)
router.put('/:id', wateringWriteLimiter, plantController.update)
router.delete('/:id', wateringWriteLimiter, plantController.delete)

router.post('/:id/photos', wateringWriteLimiter, plantController.addPhotos)
router.post('/:id/water', wateringWriteLimiter, plantController.water)
router.delete('/:id/water/:logId', wateringWriteLimiter, plantController.deleteWatering)
router.post('/:id/skip', wateringWriteLimiter, plantController.skip)
router.get('/:id/history', plantController.getHistory)
router.get('/:id/stats', plantController.getStats)
router.patch('/:id/metadata', wateringWriteLimiter, plantController.updateMetadata)

export default router