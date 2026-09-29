import { Router } from "express"
import UserCookieConsentController from "../controllers/userCookieConsentController.js"
import { optionalAuth, requireAuth } from "../middleware/auth.js"

const router = Router()

router.use(optionalAuth)

router.get("/", UserCookieConsentController.getUserConsents)
router.get("/:consentType", UserCookieConsentController.checkConsent)
router.post("/", UserCookieConsentController.setConsent)
router.post("/all", UserCookieConsentController.setAllConsents)
router.put("/:consentType/revoke", requireAuth, UserCookieConsentController.revokeConsent)
router.post("/link", requireAuth, UserCookieConsentController.linkGuestConsentsToUser)

export default router