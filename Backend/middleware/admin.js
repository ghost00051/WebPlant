import { requireAuth } from './auth.js'

export function requireAdmin(req, res, next) {
    return requireAuth(req, res, () => {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Доступ запрещён' })
        }
        return next()
    })
}