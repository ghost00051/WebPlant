import { Router } from 'express'
import uploadController from '../controllers/uploadController.js'
import { uploadPlantPhotos } from '../middleware/upload.js'

const router = Router()

router.post('/', uploadPlantPhotos.array('photos', 2), uploadController.uploadPlantPhotos)

export default router