import { Router } from 'express'
import plantController from '../controllers/plantController.js'

const router = Router()

router.get('/need-watering', plantController.getNeedWatering)
router.get('/schedule', plantController.getSchedule)
router.get('/history', plantController.getHistoryAll)
router.get('/stats/completion', plantController.getCompletionStats)

router.get('/', plantController.getAll)
router.post('/', plantController.create)

router.get('/:id', plantController.getOne)
router.put('/:id', plantController.update)
router.delete('/:id', plantController.delete)

router.post('/:id/photos', plantController.addPhotos)
router.post('/:id/water', plantController.water)
router.post('/:id/skip', plantController.skip)
router.get('/:id/history', plantController.getHistory)
router.get('/:id/stats', plantController.getStats)
router.patch('/:id/metadata', plantController.updateMetadata)

export default router