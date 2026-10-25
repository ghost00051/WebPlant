import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_SOCIAL_CRITICAL_MASS,
    FEATURE_FLAGS,
    KNOWN_FEATURE_FLAGS,
    getSocialFeatureState,
    isFeatureEnabled
} from './featureFlags.js'

const MASS = 100

test('дефолты: garden sharing включён, лента и комментарии выключены', () => {
    const state = getSocialFeatureState({ shareCount: MASS, env: {} })

    assert.deepEqual(state.gardenSharing, { enabled: true, reason: 'enabled' })
    assert.deepEqual(state.socialFeed, { enabled: false, reason: 'disabled' })
    assert.deepEqual(state.socialComments, { enabled: false, reason: 'disabled' })
    assert.deepEqual(state.criticalMass, {
        current: MASS,
        threshold: DEFAULT_SOCIAL_CRITICAL_MASS,
        reached: true
    })
})

test('дефолты: known flags и описания заморожены, неизвестный флаг → false', () => {
    assert.deepEqual(KNOWN_FEATURE_FLAGS, [
        'FEATURE_GARDEN_SHARING',
        'FEATURE_SOCIAL_FEED',
        'FEATURE_SOCIAL_COMMENTS'
    ])
    assert.equal(Object.isFrozen(FEATURE_FLAGS), true)
    assert.equal(FEATURE_FLAGS.FEATURE_GARDEN_SHARING.defaultValue, true)
    assert.equal(FEATURE_FLAGS.FEATURE_SOCIAL_FEED.defaultValue, false)
    assert.equal(FEATURE_FLAGS.FEATURE_SOCIAL_COMMENTS.defaultValue, false)

    assert.equal(isFeatureEnabled('FEATURE_GARDEN_SHARING', { env: {} }), true)
    assert.equal(isFeatureEnabled('FEATURE_SOCIAL_FEED', { env: {} }), false)
    assert.equal(isFeatureEnabled('FEATURE_UNKNOWN', { env: {} }), false)
    assert.equal(isFeatureEnabled('toString', { env: {} }), false)
    assert.equal(isFeatureEnabled('__proto__', { env: {} }), false)
    assert.equal(isFeatureEnabled('', { env: {} }), false)
    assert.equal(isFeatureEnabled(null, { env: {} }), false)
    assert.equal(isFeatureEnabled(42, { env: {} }), false)
})

test('env parsing: on/true/1/yes включают флаг', () => {
    for (const value of ['on', 'true', '1', 'yes', 'TRUE', ' On ']) {
        const state = getSocialFeatureState({
            shareCount: MASS,
            env: { FEATURE_SOCIAL_FEED: value, FEATURE_SOCIAL_COMMENTS: value }
        })
        assert.equal(state.socialFeed.enabled, true, `значение ${value} должно включать ленту`)
        assert.equal(state.socialComments.enabled, true, `значение ${value} должно включать комментарии`)
        assert.equal(state.socialFeed.reason, 'enabled')
    }
})

test('env parsing: off/false/0/no выключают флаг даже при достигнутой массе', () => {
    for (const value of ['off', 'false', '0', 'no', 'FALSE', ' Off ']) {
        const state = getSocialFeatureState({
            shareCount: MASS,
            env: { FEATURE_SOCIAL_FEED: value, FEATURE_SOCIAL_COMMENTS: value }
        })
        assert.equal(state.socialFeed.enabled, false, `значение ${value} должно выключать ленту`)
        assert.equal(state.socialFeed.reason, 'disabled')
        assert.equal(state.criticalMass.reached, true)
    }
})

test('env parsing: непонятное значение трактуется как дефолт флага', () => {
    const state = getSocialFeatureState({
        shareCount: MASS,
        env: { FEATURE_SOCIAL_FEED: 'maybe', FEATURE_SOCIAL_COMMENTS: '42', FEATURE_GARDEN_SHARING: 'nope' }
    })

    assert.equal(state.socialFeed.enabled, false)
    assert.equal(state.socialComments.enabled, false)
    assert.equal(state.gardenSharing.enabled, true)
})

test('граница critical mass: ровно порог включает соцфичи, ниже — нет', () => {
    const env = {
        FEATURE_SOCIAL_FEED: 'on',
        FEATURE_SOCIAL_COMMENTS: 'on',
        SOCIAL_CRITICAL_MASS: '50'
    }

    const below = getSocialFeatureState({ shareCount: 49, env })
    assert.equal(below.socialFeed.enabled, false)
    assert.equal(below.socialFeed.reason, 'critical_mass')
    assert.equal(below.criticalMass.reached, false)
    assert.equal(below.criticalMass.current, 49)
    assert.equal(below.criticalMass.threshold, 50)

    const exactly = getSocialFeatureState({ shareCount: 50, env })
    assert.equal(exactly.socialFeed.enabled, true)
    assert.equal(exactly.socialFeed.reason, 'enabled')
    assert.equal(exactly.criticalMass.reached, true)

    const above = getSocialFeatureState({ shareCount: 51, env })
    assert.equal(above.socialFeed.enabled, true)
    assert.equal(above.socialComments.enabled, true)
})

