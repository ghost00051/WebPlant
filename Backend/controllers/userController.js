import User from "../models/userModels.js"
import UserLegalConsent from "../models/userLegalConsentModels.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import sequelize from "../db.js"
import { UniqueConstraintError } from "sequelize"
import {
    isValidEmail,
    isValidRegistrationPassword,
    normalizeEmail,
    isValidUsername,
    normalizeUsername,
    isValidPhone,
    normalizePhone,
    isValidBio
} from "../utils/validation.js"
import {
    clearAuthCookies,
    revokeAuthTokens,
    setRememberedAuth,
    setSessionAuth
} from '../utils/authTokens.js'
import { linkGuestDataToUser } from '../utils/linkGuestData.js'
import {
    clearGuestTokenCookie,
    getValidGuestToken
} from '../middleware/guestToken.js'

dotenv.config()

function buildUserPayload(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        phone: user.phone,
        bio: user.bio,
        role: user.role,
        privilege_level: user.privilege_level
    }
}

async function isUsernameTaken(normalized, excludeUserId = null) {
    const candidate = await User.findOne({
        where: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('username')),
            normalized
        ),
        attributes: ['id']
    })
    if (!candidate) return false
    if (excludeUserId && candidate.id === excludeUserId) return false
    return true
}

function randomSuffix(len = 4) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let out = ''
    for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)]
    }
    return out
}

async function generateUniqueUsername(base) {
    const clean = normalizeUsername(base).replace(/[^a-z0-9._]/g, '') || 'user'
    const short = clean.slice(0, 26)

    for (let i = 0; i < 20; i++) {
        const candidate = i === 0
            ? short
            : `${short}_${randomSuffix(4)}`

        if (!isValidUsername(candidate)) continue

        const taken = await isUsernameTaken(candidate)
        if (!taken) return candidate
    }

    return `user_${Date.now().toString(36)}`
}

