import { Router } from 'express'
import plantController from '../controllers/plantController.js'

const router = Router()

router.get('/', plantController.getAll)
router.get('/:id', plantController.getOne)
router.post('/', plantController.create)
router.put('/:id', plantController.update)
router.delete('/:id', plantController.delete)
router.post('/:id/water', plantController.water)
router.patch('/:id/metadata', plantController.updateMetadata)

export default router