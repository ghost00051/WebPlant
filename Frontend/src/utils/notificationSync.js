export const UNREAD_POLL_MS = 90_000

export const NOTIFICATIONS_REFRESH_EVENT = 'webplant:notifications-refresh'

const NOTIFICATION_EVENTS = new Set([
  'push-received',
  'notifications-changed',
  'weekly-recap'
])

const REFRESH_THROTTLE_MS = 1_000

let lastRefreshDispatchedAt = 0

export function isNotificationChange (event) {
  return NOTIFICATION_EVENTS.has(event?.data?.type)
}

export function isWeeklyRecapChange (event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return false
  return (
    data.type === 'weekly-recap' ||
    data.tag === 'weekly_recap' ||
    data.notificationType === 'weekly_recap'
  )
}

export function publishNotificationsRefresh (detail = {}) {
  if (typeof window === 'undefined') return false

  try {
    window.dispatchEvent(
      new CustomEvent(NOTIFICATIONS_REFRESH_EVENT, {
        detail: detail && typeof detail === 'object' ? detail : {}
      })
    )
    return true
  } catch (error) {
    console.warn('Не удалось отправить событие обновления уведомлений:', error)
    return false
  }
}

export function subscribeToNotificationsRefresh (onRefresh) {
  if (typeof window === 'undefined' || typeof onRefresh !== 'function') {
    return () => {}
  }

  const handleRefresh = event => onRefresh(event?.detail ?? {})

  window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, handleRefresh)

  return () => {
    window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, handleRefresh)
  }
}

function emitRefresh (detail) {
  const timestamp = Date.now()
  if (timestamp - lastRefreshDispatchedAt < REFRESH_THROTTLE_MS) return
  lastRefreshDispatchedAt = timestamp
  publishNotificationsRefresh(detail)
}

export function subscribeToNotificationChanges (onChange) {
  if (typeof window === 'undefined' || typeof onChange !== 'function') {
    return () => {}
  }

  const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : null

  const handleMessage = event => {
    if (!isNotificationChange(event)) return

    emitRefresh({
      reason: event.data?.type || 'notification',
      weeklyRecap: isWeeklyRecapChange(event)
    })
    onChange(event.data)
  }

  if (serviceWorker) {
    serviceWorker.addEventListener('message', handleMessage)
  }

  const pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') onChange({ type: 'poll' })
  }, UNREAD_POLL_MS)

  return () => {
    if (serviceWorker) {
      serviceWorker.removeEventListener('message', handleMessage)
    }
    window.clearInterval(pollTimer)
  }
}
