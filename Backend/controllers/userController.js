import User from "../models/userModels.js"
import UserCookieConsent from "../models/userCookieConsentModels.js"
import UserLegalConsent from "../models/userLegalConsentModels.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"

dotenv.config()

function generateJWT(id, email, role) {
    return jwt.sign(
        { id, email, role },
        process.env.SECRET_KEY,
        { expiresIn: "24h" }
    )
}

class UserController {
   async registration(req, res) {
        try {
            const { 
                email, 
                password, 
                role,
                privacyPolicyAccepted, 
                termsAccepted 
            } = req.body

            if (!email || !password) {
                return res.status(400).json({
                    message: "Email и пароль обязательны"
                })
            }

            if (!privacyPolicyAccepted) {
                return res.status(400).json({
                    message: "Необходимо согласие на обработку персональных данных"
                })
            }
            
            if (!termsAccepted) {
                return res.status(400).json({
                    message: "Необходимо принять пользовательское соглашение"
                })
            }

            const candidate = await User.findOne({ where: { email } })
            if (candidate) {
                return res.status(409).json({ 
                    message: "Пользователь с таким email уже существует" 
                })
            }

            const hashPassword = bcrypt.hashSync(password, 5)
            const user = await User.create({ 
                email, 
                password: hashPassword, 
                role: role || 'USER' 
            })

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
            })
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
            })
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
                        }
                    }
                )
                console.log(`✅ Связано ${updatedCount} куки-согласий с пользователем ${user.id}`)
            }

            const token = generateJWT(user.id, email, user.role)

            res.cookie('token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
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
            console.error("❌ Ошибка регистрации:", e)
            return res.status(500).json({
                message: "Внутренняя ошибка сервера"
            })
        }
    }

    async login(req, res) {
        try {
            const { email, password } = req.body

            if (!email || !password) {
                return res.status(400).json({
                    message: "Email и пароль обязательны"
                })
            }

            const user = await User.findOne({ where: { email } })

            if (!user) {
                return res.status(404).json({ message: "Пользователь не найден" })
            }

            const comparePassword = bcrypt.compareSync(password, user.password)

            if (!comparePassword) {
                return res.status(401).json({ message: "Неверный пароль" })
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

            const token = generateJWT(user.id, email, user.role)

            res.cookie('token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
            })

            return res.json({
                message: 'Вход выполнен успешно',
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
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
                secure: false,
                sameSite: 'lax',
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
                role: user.role
            })
        } catch (e) {
            console.error("❌ Ошибка проверки пользователя:", e)
            return res.status(401).json({ message: "Не авторизован" })
        }
    }

    async getAll(req, res) {
        try {
            const users = await User.findAll()
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