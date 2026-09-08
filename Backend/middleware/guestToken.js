import { v4 as uuidv4 } from 'uuid'

const GUEST_TOKEN_LIFETIME = 60 * 60 * 1000 

export function generateGuestToken() {
    return `guest_${uuidv4().replace(/-/g, '')}_${Date.now()}`
}

export function getGuestToken(req, res, next) {
    let guestToken = req.cookies.guest_token

    if (!guestToken) {
        guestToken = generateGuestToken()

        res.cookie('guest_token', guestToken, {
            maxAge: GUEST_TOKEN_LIFETIME,
            httpOnly: true,
            sameSite: 'lax',
            path: '/'
        })

        console.log(`🆕 Создан новый guest_token: ${guestToken} (живёт 1 час)`)
    } else {
        const tokenData = parseGuestToken(guestToken)
        if (tokenData && tokenData.timestamp) {
            const tokenAge = Date.now() - tokenData.timestamp
            if (tokenAge > GUEST_TOKEN_LIFETIME) {
                guestToken = generateGuestToken()

                res.cookie('guest_token', guestToken, {
                    maxAge: GUEST_TOKEN_LIFETIME,
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/'
                })

                console.log(`🔄 Старый guest_token истёк, создан новый: ${guestToken}`)
            } else {
                console.log(`🔄 Найден guest_token: ${guestToken} (осталось ${Math.round((GUEST_TOKEN_LIFETIME - tokenAge) / 60000)} мин.)`)
            }
        }
    }

    req.guestToken = guestToken
    next()
}

function parseGuestToken(token) {
    try {
        const parts = token.split('_')
        if (parts.length === 3) {
            const timestamp = parseInt(parts[2])
            if (!isNaN(timestamp)) {
                return { timestamp }
            }
        }
        return null
    } catch {
        return null
    }
}