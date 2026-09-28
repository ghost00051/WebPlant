import Router from "express"
import UserController from "../controllers/userController.js"
import { requireAdmin } from '../middleware/admin.js'

const router = new Router()

router.post("/registration", UserController.registration)
router.post("/login", UserController.login)

router.post("/logout", UserController.logout)
router.get("/me", UserController.getCurrentUser)  
router.get("/", requireAdmin, UserController.getAll)

export default router