import { Router } from 'express'
import adminAnalyticsController from '../controllers/adminAnalyticsController.js'
import adminManageController from '../controllers/adminManageController.js'
import { requireAdmin } from '../middleware/admin.js'

const router = Router()

router.use(requireAdmin)

router.get('/analytics/overview', adminAnalyticsController.getOverview)
router.get('/analytics/timeseries', adminAnalyticsController.getTimeseries)
router.get('/analytics/breakdown', adminAnalyticsController.getBreakdown)
router.get('/visits', adminAnalyticsController.getVisits)

router.get('/users', adminManageController.listUsers)
router.get('/users/:id', adminManageController.getUser)
router.patch('/users/:id', adminManageController.updateUser)
router.delete('/users/:id', adminManageController.deleteUser)

router.get('/plants', adminManageController.listPlants)
router.delete('/plants/:id', adminManageController.deletePlant)

router.get('/waterings', adminManageController.listWaterings)
router.delete('/waterings/:id', adminManageController.deleteWatering)

router.get('/photos', adminManageController.listPhotos)
router.delete('/photos/:id', adminManageController.deletePhoto)

router.get('/chat', adminManageController.listChat)
router.delete('/chat/session/:sessionId', adminManageController.deleteChatSession)
router.delete('/chat/:id', adminManageController.deleteChat)

export default router
