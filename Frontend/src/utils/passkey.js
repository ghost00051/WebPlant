import {
    startRegistration,
    startAuthentication,
    browserSupportsWebAuthn,
    platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser'

const API = (
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? '/api' : 'https://server.checktheplants.ru/api')
).replace(/\/$/, '')

export async function isPasskeySupported() {
    if (typeof window === 'undefined') return false
    if (!browserSupportsWebAuthn()) return false
    try {
        return await platformAuthenticatorIsAvailable()
    } catch {
        return false
    }
}

function mapError(e) {
    if (!e) return 'Неизвестная ошибка'
    switch (e.name) {
        case 'NotAllowedError':
            return 'Отменено. Попробуйте ещё раз'
        case 'InvalidStateError':
            return 'Этот ключ уже зарегистрирован'
        case 'SecurityError':
            return 'Требуется HTTPS'
        case 'AbortError':
            return 'Устройство не ответило'
        case 'ConstraintError':
            return 'Устройство не поддерживает нужный алгоритм'
        case 'NotSupportedError':
            return 'Устройство не поддерживает вход с ключом доступа'
        case 'TimeoutError':
            return 'Превышено время ожидания'
        default:
            return e.message || 'Ошибка'
    }
}

export async function registerPasskey(deviceName) {
    const startRes = await fetch(`${API}/users/passkey/register/start`, {
        method: 'POST',
        credentials: 'include'
    })

    if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}))
        throw new Error(err.message || 'Не удалось начать регистрацию')
    }

    const options = await startRes.json()
    const { _key, ...publicKeyOptions } = options

    let attResp
    try {
        attResp = await startRegistration(publicKeyOptions)
    } catch (e) {
        throw new Error(mapError(e), { cause: e })
    }

    const finishRes = await fetch(`${API}/users/passkey/register/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...attResp, _key, deviceName })
    })

    if (!finishRes.ok) {
        const err = await finishRes.json().catch(() => ({}))
        throw new Error(err.message || 'Не удалось сохранить ключ')
    }

    return finishRes.json()
}

export async function loginWithPasskey(email, rememberMe = false) {
    if (typeof window === 'undefined' || !window.isSecureContext) {
        throw new Error(
            'Вход с ключом доступа доступен только через HTTPS. Откройте production-сайт или настройте HTTPS для локального адреса.'
        )
    }

    if (!browserSupportsWebAuthn()) {
        throw new Error(
            'Этот браузер не предоставляет WebAuthn. Откройте сайт в Safari по HTTPS и попробуйте снова.'
        )
    }

    const startRes = await fetch(`${API}/users/passkey/login/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email || undefined })
    })

    if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}))
        throw new Error(err.message || 'Не удалось начать вход')
    }

    const options = await startRes.json()
    const { _key, ...publicKeyOptions } = options

    let assertion
    try {
        assertion = await startAuthentication(publicKeyOptions)
    } catch (e) {
        throw new Error(mapError(e), { cause: e })
    }

    const finishRes = await fetch(`${API}/users/passkey/login/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...assertion, _key, rememberMe })
    })

    if (!finishRes.ok) {
        const err = await finishRes.json().catch(() => ({}))
        throw new Error(err.message || 'Не удалось войти')
    }

    return finishRes.json()
}

export async function listPasskeys() {
    const res = await fetch(`${API}/users/passkey`, { credentials: 'include' })
    if (!res.ok) throw new Error('Не удалось получить список')
    return res.json()
}

export async function renamePasskey(id, deviceName) {
    const res = await fetch(`${API}/users/passkey/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ device_name: deviceName })
    })
    if (!res.ok) throw new Error('Не удалось переименовать')
    return res.json()
}

export async function deletePasskey(id) {
    const res = await fetch(`${API}/users/passkey/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
    if (!res.ok) throw new Error('Не удалось удалить')
    return res.json()
}

export async function hasAnyPasskey(email) {
    const res = await fetch(
        `${API}/users/passkey/exists?email=${encodeURIComponent(email)}`,
        { credentials: 'include' }
    )
    if (!res.ok) return false
    const data = await res.json()
    return !!data.hasPasskey
}