test('порог из env: кастомное значение и дефолт при некорректном', () => {
    const custom = getSocialFeatureState({
        shareCount: 10,
        env: { FEATURE_SOCIAL_FEED: 'on', SOCIAL_CRITICAL_MASS: '10' }
    })
    assert.equal(custom.criticalMass.threshold, 10)
    assert.equal(custom.criticalMass.reached, true)
    assert.equal(custom.socialFeed.enabled, true)

    for (const raw of ['abc', '-5', '1.5', '']) {
        const state = getSocialFeatureState({ shareCount: 0, env: { SOCIAL_CRITICAL_MASS: raw } })
        assert.equal(
            state.criticalMass.threshold,
            DEFAULT_SOCIAL_CRITICAL_MASS,
            `некорректный порог ${JSON.stringify(raw)} → дефолт`
        )
    }

    const zeroThreshold = getSocialFeatureState({
        shareCount: 0,
        env: { FEATURE_SOCIAL_FEED: 'on', SOCIAL_CRITICAL_MASS: '0' }
    })
    assert.equal(zeroThreshold.criticalMass.threshold, 0)
    assert.equal(zeroThreshold.criticalMass.reached, true)
    assert.equal(zeroThreshold.socialFeed.enabled, true)
})

test('fail-closed: shareCount недоступен → лента/комментарии off, reason unavailable, без 500', () => {
    for (const shareCount of [undefined, null, NaN, -5, 'abc', true, {}]) {
        let state
        assert.doesNotThrow(() => {
            state = getSocialFeatureState({
                shareCount,
                env: {
                    FEATURE_SOCIAL_FEED: 'on',
                    FEATURE_SOCIAL_COMMENTS: 'on',
                    SOCIAL_CRITICAL_MASS: '0'
                }
            })
        })

        assert.equal(state.criticalMass.current, null)
        assert.equal(state.criticalMass.reached, false)
        assert.deepEqual(state.socialFeed, { enabled: false, reason: 'unavailable' })
        assert.deepEqual(state.socialComments, { enabled: false, reason: 'unavailable' })
    }
})

test('fail-closed: вызов без аргументов возвращает выключенные соцфичи', () => {
    const state = getSocialFeatureState()

    assert.equal(state.criticalMass.current, null)
    assert.equal(state.criticalMass.reached, false)
    assert.equal(state.socialFeed.enabled, false)
    assert.equal(state.socialComments.enabled, false)
    assert.equal(state.gardenSharing.enabled, true)
})

test('sharing: off из env выключает, дефолт и мусор — включают', () => {
    const disabled = getSocialFeatureState({
        shareCount: MASS,
        env: { FEATURE_GARDEN_SHARING: 'off' }
    })
    assert.deepEqual(disabled.gardenSharing, { enabled: false, reason: 'disabled' })

    for (const env of [{}, { FEATURE_GARDEN_SHARING: 'maybe' }, { FEATURE_GARDEN_SHARING: '' }]) {
        assert.equal(getSocialFeatureState({ shareCount: MASS, env }).gardenSharing.enabled, true)
    }
})

test('lazy env: process.env читается на каждый вызов, а не при импорте', () => {
    const previous = process.env.FEATURE_SOCIAL_FEED
    const previousThreshold = process.env.SOCIAL_CRITICAL_MASS
    try {
        delete process.env.FEATURE_SOCIAL_FEED
        delete process.env.SOCIAL_CRITICAL_MASS
        assert.equal(isFeatureEnabled('FEATURE_SOCIAL_FEED'), false)

        process.env.FEATURE_SOCIAL_FEED = 'on'
        process.env.SOCIAL_CRITICAL_MASS = '5'
        assert.equal(isFeatureEnabled('FEATURE_SOCIAL_FEED'), true)

        const state = getSocialFeatureState({ shareCount: 5 })
        assert.equal(state.socialFeed.enabled, true)
        assert.equal(state.criticalMass.threshold, 5)
    } finally {
        if (previous === undefined) delete process.env.FEATURE_SOCIAL_FEED
        else process.env.FEATURE_SOCIAL_FEED = previous
        if (previousThreshold === undefined) delete process.env.SOCIAL_CRITICAL_MASS
        else process.env.SOCIAL_CRITICAL_MASS = previousThreshold
    }
})

test('нет мутаций: env и входные данные не меняются, результат — новый объект', () => {
    const env = Object.freeze({
        FEATURE_SOCIAL_FEED: 'on',
        FEATURE_SOCIAL_COMMENTS: 'on',
        SOCIAL_CRITICAL_MASS: '10'
    })
    const input = Object.freeze({ shareCount: 12, env })

    const first = getSocialFeatureState(input)
    const second = getSocialFeatureState(input)

    assert.deepEqual(first, second)
    assert.notEqual(first, second)
    assert.notEqual(first.criticalMass, second.criticalMass)
    assert.notEqual(first.socialFeed, second.socialFeed)

    first.socialFeed.enabled = false
    first.criticalMass.threshold = 0
    assert.equal(getSocialFeatureState(input).socialFeed.enabled, true)
    assert.equal(getSocialFeatureState(input).criticalMass.threshold, 10)

    assert.deepEqual(env, {
        FEATURE_SOCIAL_FEED: 'on',
        FEATURE_SOCIAL_COMMENTS: 'on',
        SOCIAL_CRITICAL_MASS: '10'
    })
})
