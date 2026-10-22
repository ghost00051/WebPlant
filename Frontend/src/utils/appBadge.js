export const UNREAD_COUNT_EVENT = 'webplant:unread-count'

export function normalizeUnreadCount (count) {
  const value = Math.floor(Number(count))
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}


export function applyAppBadge (badgeApi, count) {
  if (!badgeApi) return false

  const value = normalizeUnreadCount(count)

  try {
    if (value > 0) {
      if (typeof badgeApi.setAppBadge !== 'function') return false
      Promise.resolve(badgeApi.setAppBadge(value)).catch(() => {})
      return true
    }

    if (typeof badgeApi.clearAppBadge !== 'function') return false
    Promise.resolve(badgeApi.clearAppBadge()).catch(() => {})
    return true
  } catch (error) {
    console.warn('Не удалось обновить бейдж приложения:', error)
    return false
  }
}

export function isAppBadgeSupported () {
  return typeof navigator !== 'undefined' &&
    typeof navigator.setAppBadge === 'function'
}

export function setAppBadgeCount (count) {
  if (typeof navigator === 'undefined') return false
  return applyAppBadge(navigator, count)
}

export function clearAppBadge () {
  return setAppBadgeCount(0)
}

export function publishUnreadCount (count) {
  const value = normalizeUnreadCount(count)
  setAppBadgeCount(value)

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(UNREAD_COUNT_EVENT, { detail: { count: value } })
      )
    } catch (error) {
      console.warn('Не удалось отправить событие счётчика уведомлений:', error)
    }
  }

  return value
}
