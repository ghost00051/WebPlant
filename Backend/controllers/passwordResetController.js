import {
    confirmPasswordReset,
    inspectPasswordResetToken,
    requestPasswordReset
} from '../services/passwordResetService.js'
import { isMailConfigured } from '../services/mailService.js'
import { isValidEmail, normalizeEmail } from '../utils/validation.js'
import {
    RESET_PASSWORD_MIN_LENGTH,
    RESET_TOKEN_TTL_MINUTES,
    isValidResetPassword,
    maskEmail
} from '../utils/passwordReset.js'
import { clearAuthCookies } from '../utils/authTokens.js'

const GENERIC_REQUEST_MESSAGE =
    'Если аккаунт с таким email существует, мы отправили на него ссылку для сброса пароля. Проверьте папку «Спам».'
const INVALID_TOKEN_MESSAGE = 'Ссылка недействительна или устарела. Запросите новую.'
const MAIL_UNAVAILABLE_MESSAGE =
    'Восстановление пароля временно недоступно. Попробуйте позже или напишите в поддержку.'

class PasswordResetController {
    async request(req, res) {
        try {
            const { email } = req.body || {}
            if (!isValidEmail(email)) {
                return res.status(400).json({ message: 'Укажите корректный email' })
            }

            if (!isMailConfigured()) {
                console.error('❌ Запрошен сброс пароля, но SMTP не настроен (SMTP_USER/SMTP_PASSWORD)')
                return res.status(503).json({ message: MAIL_UNAVAILABLE_MESSAGE })
            }

            const result = await requestPasswordReset({
                email: normalizeEmail(email),
                ip: req.ip,
                userAgent: req.get('user-agent') || '',
                frontendUrl: process.env.FRONTEND_URL
            })

            if (result.status === 'failed') {
                console.error('❌ Не удалось отправить письмо для сброса пароля:', result.error)
            } else if (result.status === 'throttled') {
                console.warn(`⏳ Сброс пароля запрошен слишком часто (user_id=${result.user.id})`)
            } else if (result.status === 'sent') {
                console.log(`📧 Ссылка сброса пароля отправлена (user_id=${result.user.id})`)
            }

            return res.json({
                message: GENERIC_REQUEST_MESSAGE,
                expiresInMinutes: RESET_TOKEN_TTL_MINUTES
            })
        } catch (e) {
            console.error('❌ Ошибка запроса сброса пароля:', e)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }

    async verify(req, res) {
        try {
            const token = typeof req.query.token === 'string' ? req.query.token : ''
            if (!token) {
                return res.status(400).json({ message: INVALID_TOKEN_MESSAGE })
            }

            const info = await inspectPasswordResetToken(token)
            if (!info) {
                return res.status(400).json({ message: INVALID_TOKEN_MESSAGE })
            }

            return res.json({
                valid: true,
                email: maskEmail(info.email),
                expiresInMinutes: RESET_TOKEN_TTL_MINUTES
            })
        } catch (e) {
            console.error('❌ Ошибка проверки ссылки сброса пароля:', e)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }

    async confirm(req, res) {
        try {
            const { token, password } = req.body || {}

            if (typeof token !== 'string' || !token) {
                return res.status(400).json({ message: INVALID_TOKEN_MESSAGE })
            }
            if (!isValidResetPassword(password)) {
                return res.status(400).json({
                    message: `Пароль должен содержать минимум ${RESET_PASSWORD_MIN_LENGTH} символов`
                })
            }

            const result = await confirmPasswordReset({ token, password })
            if (result.status !== 'updated') {
                return res.status(400).json({ message: INVALID_TOKEN_MESSAGE })
            }

            clearAuthCookies(res)
            console.log(`🔑 Пароль изменён по ссылке сброса (user_id=${result.user.id})`)

            return res.json({
                message: 'Пароль изменён. Войдите с новым паролем.'
            })
        } catch (e) {
            console.error('❌ Ошибка смены пароля по ссылке сброса:', e)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }
}

export default new PasswordResetController()
