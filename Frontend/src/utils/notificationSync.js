export const UNREAD_POLL_MS = 90_000

const NOTIFICATION_EVENTS = new Set(['push-received', 'notifications-changed'])

export function isNotificationChange (event) {
  return NOTIFICATION_EVENTS.has(event?.data?.type)
}


export function subscribeToNotificationChanges (onChange) {
  if (typeof window === 'undefined' || typeof onChange !== 'function') {
    return () => {}
  }

  const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : null

  const handleMessage = event => {
    if (isNotificationChange(event)) onChange(event.data)
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
