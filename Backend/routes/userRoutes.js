import Router from "express"
import UserController from "../controllers/userController.js"

const router = new Router()

router.post("/registration", UserController.registration)
router.post("/login", UserController.login)

router.post("/logout", UserController.logout)
router.get("/me", UserController.getCurrentUser)  
router.get("/", UserController.getAll)

export default router