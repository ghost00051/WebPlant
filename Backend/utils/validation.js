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
        password.length > 0 &&
        Buffer.byteLength(password, 'utf8') <= 72
}

export function isValidWateringInterval(days) {
    return Number.isInteger(days) && days >= 1 && days <= 365
}
