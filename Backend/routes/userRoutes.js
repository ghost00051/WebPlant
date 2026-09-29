import Router from "express"
import rateLimit from 'express-rate-limit'
import UserController from "../controllers/userController.js"
import { requireAdmin } from '../middleware/admin.js'

const router = new Router()

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

router.post("/registration", registrationLimiter, UserController.registration)
router.post("/login", loginLimiter, UserController.login)

router.post("/logout", UserController.logout)
router.get("/me", UserController.getCurrentUser)  
router.get("/", requireAdmin, UserController.getAll)

export default router