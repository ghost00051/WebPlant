import { API_URL } from './api.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'
import { subscribeToNotificationChanges } from './notificationSync.js'
import { clearAppBadge, normalizeUnreadCount, publishUnreadCount } from './appBadge.js'

export async function refreshAppBadge () {
  try {
    const response = await fetchWithTimeout(
      `${API_URL}/notifications/unread-count`,
      { method: 'GET', credentials: 'include' }
    )

    if (!response.ok) {
      if (response.status === 401) clearAppBadge()
      return null
    }

    const data = await response.json().catch(() => ({}))
    if (!Number.isInteger(data?.unreadCount)) return null

    publishUnreadCount(data.unreadCount)
    return normalizeUnreadCount(data.unreadCount)
  } catch (error) {
    console.warn('Не удалось синхронизировать бейдж уведомлений:', error)
    return null
  }
}


export function startAppBadgeSync () {
  if (typeof window === 'undefined') return () => {}

  let stopped = false

  const refresh = () => {
    if (stopped) return
    void refreshAppBadge()
  }

  refresh()

  const unsubscribe = subscribeToNotificationChanges(refresh)
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  const handleFocus = () => refresh()

  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('focus', handleFocus)
  window.addEventListener('online', handleFocus)

  return () => {
    stopped = true
    unsubscribe()
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('online', handleFocus)
  }
}
