import { Router } from 'express'
import pushController from '../controllers/pushController.js'

const router = Router()

router.get('/vapid-public-key', pushController.getVapidPublicKey)
router.post('/subscribe', pushController.subscribe)
router.post('/unsubscribe', pushController.unsubscribe)
router.post('/send', pushController.sendToUser)

export default router