import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import plantController from '../controllers/plantController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

const speciesSuggestionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много запросов к подсказкам. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

const wateringAdviceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много запросов советов по поливу. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
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
router.post('/', plantController.create)

router.get('/:id', plantController.getOne)
router.put('/:id', plantController.update)
router.delete('/:id', plantController.delete)

router.post('/:id/photos', plantController.addPhotos)
router.post('/:id/water', plantController.water)
router.delete('/:id/water/:logId', plantController.deleteWatering)
router.post('/:id/skip', plantController.skip)
router.get('/:id/history', plantController.getHistory)
router.get('/:id/stats', plantController.getStats)
router.patch('/:id/metadata', plantController.updateMetadata)

export default router