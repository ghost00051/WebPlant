import webpush from 'web-push'
import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import PushSubscription from '../models/PushSubscription.js'
import * as pushValidation from '../utils/pushValidation.js'

dotenv.config()

export const MAX_PUSH_PAYLOAD_BYTES = 3800
export const DEFAULT_ICON = '/icons/icon-192.png'
export const DEFAULT_BADGE = '/icons/icon-192.png'
export const QUARANTINE_AFTER_FAILURES = 5

const SEND_TIMEOUT_MS = 10_000
const DEFAULT_CONCURRENCY = 10
const MAX_CONCURRENCY = 50
const SUCCESS_STATE_REFRESH_MS = 24 * 60 * 60 * 1000
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])
const TERMINAL_INVALID_STATUS_CODES = new Set([400, 401, 403, 413])

const pushState = {
    configured: false,
    valid: false,
    error: null
}

function initializeVapid() {
    const subject = process.env.VAPID_SUBJECT
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY

    if (!subject || !publicKey || !privateKey) {
        pushState.configured = false
        pushState.valid = false
        pushState.error = 'VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы'
        return
    }

    pushState.configured = true
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey)
        pushState.valid = true
        pushState.error = null
    } catch (error) {
        pushState.valid = false
        pushState.error = `VAPID configuration invalid: ${error?.message || error}`
        console.error(`❌ Push-уведомления отключены: ${pushState.error}`)
    }
}

initializeVapid()

export function getPushStatus() {
    return { ...pushState }
}

export function endpointFingerprint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length === 0) return 'unknown'
    return createHash('sha256').update(endpoint).digest('hex').slice(0, 12)
}

function trimErrorMessage(error) {
    return String(error?.message || error || 'unknown error')
        .replace(/\s+/g, ' ')
        .slice(0, 200)
}

export function classifyPushError(error) {
    const rawStatus = error?.statusCode ?? error?.status
    const statusCode = Number.isInteger(rawStatus) ? rawStatus : null

    if (statusCode === 404 || statusCode === 410) {
        return { kind: 'expired', statusCode, reason: `http_${statusCode}` }
    }
    if (statusCode !== null && TERMINAL_INVALID_STATUS_CODES.has(statusCode)) {
        return { kind: 'invalid', statusCode, reason: `http_${statusCode}` }
    }
    if (statusCode === null || statusCode >= 500 || RETRYABLE_STATUS_CODES.has(statusCode)) {
        const reason = statusCode === null
            ? (String(error?.message || '').toLowerCase().includes('timeout') ? 'timeout' : 'network_error')
            : `http_${statusCode}`
        return { kind: 'retryable', statusCode, reason }
    }

    return { kind: 'invalid', statusCode, reason: `http_${statusCode}` }
}

function fallbackValidateSubscriptionForSend(subscription) {
    if (!subscription || typeof subscription !== 'object') {
        return { ok: false, reason: 'subscription_missing' }
    }
    const endpoint = subscription.endpoint
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
        return { ok: false, reason: 'endpoint_invalid' }
    }
    try {
        const url = new URL(endpoint)
        if (url.protocol !== 'https:' || (url.port && url.port !== '443')) {
            return { ok: false, reason: 'endpoint_url_invalid' }
        }
    } catch {
        return { ok: false, reason: 'endpoint_url_invalid' }
    }
    const p256dh = subscription.p256dh ?? subscription.keys?.p256dh
    const auth = subscription.auth ?? subscription.keys?.auth
    if (typeof p256dh !== 'string' || typeof auth !== 'string') {
        return { ok: false, reason: 'keys_missing' }
    }
    const publicKey = Buffer.from(p256dh, 'base64url')
    const authSecret = Buffer.from(auth, 'base64url')
    if (publicKey.length !== 65 || authSecret.length !== 16) {
        return { ok: false, reason: 'keys_invalid' }
    }
    return { ok: true }
}

export function validateSubscriptionForSend(subscription) {
    if (typeof pushValidation.validateSubscriptionForSend === 'function') {
        try {
            const result = pushValidation.validateSubscriptionForSend(subscription)
            if (result && typeof result.ok === 'boolean') return result
        } catch (error) {
            console.warn(
                `⚠️ push: не удалось провалидировать подписку через pushValidation: ` +
                `${error?.message || error}`
            )
        }
    }
    return fallbackValidateSubscriptionForSend(subscription)
}

function byteLength(value) {
    return Buffer.byteLength(value, 'utf8')
}

