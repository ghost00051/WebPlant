const DEFAULT_API_URL = 'https://server.checktheplants.ru/api'

export const API_URL = (
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? '/api' : DEFAULT_API_URL)
).replace(/\/+$/, '')
