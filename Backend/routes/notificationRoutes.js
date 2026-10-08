import { Router } from 'express'
import notificationController from '../controllers/notificationController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

router.get('/unread-count', notificationController.unreadCount)
router.get('/', notificationController.list)
router.patch('/read-all', notificationController.markAllRead)
router.patch('/:id/read', notificationController.markRead)

export default router