export function buildPushPayload(title, body, icon = DEFAULT_ICON, data = {}, {
    maxBytes = MAX_PUSH_PAYLOAD_BYTES
} = {}) {
    const payload = {
        title: String(title ?? ''),
        body: String(body ?? ''),
        icon: typeof icon === 'string' && icon ? icon : DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: data && typeof data === 'object' ? data : {}
    }

    const size = () => byteLength(JSON.stringify(payload))
    if (size() <= maxBytes) return JSON.stringify(payload)

    const shrink = key => {
        let characters = Array.from(payload[key])
        while (characters.length > 0 && size() > maxBytes) {
            characters = characters.slice(0, Math.floor(characters.length / 2))
            payload[key] = characters.join('')
        }
        payload[key] = ''
    }

    shrink('body')
    if (size() > maxBytes) shrink('title')
    if (size() > maxBytes) payload.icon = DEFAULT_ICON
    if (size() > maxBytes) payload.data = {}
    if (size() > maxBytes) payload.badge = DEFAULT_BADGE

    return JSON.stringify(payload)
}

function readConcurrency() {
    const parsed = Number.parseInt(process.env.PUSH_CONCURRENCY, 10)
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_CONCURRENCY
    return Math.min(parsed, MAX_CONCURRENCY)
}

export async function mapWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : []
    if (list.length === 0) return []
    const concurrency = Math.max(1, Math.min(Number.isInteger(limit) ? limit : DEFAULT_CONCURRENCY, list.length))
    const results = new Array(list.length)
    let nextIndex = 0

    const run = async () => {
        while (true) {
            const index = nextIndex
            nextIndex += 1
            if (index >= list.length) return
            results[index] = await worker(list[index], index)
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => run()))
    return results
}

function emptyResult(message) {
    return {
        success: false,
        total: 0,
        sent: 0,
        failed: 0,
        removed: 0,
        quarantined: 0,
        message
    }
}

async function updateSubscriptionState(subscription, values) {
    Object.assign(subscription, values)
    if (typeof subscription?.update !== 'function') return
    try {
        await subscription.update(values)
    } catch (error) {
        console.warn(
            `⚠️ push: не удалось сохранить состояние подписки #${subscription.id ?? '?'} ` +
            `(fp=${endpointFingerprint(subscription.endpoint)}): ${trimErrorMessage(error)}`
        )
    }
}

async function quarantineSubscription(subscription, reason, errorMessage, now) {
    const attempts = Number(subscription.failed_attempts || 0) + 1
    await updateSubscriptionState(subscription, {
        failed_attempts: attempts,
        last_error: errorMessage,
        invalidated_at: now,
        invalid_reason: String(reason).slice(0, 120)
    })
}

async function registerRetryableFailure(subscription, reason, errorMessage, now) {
    const attempts = Number(subscription.failed_attempts || 0) + 1
    if (attempts >= QUARANTINE_AFTER_FAILURES) {
        await quarantineSubscription(subscription, 'quarantine_after_5_failures', errorMessage, now)
        return { ok: false, kind: 'quarantined', reason }
    }
    await updateSubscriptionState(subscription, {
        failed_attempts: attempts,
        last_error: errorMessage
    })
    return { ok: false, kind: 'retryable', reason }
}

