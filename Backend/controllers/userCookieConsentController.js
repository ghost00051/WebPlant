import UserCookieConsent from "../models/userCookieConsentModels.js"
import { Op } from "sequelize"

const GUEST_TOKEN_LIFETIME = 60 * 60 * 1000
const CONSENT_LIFETIME = 6 * 30 * 24 * 60 * 60 * 1000

class UserCookieConsentController {

    async checkConsent(req, res) {
        try {
            const { consentType } = req.params
            const userId = req.user?.id || null
            const guestToken = req.guestToken

            const whereClause = {
                consent_type: consentType,
                is_accepted: true,
                is_revoked: false,
                [Op.or]: [
                    { expires_at: null },
                    { expires_at: { [Op.gt]: new Date() } }
                ]
            }

            if (userId) {
                whereClause.user_id = userId
            } else {
                whereClause.guest_token = guestToken
            }

            const consent = await UserCookieConsent.findOne({
                where: whereClause,
                order: [['created_at', 'DESC']]
            })

            const isExpired = consent && consent.expires_at && new Date(consent.expires_at) < new Date()

            return res.json({
                hasConsent: !!consent && !isExpired,
                consent: consent || null,
                isExpired: isExpired || false
            })
        } catch (error) {
            console.error("❌ Ошибка проверки согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async revokeConsent(req, res) {
        try {
            const { consentType } = req.params
            const { reason } = req.body
            const userId = req.user?.id

            if (!userId) {
                return res.status(401).json({
                    message: "Необходима авторизация"
                })
            }

            const consent = await UserCookieConsent.findOne({
                where: {
                    user_id: userId,
                    consent_type: consentType,
                    is_accepted: true,
                    is_revoked: false,
                    [Op.or]: [
                        { expires_at: null },
                        { expires_at: { [Op.gt]: new Date() } }
                    ]
                }
            })

            if (!consent) {
                return res.status(404).json({
                    message: "Активное согласие не найдено"
                })
            }

            await UserCookieConsent.update(
                {
                    is_revoked: true,
                    revoked_at: new Date(),
                    revoked_reason: reason || 'user_revoked',
                    is_accepted: false
                },
                {
                    where: { id: consent.id }
                }
            )

            await UserCookieConsent.create({
                user_id: userId,
                consent_type: consentType,
                is_accepted: false,
                version: consent.version,
                is_revoked: true,
                revoked_at: new Date(),
                revoked_reason: reason || 'user_revoked',
                ip_address: req.ip || req.connection.remoteAddress,
                user_agent: req.headers['user-agent'],
                source: 'settings'
            })

            return res.json({
                message: "Согласие отозвано успешно"
            })
        } catch (error) {
            console.error("❌ Ошибка отзыва согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }
    async setConsent(req, res) {
        try {
            const { consentType, isAccepted, version, source } = req.body
            const userId = req.user?.id || null
            const guestToken = req.guestToken
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            const whereClause = {
                consent_type: consentType,
                is_accepted: true,
                is_revoked: false,
                [Op.or]: [
                    { expires_at: null },
                    { expires_at: { [Op.gt]: new Date() } }
                ]
            }

            if (userId) {
                whereClause.user_id = userId
            } else {
                whereClause.guest_token = guestToken
            }

            const existingConsent = await UserCookieConsent.findOne({
                where: whereClause
            })

            if (existingConsent) {
                return res.status(409).json({
                    message: "Активное согласие уже существует"
                })
            }

            const consent = await UserCookieConsent.create({
                user_id: userId,
                guest_token: guestToken,
                consent_type: consentType,
                is_accepted: isAccepted,
                version: version || '1.0',
                accepted_at: isAccepted ? new Date() : null,
                source: source || 'banner',
                ip_address: ip,
                user_agent: userAgent
            })

            return res.status(201).json({
                message: isAccepted ? "Согласие сохранено" : "Согласие отклонено",
                consent
            })
        } catch (error) {
            console.error("❌ Ошибка сохранения согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async setAllConsents(req, res) {
        try {
            const { consents } = req.body
            const userId = req.user?.id || null
            const guestToken = req.guestToken
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            const results = []

            const expiresAt = new Date(Date.now() + CONSENT_LIFETIME)

            for (const consentData of consents) {
                const consent = await UserCookieConsent.create({
                    user_id: userId,
                    guest_token: guestToken,
                    consent_type: consentData.consentType,
                    is_accepted: consentData.isAccepted,
                    version: '1.0',
                    accepted_at: consentData.isAccepted ? new Date() : null,
                    expires_at: expiresAt,
                    source: 'banner',
                    ip_address: ip,
                    user_agent: userAgent
                })
                results.push(consent)
            }

            return res.status(201).json({
                message: "Все согласия сохранены",
                consents: results,
                expires_at: expiresAt
            })
        } catch (error) {
            console.error("❌ Ошибка сохранения согласий:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async getUserConsents(req, res) {
        try {
            const userId = req.user?.id || null
            const guestToken = req.guestToken

            const whereClause = {
                is_revoked: false,
                [Op.or]: [
                    { expires_at: null },
                    { expires_at: { [Op.gt]: new Date() } }  
                ]
            }

            if (userId) {
                whereClause[Op.or] = [
                    { user_id: userId },
                    { guest_token: guestToken, user_id: null }
                ]
            } else {
                whereClause.guest_token = guestToken
            }

            const consents = await UserCookieConsent.findAll({
                where: whereClause,
                attributes: [
                    'consent_type',
                    'is_accepted',
                    'version',
                    'accepted_at',
                    'expires_at',  
                    'guest_token'
                ],
                order: [['created_at', 'DESC']]
            })

            return res.json(consents)
        } catch (error) {
            console.error("❌ Ошибка получения согласий:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }


    async linkGuestConsentsToUser(req, res) {
        try {
            const { userId, guestToken } = req.body

            if (!userId || !guestToken) {
                return res.status(400).json({
                    message: "userId и guestToken обязательны"
                })
            }

            const guestConsents = await UserCookieConsent.findAll({
                where: {
                    guest_token: guestToken,
                    user_id: null,
                    is_revoked: false
                }
            })

            if (guestConsents.length === 0) {
                return res.status(404).json({
                    message: "Согласия для этого гостя не найдены"
                })
            }

            const updated = await UserCookieConsent.update(
                {
                    user_id: userId,
                    source: 'registration_linked'
                },
                {
                    where: {
                        guest_token: guestToken,
                        user_id: null
                    }
                }
            )

            return res.json({
                message: `Связано ${guestConsents.length} согласий с пользователем ${userId}`,
                count: guestConsents.length,
                consents: guestConsents
            })
        } catch (error) {
            console.error("❌ Ошибка связывания согласий:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }
}

export default new UserCookieConsentController()