class UserController {
    async registration(req, res) {
        let transaction
        try {
            const {
                email,
                password,
                name,
                username,
                privacyPolicyAccepted,
                termsAccepted,
                rememberMe
            } = req.body || {}

            const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : ''
            const normalizedName = typeof name === 'string' ? name.trim() : name

            if (
                !isValidEmail(email) ||
                !isValidRegistrationPassword(password) ||
                (name !== undefined && name !== null &&
                    (typeof name !== 'string' || !normalizedName || name.length > 100)) ||
                (rememberMe !== undefined && typeof rememberMe !== 'boolean')
            ) {
                return res.status(400).json({
                    message: "Укажите корректные email, пароль, имя и срок сессии"
                })
            }

            if (privacyPolicyAccepted !== true) {
                return res.status(400).json({
                    message: "Необходимо согласие на обработку персональных данных"
                })
            }

            if (termsAccepted !== true) {
                return res.status(400).json({
                    message: "Необходимо принять пользовательское соглашение"
                })
            }

            const candidate = await User.findOne({
                where: sequelize.where(
                    sequelize.fn('LOWER', sequelize.col('email')),
                    normalizedEmail
                )
            })
            if (candidate) {
                return res.status(409).json({
                    message: "Пользователь с таким email уже существует"
                })
            }

            let finalUsername = null

            if (username !== undefined && username !== null && username !== '') {
                if (!isValidUsername(username)) {
                    return res.status(400).json({
                        message: "Имя пользователя: 3–30 символов, латиница, цифры, точка, _"
                    })
                }
                const normalized = normalizeUsername(username)
                const taken = await isUsernameTaken(normalized)
                if (taken) {
                    return res.status(409).json({
                        message: "Такое имя пользователя уже занято"
                    })
                }
                finalUsername = normalized
            }

            transaction = await sequelize.transaction()
            const hashPassword = await bcrypt.hash(password, 10)

            const user = await User.create({
                email: normalizedEmail,
                password: hashPassword,
                name: normalizedName || null,
                username: finalUsername,
                role: 'USER',
                privilege_level: 'free'
            }, { transaction })

            if (!finalUsername) {
                const base = normalizedName
                    ? normalizedName.toLowerCase().replace(/\s+/g, '_')
                    : `user_${user.id}`
                const generated = await generateUniqueUsername(base)
                await user.update({ username: generated }, { transaction })
                user.username = generated
            }

            const guestToken = getValidGuestToken(req.cookies?.guest_token)
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            await UserLegalConsent.create({
                user_id: user.id,
                consent_type: 'privacy_policy',
                is_accepted: true,
                document_version: '2.0',
                accepted_at: new Date(),
                guest_token: guestToken,
                ip_address: ip,
                user_agent: userAgent,
                source: 'registration'
            }, { transaction })
            console.log('✅ Сохранено согласие на обработку ПД')

            await UserLegalConsent.create({
                user_id: user.id,
                consent_type: 'terms_of_service',
                is_accepted: true,
                document_version: '2.0',
                accepted_at: new Date(),
                guest_token: guestToken,
                ip_address: ip,
                user_agent: userAgent,
                source: 'registration'
            }, { transaction })
            console.log('✅ Сохранено пользовательское соглашение')

            if (guestToken) {
                const linked = await linkGuestDataToUser(
                    user.id,
                    guestToken,
                    'registration_linked',
                    transaction
                )
                console.log(
                    `Связано гостевых согласий: ${linked.consentCount}, сообщений: ${linked.chatMessageCount}`
                )
            }

            await transaction.commit()
            transaction = null

            await revokeAuthTokens(req.cookies)
            if (rememberMe === true) {
                await setRememberedAuth(res, user)
            } else {
                await setSessionAuth(res, user)
            }
            clearGuestTokenCookie(res)

            return res.status(201).json({
                message: 'Регистрация успешна',
                user: buildUserPayload(user)
            })
        } catch (e) {
            if (transaction && !transaction.finished) {
                await transaction.rollback()
            }
            if (e instanceof UniqueConstraintError) {
                return res.status(409).json({
                    message: "Пользователь с таким email или именем уже существует"
                })
            }
            console.error("❌ Ошибка регистрации:", e)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async login(req, res) {
        try {
            const { email, password, rememberMe } = req.body || {}
            const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : ''

            if (
                !isValidEmail(email) ||
                typeof password !== 'string' ||
                !password ||
                password.length > 1024 ||
                (rememberMe !== undefined && typeof rememberMe !== 'boolean')
            ) {
                return res.status(400).json({ message: "Email и пароль обязательны" })
            }

            const user = await User.findOne({
                where: sequelize.where(
                    sequelize.fn('LOWER', sequelize.col('email')),
                    normalizedEmail
                )
            })

            if (!user) {
                return res.status(401).json({ message: "Неверный email или пароль" })
            }

            const comparePassword = await bcrypt.compare(password, user.password)
            if (!comparePassword) {
                return res.status(401).json({ message: "Неверный email или пароль" })
            }

            const guestToken = getValidGuestToken(req.cookies?.guest_token)
            if (guestToken) {
                const linked = await sequelize.transaction(transaction =>
                    linkGuestDataToUser(
                        user.id,
                        guestToken,
                        'login_linked',
                        transaction
                    )
                )
                console.log(
                    `Связано гостевых согласий: ${linked.consentCount}, сообщений: ${linked.chatMessageCount} (вход)`
                )
            }

            await revokeAuthTokens(req.cookies)
            if (rememberMe === true) {
                await setRememberedAuth(res, user)
            } else {
                await setSessionAuth(res, user)
            }
            clearGuestTokenCookie(res)

            return res.json({
                message: 'Вход выполнен успешно',
                user: buildUserPayload(user)
            })
        } catch (e) {
            console.error("❌ Ошибка входа:", e)
            return res.status(500).json({ message: "Внутренняя ошибка сервера" })
        }
    }

    async logout(req, res) {
        try {
            await revokeAuthTokens(req.cookies)
            clearAuthCookies(res)
            clearGuestTokenCookie(res)

            return res.json({ message: "Выход выполнен успешно" })
        } catch (e) {
            console.error("❌ Ошибка выхода:", e)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async getCurrentUser(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: "Не авторизован" })
            }
            return res.json(buildUserPayload(req.user))
        } catch (e) {
            console.error("❌ Ошибка проверки пользователя:", e)
            return res.status(500).json({ message: "Внутренняя ошибка сервера" })
        }
    }

