export const AI_REQUEST_TIMEOUT_MS = 35000

export async function fetchWithTimeout(url, options = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        window.clearTimeout(timer)
    }
}

export function describeAiRequestError(error, fallbackMessage) {
    if (error?.name === 'AbortError') {
        return 'Сервис не ответил вовремя. Попробуйте ещё раз — данные не потеряны.'
    }
    return error?.message || fallbackMessage
}
