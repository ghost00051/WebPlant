import jwt from 'jsonwebtoken'
import User from '../models/userModels.js'

async function authenticate(req, res, next, required) {
    const token = req.cookies?.token
    if (!token && required) {
        return res.status(401).json({ message: 'Не авторизован' })
    }
    if (!token) return next()

    let decoded
    try {
        decoded = jwt.verify(token, process.env.SECRET_KEY)
    } catch {
        return res.status(401).json({ message: 'Невалидный токен' })
    }

    try {
        const user = await User.findByPk(decoded.id)
        if (!user) {
            return res.status(401).json({ message: 'Пользователь не найден' })
        }
        req.user = user
        return next()
    } catch (error) {
        return next(error)
    }
}

export function requireAuth(req, res, next) {
    return authenticate(req, res, next, true)
}

export function optionalAuth(req, res, next) {
    return authenticate(req, res, next, false)
}