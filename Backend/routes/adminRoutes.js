import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import adminAnalyticsController from '../controllers/adminAnalyticsController.js'
import adminManageController from '../controllers/adminManageController.js'
import adminAiController from '../controllers/adminAiController.js'
import { requireAdmin } from '../middleware/admin.js'
import { integerParam } from '../middleware/validateParam.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

router.use(requireAdmin)
router.param('id', integerParam)

const adminKey = req => (req.user?.id
    ? `user:${req.user.id}`
    : `ip:${ipKeyGenerator(req.ip)}`)

const adminReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: adminKey,
    message: { message: 'Слишком много запросов к админ-API. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-read')
})

const adminMutationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: adminKey,
    message: { message: 'Слишком много изменений через админ-API. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('admin-mutation')
})

router.use((req, res, next) => (
    ['GET', 'HEAD'].includes(req.method)
        ? adminReadLimiter(req, res, next)
        : adminMutationLimiter(req, res, next)
))

router.get('/analytics/overview', adminAnalyticsController.getOverview)
router.get('/analytics/timeseries', adminAnalyticsController.getTimeseries)
router.get('/analytics/breakdown', adminAnalyticsController.getBreakdown)
router.get('/visits', adminAnalyticsController.getVisits)
router.get('/audit', adminManageController.listAudit)

router.get('/ai/metrics', adminAiController.getMetrics)
router.get('/ai/logs', adminAiController.getLogs)

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
