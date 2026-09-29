const DEVELOPMENT_ORIGINS = [
    'https://frontdevivan.ru',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://192.168.0.167:5173',
    'http://192.168.0.176:5173',
]

export function isAllowedOrigin(origin, {
    frontendUrl = process.env.FRONTEND_URL,
    nodeEnv = process.env.NODE_ENV
} = {}) {
    if (!origin) return true
    if (frontendUrl) {
        try {
            if (new URL(frontendUrl).origin === origin) return true
        } catch {
            if (frontendUrl.replace(/\/$/, '') === origin) return true
        }
    }
    if (nodeEnv === 'production') return false
    if (DEVELOPMENT_ORIGINS.includes(origin)) return true

    return /^http:\/\/(192\.168\.\d+\.\d+|127\.0\.0\.1|localhost):\d+$/.test(origin)
}
