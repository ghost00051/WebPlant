export const DEFAULT_TIMEOUT_MS = 15000

export async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = DEFAULT_TIMEOUT_MS
) {
    const { signal: externalSignal, ...rest } = options
    const controller = new AbortController()
    let timedOut = false

    const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, timeoutMs)

    const forwardAbort = () => controller.abort()

    if (externalSignal) {
        if (externalSignal.aborted) {
            controller.abort()
        } else {
            externalSignal.addEventListener('abort', forwardAbort, { once: true })
        }
    }

    try {
        return await fetch(url, { ...rest, signal: controller.signal })
    } catch (error) {
        if (timedOut) {
            throw new Error(
                `Превышено время ожидания ответа сервера (${Math.round(timeoutMs / 1000)} с)`,
                { cause: error }
            )
        }
        throw error
    } finally {
        clearTimeout(timer)
        if (externalSignal) {
            externalSignal.removeEventListener('abort', forwardAbort)
        }
    }
}
