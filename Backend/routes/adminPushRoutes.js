import { Router } from 'express'
import adminPushController from '../controllers/adminPushController.js'
import { requireAdmin } from '../middleware/admin.js'

const router = Router()

router.use(requireAdmin)

router.get('/overview', adminPushController.getOverview)
router.get('/recipients', adminPushController.listRecipients)
router.post('/broadcasts', adminPushController.createBroadcast)
router.post('/broadcasts/:id/cancel', adminPushController.cancelBroadcast)

export default router
