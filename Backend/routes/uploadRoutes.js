import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import uploadController from '../controllers/uploadController.js'
import { requireAuth } from '../middleware/auth.js'
import { uploadPlantPhotos, validatePlantPhotos } from '../middleware/upload.js'

const router = Router()

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: req => String(req.user.id),
    message: { message: 'Слишком много загрузок. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

router.post(
    '/',
    requireAuth,
    uploadLimiter,
    uploadPlantPhotos.array('photos', 2),
    validatePlantPhotos,
    uploadController.uploadPlantPhotos
)

export default router