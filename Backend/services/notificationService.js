import Notification from '../models/Notification.js'
import pushService from './pushService.js'

export const NOTIFICATION_TITLE_MAX_LENGTH = 120
export const NOTIFICATION_BODY_MAX_LENGTH = 1000

const PUSH_TRANSIENT_RETRY_DELAY_MS = 250

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

    try {
        const first = await sendOnce()
        if (!retryOnTransient || !shouldRetryPush(first)) return first

        await sleep(PUSH_TRANSIENT_RETRY_DELAY_MS)
        return await sendOnce()
    } catch (error) {
        console.error(
            `❌ Не удалось отправить push пользователю ${userId}:`,
            error?.message || error
        )
        return null
    }
}
