export const DEFAULT_SOCIAL_CRITICAL_MASS = 50

export const SOCIAL_FEATURE_REASONS = Object.freeze({
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    CRITICAL_MASS: 'critical_mass',
    UNAVAILABLE: 'unavailable'
})

export const FEATURE_FLAGS = Object.freeze({
    FEATURE_GARDEN_SHARING: Object.freeze({
        defaultValue: true,
        description: 'Шаринг сада F13 (публичная ссылка на сад) — запущен, включён по умолчанию'
    }),
    FEATURE_SOCIAL_FEED: Object.freeze({
        defaultValue: false,
        description: 'Лента садов — не запускать до критической массы шарингов'
    }),
    FEATURE_SOCIAL_COMMENTS: Object.freeze({
        defaultValue: false,
        description: 'Комментарии к садам — не запускать до критической массы шарингов'
    })
})

export const KNOWN_FEATURE_FLAGS = Object.freeze(Object.keys(FEATURE_FLAGS))

const TRUE_VALUES = new Set(['on', 'true', '1', 'yes'])
const FALSE_VALUES = new Set(['off', 'false', '0', 'no'])

function resolveEnv(env) {
    if (env && typeof env === 'object') return env
    try {
        return process.env && typeof process.env === 'object' ? process.env : {}
    } catch {
        return {}
    }
}

function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') {
        if (value === 1) return true
        if (value === 0) return false
        return defaultValue
    }
    const normalized = String(value).trim().toLowerCase()
    if (TRUE_VALUES.has(normalized)) return true
    if (FALSE_VALUES.has(normalized)) return false
    return defaultValue
}

export function isFeatureEnabled(name, { env } = {}) {
    try {
        if (typeof name !== 'string') return false
        if (!Object.hasOwn(FEATURE_FLAGS, name)) return false
        const source = resolveEnv(env)
        return parseBoolean(source[name], FEATURE_FLAGS[name].defaultValue)
    } catch {
        return false
    }
}

function readCriticalMass(env) {
    try {
        const source = resolveEnv(env)
        const raw = source.SOCIAL_CRITICAL_MASS
        if (raw === undefined || raw === null || raw === '') {
            return DEFAULT_SOCIAL_CRITICAL_MASS
        }
        if (typeof raw === 'number') {
            return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SOCIAL_CRITICAL_MASS
        }
        const normalized = String(raw).trim()
        if (!/^\d+$/.test(normalized)) return DEFAULT_SOCIAL_CRITICAL_MASS
        const parsed = Number(normalized)
        return Number.isSafeInteger(parsed) ? parsed : DEFAULT_SOCIAL_CRITICAL_MASS
    } catch {
        return DEFAULT_SOCIAL_CRITICAL_MASS
    }
}

function normalizeShareCount(shareCount) {
    if (shareCount === undefined || shareCount === null) return null
    if (typeof shareCount === 'boolean') return null
    const parsed = typeof shareCount === 'number' ? shareCount : Number(shareCount)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return Math.trunc(parsed)
}

function socialFeatureState(enabled, { unavailable, reached }) {
    if (!enabled) {
        return { enabled: false, reason: SOCIAL_FEATURE_REASONS.DISABLED }
    }
    if (unavailable) {
        return { enabled: false, reason: SOCIAL_FEATURE_REASONS.UNAVAILABLE }
    }
    if (!reached) {
        return { enabled: false, reason: SOCIAL_FEATURE_REASONS.CRITICAL_MASS }
    }
    return { enabled: true, reason: SOCIAL_FEATURE_REASONS.ENABLED }
}

function failClosedState() {
    return {
        gardenSharing: { enabled: true, reason: SOCIAL_FEATURE_REASONS.ENABLED },
        socialFeed: { enabled: false, reason: SOCIAL_FEATURE_REASONS.UNAVAILABLE },
        socialComments: { enabled: false, reason: SOCIAL_FEATURE_REASONS.UNAVAILABLE },
        criticalMass: {
            current: null,
            threshold: DEFAULT_SOCIAL_CRITICAL_MASS,
            reached: false
        }
    }
}

export function getSocialFeatureState({ shareCount, env } = {}) {
    try {
        const current = normalizeShareCount(shareCount)
        const threshold = readCriticalMass(env)
        const unavailable = current === null
        const reached = !unavailable && current >= threshold

        const sharingEnabled = isFeatureEnabled('FEATURE_GARDEN_SHARING', { env })
        const feedEnabled = isFeatureEnabled('FEATURE_SOCIAL_FEED', { env })
        const commentsEnabled = isFeatureEnabled('FEATURE_SOCIAL_COMMENTS', { env })

        return {
            gardenSharing: {
                enabled: sharingEnabled,
                reason: sharingEnabled
                    ? SOCIAL_FEATURE_REASONS.ENABLED
                    : SOCIAL_FEATURE_REASONS.DISABLED
            },
            socialFeed: socialFeatureState(feedEnabled, { unavailable, reached }),
            socialComments: socialFeatureState(commentsEnabled, { unavailable, reached }),
            criticalMass: { current, threshold, reached }
        }
    } catch {
        return failClosedState()
    }
}

export default {
    DEFAULT_SOCIAL_CRITICAL_MASS,
    FEATURE_FLAGS,
    KNOWN_FEATURE_FLAGS,
    SOCIAL_FEATURE_REASONS,
    getSocialFeatureState,
    isFeatureEnabled
}
