import { Router } from "express"
import UserCookieConsentController from "../controllers/userCookieConsentController.js"

const router = Router()

router.get("/", UserCookieConsentController.getUserConsents)
router.get("/:consentType", UserCookieConsentController.checkConsent)
router.post("/", UserCookieConsentController.setConsent)
router.post("/all", UserCookieConsentController.setAllConsents)
router.put("/:consentType/revoke", UserCookieConsentController.revokeConsent)
router.post("/link", UserCookieConsentController.linkGuestConsentsToUser)

export default router