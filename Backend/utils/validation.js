export function normalizeEmail(email) {
    return email.trim().toLowerCase()
}

export function isValidEmail(email) {
    return typeof email === 'string' &&
        email.trim().length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function isValidRegistrationPassword(password) {
    return typeof password === 'string' &&
        password.length >= 8 &&
        Buffer.byteLength(password, 'utf8') <= 72
}

export function isValidWateringInterval(days) {
    return Number.isInteger(days) && days >= 1 && days <= 365
}

export function isValidReminderWeekdays(days) {
    return Array.isArray(days) &&
        days.length <= 7 &&
        days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
        new Set(days).size === days.length
}

export function getUploadedPlantPhotoPath(url) {
    if (typeof url !== 'string' || !url.trim() || url.length > 2048) return null

    const value = url.trim()
    const expectedPath = /^\/uploads\/plants\/[a-f0-9]{32}\.(?:jpe?g|png|webp|heic)$/i
    let pathname

    if (value.startsWith('/')) {
        pathname = value
    } else {
        try {
            const parsed = new URL(value)
            if (!['http:', 'https:'].includes(parsed.protocol) ||
                parsed.username || parsed.password || parsed.search || parsed.hash) {
                return null
            }
            pathname = parsed.pathname
        } catch {
            return null
        }
    }

    return expectedPath.test(pathname) ? pathname : null
}

export function isUploadedPlantPhotoUrl(url, { protocol, host } = {}) {
    const pathname = getUploadedPlantPhotoPath(url)
    if (!pathname) return false
    if (url.trim().startsWith('/')) return true

    try {
        const parsed = new URL(url.trim())
        const sameOrigin = protocol && host ? parsed.origin === `${protocol}//${host}` : true
        return (
            sameOrigin &&
            !parsed.username &&
            !parsed.password &&
            parsed.pathname === pathname &&
            !parsed.search &&
            !parsed.hash
        )
    } catch {
        return false
    }
}


export function normalizeUsername(v) {
    if (typeof v !== 'string') return ''
    return v.trim().toLowerCase().replace(/^@+/, '')
}

export function isValidUsername(v) {
    if (typeof v !== 'string') return false
    const s = normalizeUsername(v)
    return /^[a-z0-9._]{3,30}$/.test(s)
}

export function isValidPhone(v) {
    if (typeof v !== 'string') return false
    const s = v.trim()
    if (!s) return true
    return /^\+?[0-9\s\-()]{7,20}$/.test(s)
}

export function normalizePhone(v) {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (!s) return null
    const cleaned = s.replace(/[^\d+]/g, '')
    return cleaned || null
}

export function isValidBio(v) {
    if (v === undefined || v === null) return true
    if (typeof v !== 'string') return false
    return v.length <= 300
}