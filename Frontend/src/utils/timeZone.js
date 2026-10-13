import { API_URL } from './api.js'

export const DEFAULT_TIME_ZONE = 'Europe/Moscow'

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

export async function syncUserTimeZone(currentTimeZone) {
  const detected = detectTimeZone()
  if (!detected || detected === currentTimeZone) return detected

  try {
    const response = await fetch(`${API_URL}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: detected }),
      credentials: 'include',
    })

    if (!response.ok) {
      console.error(`Не удалось сохранить часовой пояс: HTTP ${response.status}`)
    }
  } catch (error) {
    console.error('Не удалось сохранить часовой пояс:', error)
  }

  return detected
}
