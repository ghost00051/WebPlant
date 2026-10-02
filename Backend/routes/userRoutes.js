import { Router } from "express"
import rateLimit from 'express-rate-limit'
import UserController from "../controllers/userController.js"
import { requireAdmin } from '../middleware/admin.js'
import passkeyController from '../controllers/passkeyController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { message: 'Слишком много попыток регистрации. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток входа. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

const usernameCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    message: { message: 'Слишком много запросов' },
    standardHeaders: true,
    legacyHeaders: false
})

const passkeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток входа по ключу. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

const passkeyRegistrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    message: { message: 'Слишком много попыток регистрации ключа. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false
})

router.post("/registration", registrationLimiter, UserController.registration)
router.post("/login", loginLimiter, UserController.login)
router.post("/logout", UserController.logout)

router.get("/me", requireAuth, UserController.getCurrentUser)
router.patch("/me", requireAuth, UserController.updateProfile)
router.get("/check-username", usernameCheckLimiter, UserController.checkUsername)

router.get("/", requireAdmin, UserController.getAll)

router.post('/passkey/register/start', requireAuth, passkeyRegistrationLimiter, passkeyController.startRegistration)
router.post('/passkey/register/finish', requireAuth, passkeyRegistrationLimiter, passkeyController.finishRegistration)

router.post('/passkey/login/start', passkeyLimiter, passkeyController.startAuthentication)
router.post('/passkey/login/finish', passkeyLimiter, passkeyController.finishAuthentication)

router.get('/passkey', requireAuth, passkeyController.listPasskeys)
router.get('/passkey/exists', passkeyLimiter, passkeyController.hasAnyPasskey)
router.patch('/passkey/:id', requireAuth, passkeyController.renamePasskey)
router.delete('/passkey/:id', requireAuth, passkeyController.deletePasskey)

export default router