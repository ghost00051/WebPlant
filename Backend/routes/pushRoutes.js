import { Router } from 'express'
import pushController from '../controllers/pushController.js'
import { requireAdmin } from '../middleware/admin.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()

router.get('/vapid-public-key', pushController.getVapidPublicKey)
router.post('/subscribe', optionalAuth, pushController.subscribe)
router.post('/unsubscribe', pushController.unsubscribe)

router.post('/send', requireAdmin, pushController.sendToUser)
router.post('/send-all', requireAdmin, pushController.sendToAll)
router.get('/stats', requireAdmin, pushController.getStats)

export default router