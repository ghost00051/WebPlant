import jwt from 'jsonwebtoken'
import User from '../models/userModels.js'

export async function requireAdmin(req, res, next) {
    try {
        const token = req.cookies.token
        if (!token) return res.status(401).json({ message: 'Не авторизован' })

        const decoded = jwt.verify(token, process.env.SECRET_KEY)
        const user = await User.findByPk(decoded.id)
        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Доступ запрещён' })
        }
        req.user = user
        next()
    } catch (e) {
        return res.status(401).json({ message: 'Невалидный токен' })
    }
}