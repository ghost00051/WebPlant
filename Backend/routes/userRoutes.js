import { Router } from "express"
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import UserController from "../controllers/userController.js"
import AccountController from "../controllers/accountController.js"
import { requireAdmin } from '../middleware/admin.js'
import passkeyController from '../controllers/passkeyController.js'
import passwordResetController from '../controllers/passwordResetController.js'
import notificationPreferenceController from '../controllers/notificationPreferenceController.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimitStoreOptions } from '../utils/rateLimitStore.js'

const router = Router()

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { message: 'Слишком много попыток регистрации. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-registration')
})

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток входа. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-login')
})

const usernameCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    message: { message: 'Слишком много запросов' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-username-check')
})

const passkeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток входа по ключу. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-passkey')
})

const passkeyStartLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    message: { message: 'Слишком много запросов на вход по ключу. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-passkey-start')
})

const passkeyRegistrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток регистрации ключа. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-passkey-registration')
})

const passwordResetRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { message: 'Слишком много запросов на сброс пароля. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-password-reset-request')
})

const passwordResetVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    message: { message: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-password-reset-verify')
})

const passwordResetConfirmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток смены пароля. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-password-reset-confirm')
})

const notificationPreferenceLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много изменений настроек уведомлений. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-notification-preferences')
})

const accountExportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много запросов экспорта данных. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-account-export')
})

const accountDeleteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip)),
    message: { message: 'Слишком много попыток удаления аккаунта. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-account-delete')
})

const unsubscribeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    keyGenerator: req => ipKeyGenerator(req.ip),
    message: { message: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...rateLimitStoreOptions('user-unsubscribe')
})

router.post("/registration", registrationLimiter, UserController.registration)
router.post("/login", loginLimiter, UserController.login)
router.post("/logout", UserController.logout)

router.get('/unsubscribe', unsubscribeLimiter, UserController.unsubscribePage)
router.post('/unsubscribe', unsubscribeLimiter, UserController.unsubscribe)

router.post(
    '/password-reset/request',
    passwordResetRequestLimiter,
    passwordResetController.request
)
router.get(
    '/password-reset/verify',
    passwordResetVerifyLimiter,
    passwordResetController.verify
)
router.post(
    '/password-reset/confirm',
    passwordResetConfirmLimiter,
    passwordResetController.confirm
)

router.get("/me", requireAuth, UserController.getCurrentUser)
router.get('/me/export', requireAuth, accountExportLimiter, AccountController.exportData)
router.delete('/me', requireAuth, accountDeleteLimiter, AccountController.deleteMe)
router.patch("/me", requireAuth, UserController.updateProfile)
router.get(
    '/me/notification-preferences',
    requireAuth,
    notificationPreferenceController.get
)
router.patch(
    '/me/notification-preferences',
    requireAuth,
    notificationPreferenceLimiter,
    notificationPreferenceController.update
)
router.get("/check-username", usernameCheckLimiter, UserController.checkUsername)

router.get("/", requireAdmin, UserController.getAll)

router.post('/passkey/register/start', requireAuth, passkeyRegistrationLimiter, passkeyController.startRegistration)
router.post('/passkey/register/finish', requireAuth, passkeyRegistrationLimiter, passkeyController.finishRegistration)

router.post('/passkey/login/start', passkeyStartLimiter, passkeyController.startAuthentication)
router.post('/passkey/login/finish', passkeyLimiter, passkeyController.finishAuthentication)

router.get('/passkey', requireAuth, passkeyController.listPasskeys)
router.get('/passkey/exists', passkeyStartLimiter, passkeyController.hasAnyPasskey)
router.patch('/passkey/:id', requireAuth, passkeyController.renamePasskey)
router.delete('/passkey/:id', requireAuth, passkeyController.deletePasskey)

export default router