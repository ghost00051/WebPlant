import jwt from 'jsonwebtoken'
import User from '../models/userModels.js'

export async function requireAuth(req, res, next) {
    const token = req.cookies?.token
    if (!token) {
        return res.status(401).json({ message: 'Не авторизован' })
    }

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