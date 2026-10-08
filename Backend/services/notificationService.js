import Notification from '../models/Notification.js'

export async function storeNotification({
    userId,
    plantId = null,
    type,
    title,
    body,
    url = '/home',
    dedupeKey,
    scheduledFor = null
}) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new TypeError('Notification userId must be a positive integer')
    }
    if (typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > 255) {
        throw new TypeError('Notification dedupeKey must contain 1 to 255 characters')
    }

    const [notification, created] = await Notification.findOrCreate({
        where: {
            user_id: userId,
            dedupe_key: dedupeKey
        },
        defaults: {
            user_id: userId,
            plant_id: plantId,
            type,
            title,
            body,
            url,
            dedupe_key: dedupeKey,
            scheduled_for: scheduledFor
        }
    })

    return { notification, created }
}