async function deliverOne(subscription, payload, now) {
    const validation = validateSubscriptionForSend(subscription)
    if (!validation.ok) {
        await quarantineSubscription(
            subscription,
            `invalid_subscription:${validation.reason || 'unknown'}`,
            `subscription validation failed: ${validation.reason || 'unknown'}`,
            now
        )
        console.warn(
            `⚠️ push: подписка #${subscription.id ?? '?'} ` +
            `(fp=${endpointFingerprint(subscription.endpoint)}) в карантин: ${validation.reason || 'unknown'}`
        )
        return { ok: false, kind: 'invalid', id: subscription.id ?? null }
    }

    try {
        await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth
                }
            },
            payload,
            { timeout: SEND_TIMEOUT_MS }
        )

        const shouldPersist = Number(subscription.failed_attempts || 0) > 0 ||
            Boolean(subscription.last_error) ||
            !subscription.last_success_at ||
            (now.getTime() - new Date(subscription.last_success_at).getTime()) > SUCCESS_STATE_REFRESH_MS

        if (shouldPersist) {
            await updateSubscriptionState(subscription, {
                failed_attempts: 0,
                last_error: null,
                last_success_at: now
            })
        } else {
            subscription.failed_attempts = 0
            subscription.last_error = null
        }

        return { ok: true, kind: 'sent', id: subscription.id ?? null }
    } catch (error) {
        const classification = classifyPushError(error)
        const errorMessage = trimErrorMessage(error)

        if (classification.kind === 'expired') {
            let removed = false
            try {
                if (typeof subscription.destroy === 'function') await subscription.destroy()
                removed = true
                console.log(
                    `🗑️ push: удалена устаревшая подписка #${subscription.id ?? '?'} ` +
                    `(fp=${endpointFingerprint(subscription.endpoint)})`
                )
            } catch (destroyError) {
                console.warn(
                    `⚠️ push: не удалось удалить подписку #${subscription.id ?? '?'} ` +
                    `(fp=${endpointFingerprint(subscription.endpoint)}): ${trimErrorMessage(destroyError)}`
                )
            }
            return {
                ok: false,
                kind: removed ? 'expired' : 'retryable',
                statusCode: classification.statusCode,
                id: subscription.id ?? null
            }
        }

        if (classification.kind === 'invalid') {
            await quarantineSubscription(subscription, classification.reason, errorMessage, now)
            console.warn(
                `⚠️ push: подписка #${subscription.id ?? '?'} ` +
                `(fp=${endpointFingerprint(subscription.endpoint)}) в карантин: ` +
                `${classification.reason}`
            )
            return {
                ok: false,
                kind: 'invalid',
                statusCode: classification.statusCode,
                id: subscription.id ?? null
            }
        }

        const retryOutcome = await registerRetryableFailure(
            subscription,
            classification.reason,
            errorMessage,
            now
        )
        console.warn(
            `⚠️ push: ошибка доставки подписки #${subscription.id ?? '?'} ` +
            `(fp=${endpointFingerprint(subscription.endpoint)}): ` +
            `${classification.reason}${retryOutcome.kind === 'quarantined' ? ' -> карантин' : ''}`
        )
        return {
            ok: false,
            kind: retryOutcome.kind,
            statusCode: classification.statusCode,
            id: subscription.id ?? null
        }
    }
}

class PushService {
    getPushStatus() {
        return getPushStatus()
    }

    ensureConfigured() {
        if (!pushState.valid) {
            const error = new Error(pushState.error || 'Push notifications are not configured')
            error.code = 'PUSH_NOT_CONFIGURED'
            error.fatal = true
            throw error
        }
    }

    isConfigured() {
        return pushState.valid
    }

    async sendToUser(userId, title, body, icon = DEFAULT_ICON, data = {}) {
        this.ensureConfigured()
        const subscriptions = await PushSubscription.findAll({
            where: { user_id: userId, invalidated_at: null },
            attributes: [
                'id', 'user_id', 'endpoint', 'p256dh', 'auth',
                'failed_attempts', 'last_error', 'last_success_at', 'invalidated_at'
            ]
        })

        if (subscriptions.length === 0) {
            return emptyResult('No subscriptions')
        }

        return this.sendToSubscriptions(subscriptions, title, body, icon, data)
    }

    async sendToSubscriptions(subscriptions, title, body, icon = DEFAULT_ICON, data = {}) {
        this.ensureConfigured()

        const active = (Array.isArray(subscriptions) ? subscriptions : [])
            .filter(subscription => subscription && subscription.endpoint && !subscription.invalidated_at)

        if (active.length === 0) {
            return emptyResult('No subscriptions')
        }

        const payload = buildPushPayload(title, body, icon, data)
        const now = new Date()
        const outcomes = await mapWithConcurrency(
            active,
            readConcurrency(),
            subscription => deliverOne(subscription, payload, now)
        )

        let sent = 0
        let failed = 0
        let removed = 0
        let quarantined = 0

        for (const outcome of outcomes) {
            if (!outcome) {
                failed += 1
                continue
            }
            if (outcome.kind === 'sent') {
                sent += 1
                continue
            }
            failed += 1
            if (outcome.kind === 'expired') removed += 1
            if (outcome.kind === 'invalid' || outcome.kind === 'quarantined') quarantined += 1
        }

        if (sent + failed > 0) {
            console.log(
                `📊 push: отправлено ${sent}, ошибок ${failed}, удалено ${removed}, ` +
                `карантин ${quarantined} (всего ${active.length})`
            )
        }

        return {
            success: sent > 0,
            total: active.length,
            sent,
            failed,
            removed,
            quarantined,
            outcomes
        }
    }
}

const pushService = new PushService()

export default pushService
