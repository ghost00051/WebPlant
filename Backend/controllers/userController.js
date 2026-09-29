import User from "../models/userModels.js"
import UserCookieConsent from "../models/userCookieConsentModels.js"
import UserLegalConsent from "../models/userLegalConsentModels.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import sequelize from "../db.js"
import { UniqueConstraintError } from "sequelize"
import { isValidEmail, isValidRegistrationPassword, normalizeEmail } from "../utils/validation.js"

dotenv.config()

const AUTH_TOKEN_LIFETIME = 24 * 60 * 60 * 1000

function generateJWT(id, email, role) {
    return jwt.sign(
        { id, email, role },
        process.env.SECRET_KEY,
        { expiresIn: "24h" }
    )
}

class UserController {
    async registration(req, res) {
        let transaction
        try {
            const {
                email,
                password,
                name,
                privacyPolicyAccepted,
                termsAccepted
            } = req.body || {}
            const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : ''

            if (
                !isValidEmail(email) ||
                !isValidRegistrationPassword(password) ||
                (name !== undefined && name !== null &&
                    (typeof name !== 'string' || name.length > 100))
            ) {
                return res.status(400).json({
                    message: "Некорректные данные регистрации"
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
                where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), normalizedEmail)
            })
            if (candidate) {
                return res.status(409).json({
                    message: "Пользователь с таким email уже существует"
                })
            }

            transaction = await sequelize.transaction()
            const hashPassword = await bcrypt.hash(password, 10)
            const user = await User.create({
                email: normalizedEmail,
                password: hashPassword,
                name: name || null,
                role: 'USER',
                privilege_level: 'free'
            }, { transaction })
            const guestToken = req.cookies.guest_token
            const ip = req.ip || req.connection.remoteAddress
            const userAgent = req.headers['user-agent']

            await UserLegalConsent.create({
                user_id: user.id,
                consent_type: 'privacy_policy',
                is_accepted: true,
                document_version: '1.0',
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
                document_version: '1.0',
                accepted_at: new Date(),
                guest_token: guestToken,
                ip_address: ip,
                user_agent: userAgent,
                source: 'registration'
            }, { transaction })
            console.log('✅ Сохранено пользовательское соглашение')

            if (guestToken) {
                const [updatedCount] = await UserCookieConsent.update(
                    {
                        user_id: user.id,
                        source: 'registration_linked'
                    },
                    {
                        where: {
                            guest_token: guestToken,
                            user_id: null
                        },
                        transaction
                    }
                )
                console.log(`✅ Связано ${updatedCount} куки-согласий с пользователем ${user.id}`)
            }

            const token = generateJWT(user.id, user.email, user.role)
            await transaction.commit()
            transaction = null

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: AUTH_TOKEN_LIFETIME,
                path: '/',
            })
            return res.status(201).json({
                message: 'Регистрация успешна',
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
                }
            })
        } catch (e) {
            if (transaction && !transaction.finished) {
                await transaction.rollback()
            }
            if (e instanceof UniqueConstraintError) {
                return res.status(409).json({
                    message: "Пользователь с таким email уже существует"
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
            const { email, password } = req.body || {}
            const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : ''

            if (!isValidEmail(email) || typeof password !== 'string' || !password || password.length > 1024) {
                return res.status(400).json({
                    message: "Email и пароль обязательны"
                })
            }

            const user = await User.findOne({
                where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), normalizedEmail)
            })

            if (!user) {
                return res.status(401).json({ message: "Неверный email или пароль" })
            }

            const comparePassword = await bcrypt.compare(password, user.password)

            if (!comparePassword) {
                return res.status(401).json({ message: "Неверный email или пароль" })
            }

            const guestToken = req.cookies.guest_token
            if (guestToken) {
                const [updatedCount] = await UserCookieConsent.update(
                    {
                        user_id: user.id,
                        source: 'login_linked'
                    },
                    {
                        where: {
                            guest_token: guestToken,
                            user_id: null
                        }
                    }
                )
                console.log(`✅ Связано ${updatedCount} согласий с пользователем ${user.id} (вход)`)
            } else {
                console.log('⚠️ guest_token не найден в куках при входе')
            }

            const token = generateJWT(user.id, user.email, user.role)

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: AUTH_TOKEN_LIFETIME,
                path: '/',
            })

            return res.json({
                message: 'Вход выполнен успешно',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    privilege_level: user.privilege_level
                }
            })
        } catch (e) {
            console.error("❌ Ошибка входа:", e)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async logout(req, res) {
        try {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                path: '/'
            })

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
            const token = req.cookies.token

            if (!token) {
                return res.status(401).json({ message: "Не авторизован" })
            }

            const decoded = jwt.verify(token, process.env.SECRET_KEY)
            const user = await User.findByPk(decoded.id)

            if (!user) {
                return res.status(404).json({ message: "Пользователь не найден" })
            }

            return res.json({
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                privilege_level: user.privilege_level
            })
        } catch (e) {
            console.error("❌ Ошибка проверки пользователя:", e)
            return res.status(401).json({ message: "Не авторизован" })
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