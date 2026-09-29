import UserCookieConsent from "../models/userCookieConsentModels.js"
import { Op } from "sequelize"
import sequelize from "../db.js"
import { getConsentState } from "../utils/consentState.js"

const GUEST_TOKEN_LIFETIME = 60 * 60 * 1000
const CONSENT_LIFETIME = 6 * 30 * 24 * 60 * 60 * 1000
const CONSENT_TYPES = new Set(['technical', 'analytics', 'marketing', 'personalization'])
const CONSENT_SOURCES = new Set([
    'banner',
    'settings',
    'registration',
    'legal_update',
    'registration_linked',
    'login_linked'
])

class UserCookieConsentController {

    async checkConsent(req, res) {
        try {
            const { consentType } = req.params
            if (!CONSENT_TYPES.has(consentType)) {
                return res.status(400).json({ message: 'Некорректный тип согласия' })
            }
            const userId = req.user?.id || null
            const guestToken = req.guestToken

            const whereClause = userId
                ? { consent_type: consentType, user_id: userId }
                : { consent_type: consentType, guest_token: guestToken, user_id: null }

            const consent = await UserCookieConsent.findOne({
                where: whereClause,
                order: [['created_at', 'DESC'], ['id', 'DESC']]
            })

            const { hasConsent, isExpired } = getConsentState(consent)

            return res.json({
                hasConsent,
                consent: consent || null,
                isExpired
            })
        } catch (error) {
            console.error("❌ Ошибка проверки согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async revokeConsent(req, res) {
        let transaction
        try {
            const { consentType } = req.params
            const { reason } = req.body || {}
            const userId = req.user?.id

            if (!CONSENT_TYPES.has(consentType)) {
                return res.status(400).json({ message: 'Некорректный тип согласия' })
            }
            if (!userId) {
                return res.status(401).json({
                    message: "Необходима авторизация"
                })
            }
            if (reason !== undefined && (typeof reason !== 'string' || reason.length > 255)) {
                return res.status(400).json({ message: 'Некорректная причина отзыва' })
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

            transaction = await sequelize.transaction()
            await UserCookieConsent.update(
                {
                    is_revoked: true,
                    revoked_at: new Date(),
                    revoked_reason: reason || 'user_revoked',
                    is_accepted: false
                },
                {
                    where: { id: consent.id },
                    transaction
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
            }, { transaction })
            await transaction.commit()
            transaction = null

            return res.json({
                message: "Согласие отозвано успешно"
            })
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error("❌ Ошибка отзыва согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }
    async setConsent(req, res) {
        let transaction
        try {
            const { consentType, isAccepted, version, source } = req.body || {}
            const userId = req.user?.id || null
            const guestToken = req.guestToken
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            if (
                !CONSENT_TYPES.has(consentType) ||
                typeof isAccepted !== 'boolean' ||
                (version !== undefined && (typeof version !== 'string' || version.length > 10)) ||
                (source !== undefined && !CONSENT_SOURCES.has(source))
            ) {
                return res.status(400).json({ message: 'Некорректные данные согласия' })
            }

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
                whereClause.user_id = null
            }

            const existingConsent = await UserCookieConsent.findOne({
                where: whereClause
            })

            if (existingConsent) {
                if (isAccepted) {
                    return res.status(409).json({
                        message: "Активное согласие уже существует"
                    })
                }
            }

            transaction = await sequelize.transaction()
            if (existingConsent) {
                await existingConsent.update({
                    is_accepted: false,
                    is_revoked: true,
                    revoked_at: new Date(),
                    revoked_reason: 'user_declined'
                }, { transaction })
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
            }, { transaction })
            await transaction.commit()
            transaction = null

            return res.status(201).json({
                message: isAccepted ? "Согласие сохранено" : "Согласие отклонено",
                consent
            })
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback()
            console.error("❌ Ошибка сохранения согласия:", error)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async setAllConsents(req, res) {
        let transaction
        try {
            const { consents } = req.body || {}
            if (
                !Array.isArray(consents) ||
                consents.length !== CONSENT_TYPES.size ||
                consents.some(consent =>
                    !consent ||
                    !CONSENT_TYPES.has(consent.consentType) ||
                    typeof consent.isAccepted !== 'boolean'
                ) ||
                new Set(consents.map(consent => consent.consentType)).size !== consents.length
            ) {
                return res.status(400).json({ message: 'Передан некорректный список согласий' })
            }

            const userId = req.user?.id || null
            const guestToken = req.guestToken
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            const expiresAt = new Date(Date.now() + CONSENT_LIFETIME)
            transaction = await sequelize.transaction()
            const owner = userId
                ? { user_id: userId }
                : { user_id: null, guest_token: guestToken }
            const revokedAt = new Date()
            await UserCookieConsent.update({
                is_accepted: false,
                is_revoked: true,
                revoked_at: revokedAt,
                revoked_reason: 'consent_updated'
            }, {
                where: {
                    ...owner,
                    consent_type: { [Op.in]: [...CONSENT_TYPES] },
                    is_accepted: true,
                    is_revoked: false
                },
                transaction
            })
            const results = await UserCookieConsent.bulkCreate(consents.map(consentData => ({
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
            })), { transaction })
            await transaction.commit()
            transaction = null

            return res.status(201).json({
                message: "Все согласия сохранены",
                consents: results,
                expires_at: expiresAt
            })
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback()
            }
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
                [Op.and]: [
                    {
                        [Op.or]: [
                            { expires_at: null },
                            { expires_at: { [Op.gt]: new Date() } }
                        ]
                    },
                    userId
                        ? {
                            [Op.or]: [
                                { user_id: userId },
                                { guest_token: guestToken, user_id: null }
                            ]
                        }
                        : { guest_token: guestToken }
                ]
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
            const userId = req.user.id
            const guestToken = req.guestToken

            if (!guestToken) {
                return res.status(400).json({
                    message: "guest_token не найден"
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

            const [updatedCount] = await UserCookieConsent.update(
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
                message: `Связано ${updatedCount} согласий с пользователем ${userId}`,
                count: updatedCount
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