    async updateProfile(req, res) {
        try {
            const token = req.cookies.token
            if (!token) {
                return res.status(401).json({ message: "Не авторизован" })
            }

            const decoded = jwt.verify(token, process.env.SECRET_KEY)
            const user = await User.findByPk(decoded.id)
            if (!user) {
                return res.status(404).json({ message: "Пользователь не найден" })
            }

            const { name, username, phone, bio } = req.body || {}
            const updates = {}

            if (name !== undefined) {
                if (name !== null && (typeof name !== 'string' || name.length > 100)) {
                    return res.status(400).json({ message: "Некорректное имя" })
                }
                updates.name = name ? name.trim() : null
            }

            if (username !== undefined) {
                if (username === null || username === '') {
                    updates.username = null
                } else {
                    if (!isValidUsername(username)) {
                        return res.status(400).json({
                            message: "Имя пользователя: 3–30 символов, латиница, цифры, точка, _"
                        })
                    }
                    const normalized = normalizeUsername(username)

                    if (normalized !== user.username) {
                        const taken = await isUsernameTaken(normalized, user.id)
                        if (taken) {
                            return res.status(409).json({
                                message: "Такое имя пользователя уже занято"
                            })
                        }
                    }
                    updates.username = normalized
                }
            }

            if (phone !== undefined) {
                if (phone !== null && phone !== '' && !isValidPhone(phone)) {
                    return res.status(400).json({ message: "Некорректный телефон" })
                }
                updates.phone = phone ? normalizePhone(phone) : null
            }

            if (bio !== undefined) {
                if (!isValidBio(bio)) {
                    return res.status(400).json({
                        message: "Описание слишком длинное (максимум 300 символов)"
                    })
                }
                updates.bio = bio ? bio.trim() : null
            }

            if (!Object.keys(updates).length) {
                return res.status(400).json({ message: "Нет полей для обновления" })
            }

            await user.update(updates)

            return res.json(buildUserPayload(user))
        } catch (e) {
            if (e instanceof UniqueConstraintError) {
                return res.status(409).json({
                    message: "Такое имя пользователя уже занято"
                })
            }
            console.error("❌ Ошибка обновления профиля:", e)
            return res.status(500).json({ message: "Внутренняя ошибка сервера" })
        }
    }

    async checkUsername(req, res) {
        try {
            const raw = req.query.username
            if (!isValidUsername(raw)) {
                return res.status(400).json({
                    available: false,
                    message: "Некорректный формат"
                })
            }

            const normalized = normalizeUsername(raw)

            let ownId = null
            const token = req.cookies.token
            if (token) {
                try {
                    const decoded = jwt.verify(token, process.env.SECRET_KEY)
                    ownId = decoded.id
                } catch {  }
            }

            const taken = await isUsernameTaken(normalized, ownId)

            return res.json({
                available: !taken,
                username: normalized,
                message: taken ? "Уже занято" : "Свободно"
            })
        } catch (e) {
            console.error("❌ Ошибка проверки username:", e)
            return res.status(500).json({ message: "Внутренняя ошибка сервера" })
        }
    }

    async getAll(req, res) {
        try {
            const users = await User.findAll({
                attributes: { exclude: ['password'] }
            })
            return res.json(users)
        } catch (e) {
            console.error("❌ Ошибка получения пользователей:", e)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }
}

export default new UserController()