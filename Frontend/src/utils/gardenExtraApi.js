import { API_URL } from './api.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

export const VIEWER_SESSION = Object.freeze({
  authenticated: 'authenticated',
  guest: 'guest',
  unknown: 'unknown'
})

const VIEWER_SESSION_TIMEOUT_MS = 4_000
const GUEST_STATUSES = new Set([401, 403, 404])

export function normalizeViewerSessionState (status) {
  if (status === VIEWER_SESSION.authenticated) return VIEWER_SESSION.authenticated
  if (status === VIEWER_SESSION.guest) return VIEWER_SESSION.guest
  return VIEWER_SESSION.unknown
}

export function isViewerAuthenticated (state) {
  return state === VIEWER_SESSION.authenticated
}

export async function fetchViewerSessionState (options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : VIEWER_SESSION_TIMEOUT_MS

  try {
    const response = await fetchWithTimeout(
      `${API_URL}/users/me`,
      {
        method: 'GET',
        credentials: 'include',
        signal: options.signal
      },
      timeoutMs
    )

    if (response.ok) return VIEWER_SESSION.authenticated
    if (GUEST_STATUSES.has(response.status)) return VIEWER_SESSION.guest
    return VIEWER_SESSION.unknown
  } catch (error) {
    if (error?.name === 'AbortError') return VIEWER_SESSION.unknown
    return VIEWER_SESSION.unknown
  }
}
