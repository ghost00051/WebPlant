const DEVELOPMENT_ORIGINS = [
    'https://frontdevivan.ru',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://192.168.0.167:5173',
    'http://192.168.0.176:5173',
    'http://192.168.0.111:5173',
]

export function parseLocalDevOrigins(value = '') {
    const origins = value.split(',').map(origin => origin.trim()).filter(Boolean)

    for (const origin of origins) {
        let url
        try {
            url = new URL(origin)
        } catch {
            throw new Error(`Invalid LOCAL_DEV_ORIGINS entry: ${origin}`)
        }

        const hostname = url.hostname
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
        const parts = hostname.split('.')
        const octets = parts.map(Number)
        const isPrivateIpv4 = octets.length === 4 &&
            octets.every((octet, index) =>
                /^\d{1,3}$/.test(parts[index]) &&
                octet >= 0 &&
                octet <= 255 &&
                String(octet) === parts[index]
            ) &&
            (octets[0] === 10 ||
                (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
                (octets[0] === 192 && octets[1] === 168))
        const port = Number(url.port)

        if (
            url.protocol !== 'http:' ||
            url.origin !== origin ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash ||
            (!isLocalhost && !isPrivateIpv4) ||
            !url.port ||
            port < 1 ||
            port > 65535
        ) {
            throw new Error(
                `LOCAL_DEV_ORIGINS must contain exact HTTP origins on localhost or private IPv4 addresses with a port: ${origin}`
            )
        }
    }

    return [...new Set(origins)]
}

export function isAllowedOrigin(origin, {
    frontendUrl = process.env.FRONTEND_URL,
    localDevOrigins = process.env.LOCAL_DEV_ORIGINS,
    nodeEnv = process.env.NODE_ENV
} = {}) {
    if (!origin) return true
    if (frontendUrl) {
        const configuredOrigins = frontendUrl.split(',').map(value => value.trim()).filter(Boolean)
        if (configuredOrigins.some(configuredOrigin => {
            try {
                return new URL(configuredOrigin).origin === origin
            } catch {
                return configuredOrigin.replace(/\/$/, '') === origin
            }
        })) return true
    }
    if (parseLocalDevOrigins(localDevOrigins).includes(origin)) return true
    if (nodeEnv === 'production') return false
    if (DEVELOPMENT_ORIGINS.includes(origin)) return true

    return /^http:\/\/(192\.168\.\d+\.\d+|127\.0\.0\.1|localhost):\d+$/.test(origin)
}
