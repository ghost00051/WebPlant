import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../utils/api.js'

const SESSIONS_LIMIT = 50

const rememberedSessions = new Map()

function sessionKey(userId) {
  return `user:${userId ?? 'guest'}`
}

function createSessionId() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-')
}

function rememberSession(userId, sessionId) {
  rememberedSessions.set(sessionKey(userId), sessionId)
}

export function useChatSessions(userId, enabled = true) {
  const key = sessionKey(userId)
  const [sessionId, setSessionId] = useState(() => {
    const remembered = rememberedSessions.get(key)
    if (remembered) return remembered
    const created = createSessionId()
    rememberedSessions.set(key, created)
    return created
  })
  const [sessions, setSessions] = useState([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const isMountedRef = useRef(true)
  const sessionKeyRef = useRef(key)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (sessionKeyRef.current === key) return
    sessionKeyRef.current = key
    const remembered = rememberedSessions.get(key)
    const next = remembered || createSessionId()
    rememberedSessions.set(key, next)
    setSessionId(next)
    setIsHistoryOpen(false)
  }, [key])

  const applySession = useCallback(nextSessionId => {
    if (!nextSessionId) return
    rememberSession(userId, nextSessionId)
    setSessionId(nextSessionId)
    setIsHistoryOpen(false)
  }, [userId])

  const startNewChat = useCallback(() => {
    const created = createSessionId()
    rememberSession(userId, created)
    setSessionId(created)
    setIsHistoryOpen(false)
  }, [userId])

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true)
  }, [])

  const closeHistory = useCallback(() => {
    setIsHistoryOpen(false)
  }, [])

  const refreshSessions = useCallback(async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(`${API_URL}/chat/sessions?limit=${SESSIONS_LIMIT}`, {
        credentials: 'include',
        signal: controller.signal
      })
      if (!res.ok) return
      const data = await res.json()
      if (!isMountedRef.current) return
      setSessions(Array.isArray(data?.items) ? data.items : [])
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Chat sessions error:', error)
      }
    } finally {
      window.clearTimeout(timer)
      if (isMountedRef.current) setIsLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setTimeout(() => {
      void refreshSessions()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [enabled, refreshSessions])

  const deleteSession = useCallback(async deletedId => {
    if (!deletedId) return
    if (!window.confirm('Удалить этот чат? Восстановить его не получится.')) return

    try {
      const res = await fetch(`${API_URL}/chat/history`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId: deletedId })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }
    } catch (error) {
      console.error('Delete chat error:', error)
      window.alert('Не удалось удалить чат. Попробуйте ещё раз.')
      return
    }

    if (deletedId === sessionId) {
      const created = createSessionId()
      rememberSession(userId, created)
      setSessionId(created)
    }
    refreshSessions()
  }, [refreshSessions, sessionId, userId])

  return {
    sessionId,
    sessions,
    isLoadingSessions,
    isHistoryOpen,
    openHistory,
    closeHistory,
    startNewChat,
    selectSession: applySession,
    deleteSession,
    refreshSessions
  }
}

export default useChatSessions
