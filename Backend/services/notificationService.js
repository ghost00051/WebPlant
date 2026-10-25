import Notification from '../models/Notification.js'
import pushService from './pushService.js'
import { messengerDelivery, notificationKindFromTag } from './botChannelService.js'

export const NOTIFICATION_TITLE_MAX_LENGTH = 120
export const NOTIFICATION_BODY_MAX_LENGTH = 1000

const PUSH_TRANSIENT_RETRY_DELAY_MS = 250

const DEFAULT_BOT_DELIVERY_TIMEOUT_MS = 3000
const MAX_BOT_DELIVERY_TIMEOUT_MS = 10_000

export function readBotDeliveryTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(env?.BOT_DELIVERY_TIMEOUT_MS ?? '', 10)
    if (!Number.isInteger(parsed)) return DEFAULT_BOT_DELIVERY_TIMEOUT_MS
    return Math.min(Math.max(parsed, 250), MAX_BOT_DELIVERY_TIMEOUT_MS)
}

function waitWithTimeout(promise, timeoutMs) {
    return new Promise(resolve => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            resolve({ timedOut: true })
        }, timeoutMs)
        timer.unref?.()

        Promise.resolve(promise)
            .then(value => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(value)
            })
            .catch(() => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(null)
            })
    })
}

function clampText(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function clampNotificationText({ title, body }) {
    return {
        title: clampText(title, NOTIFICATION_TITLE_MAX_LENGTH),
        body: clampText(body, NOTIFICATION_BODY_MAX_LENGTH)
    }
}

export async function storeNotification({
    userId,
    plantId = null,
    type,
    title,
    body,
    url = '/home',
    dedupeKey,
    scheduledFor = null,
    payload = {}
}) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new TypeError('Notification userId must be a positive integer')
    }
    if (typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > 255) {
        throw new TypeError('Notification dedupeKey must contain 1 to 255 characters')
    }

    const safeText = clampNotificationText({ title, body })

    const [notification, created] = await Notification.findOrCreate({
        where: {
            user_id: userId,
            dedupe_key: dedupeKey
        },
        defaults: {
            user_id: userId,
            plant_id: plantId,
            type,
            title: safeText.title,
            body: safeText.body,
            url,
            dedupe_key: dedupeKey,
            scheduled_for: scheduledFor,
            payload
        }
    })

    return { notification, created }
}

function shouldRetryPush(result) {
    return Boolean(result) &&
        result.sent === 0 &&
        Number(result.failed) > 0
}

function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms))
}

function isDeliverableNotificationId(value) {
    return Number.isInteger(value) && value > 0
}

export function resolveNotificationDeliveryUrl(data) {
    if (data && typeof data.url === 'string' && data.url.trim()) return data.url.trim()
    return '/home'
}

export async function deliverNotificationToMessengersSafely({ userId, title, body, data = {} }) {
    try {
        return await messengerDelivery.deliver({
            userId,
            title,
            body,
            url: resolveNotificationDeliveryUrl(data),
            kind: notificationKindFromTag(data?.tag),
            notificationId: isDeliverableNotificationId(data?.notificationId)
                ? data.notificationId
                : null
        })
    } catch (error) {
        console.warn(
            `⚠️ Боты: не удалось доставить уведомление пользователю ${userId}: ` +
            `${error?.message || error}`
        )
        return null
    }
}

export async function sendNotificationPush({
    userId,
    title,
    body,
    data = {},
    icon = '/icons/icon-192.png',
    retryOnTransient = true
} = {}) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new TypeError('Push userId must be a positive integer')
    }

    const sendOnce = () => pushService.sendToUser(userId, title, body, icon, data)

    let result = null
    try {
        const first = await sendOnce()
        if (!retryOnTransient || !shouldRetryPush(first)) {
            result = first
        } else {
            await sleep(PUSH_TRANSIENT_RETRY_DELAY_MS)
            result = await sendOnce()
        }
    } catch (error) {
        console.error(
            `❌ Не удалось отправить push пользователю ${userId}:`,
            error?.message || error
        )
        result = null
    }

    await waitWithTimeout(
        deliverNotificationToMessengersSafely({ userId, title, body, data }),
        readBotDeliveryTimeoutMs()
    )

    return result
}
