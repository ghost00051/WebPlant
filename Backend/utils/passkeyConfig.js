export function getPasskeyConfig(env = process.env) {
    const frontendOrigin = env.FRONTEND_ORIGIN ||
        (env.NODE_ENV === 'production'
            ? env.FRONTEND_URL
            : 'http://localhost:5173')

    return {
        rpId: env.RP_ID?.trim().toLowerCase() || 'localhost',
        frontendOrigins: frontendOrigin
            .split(',')
            .map(origin => origin.trim())
            .filter(Boolean)
    }
}

export function validateProductionPasskeyConfig({
    rpId,
    frontendOrigin,
    frontendUrl
}) {
    const normalizedRpId = typeof rpId === 'string' ? rpId.trim().toLowerCase() : ''
    if (
        !normalizedRpId ||
        normalizedRpId.length > 253 ||
        !normalizedRpId.includes('.') ||
        !normalizedRpId.split('.').every(label =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
        )
    ) {
        throw new Error('RP_ID must be a valid production domain')
    }

    const frontendOrigins = typeof frontendOrigin === 'string'
        ? frontendOrigin.split(',').map(origin => origin.trim()).filter(Boolean)
        : []
    const configuredOrigins = typeof frontendUrl === 'string'
        ? frontendUrl.split(',').map(origin => origin.trim()).filter(Boolean)
        : []

    if (!frontendOrigins.length || !configuredOrigins.length) {
        throw new Error('FRONTEND_ORIGIN and FRONTEND_URL must contain HTTPS origins')
    }

    for (const origin of frontendOrigins) {
        let url
        try {
            url = new URL(origin)
        } catch {
            throw new Error('FRONTEND_ORIGIN must contain valid HTTPS origins')
        }

        if (
            url.protocol !== 'https:' ||
            url.origin !== origin ||
            (url.hostname !== normalizedRpId &&
                !url.hostname.endsWith(`.${normalizedRpId}`))
        ) {
            throw new Error(
                'FRONTEND_ORIGIN must contain HTTPS origins covered by RP_ID'
            )
        }

        if (!configuredOrigins.includes(origin)) {
            throw new Error('Every FRONTEND_ORIGIN must also be listed in FRONTEND_URL')
        }
    }

    return { rpId: normalizedRpId, frontendOrigins }
}
