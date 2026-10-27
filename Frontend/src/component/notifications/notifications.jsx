import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackBtn from '../../assets/BackBtn.svg'
import notificationWater from '../../assets/notification-water.svg'
import notificationCare from '../../assets/notification-care.svg'
import notificationAdvice from '../../assets/notification-advice.svg'
import notificationSystem from '../../assets/notification-system.svg'
import notificationAlert from '../../assets/notification-alert.svg'
import notificationCheck from '../../assets/notification-check.svg'
import notificationRecap from '../../assets/notification-recap.svg'
import { API_URL, getMessengerChannels } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { CARE_ACTION_CODES } from '../../utils/careEvents.js'
import { subscribeToNotificationChanges } from '../../utils/notificationSync.js'
import { publishUnreadCount } from '../../utils/appBadge.js'
import { diffInDays } from '../../utils/date.js'
import { markWateredWithQueue, classifyWateringResponse } from '../../utils/offlineQueue.js'
import { trackEvent } from '../../utils/productEvents.js'
import {
  DELIVERY_MODE_DIGEST,
  loadNotificationPreferences,
  readLocalNotificationPreferences,
  saveNotificationPreferences,
  validateQuietHours
} from '../../utils/notificationsExtraApi.js'
import {
  buildDigestSummary,
  buildPlantSections,
  describeQuietWindow,
  notificationPlantId
} from '../../utils/notificationDigest.js'
import CareActionSheet from '../careActions/CareActionSheet.jsx'
import NotificationSettingsBar from './NotificationSettingsBar.jsx'
import NotificationChannelsDialog from './NotificationChannelsDialog.jsx'
import NotificationQuietHoursDialog from './NotificationQuietHoursDialog.jsx'
import { TABS } from '../tools/tabs.js'
import {
  isPushSupported,
  isIOS,
  isStandalone,
  requestPermission,
  setPushDisabledOnThisDevice,
  subscribeToPush
} from '../../utils/pushNotifications.js'
import './notifications.css'
import './dark-theme.css'
import './notificationSettings.css'
import './notificationSettings.dark-theme.css'

const PAGE_SIZE = 20

const FILTER_TABS = [
  { id: 'all', label: 'Все' },
  { id: 'watering', label: 'Поливы' },
  { id: 'care', label: 'Уход' }
]

const FILTER_TAB_ID = filterId => `notificationsFilter-${filterId}`
const FILTER_PANEL_ID = 'notificationsPanel'

const CATEGORIES = {
  watering: { icon: notificationWater, label: 'Полить' },
  care: { icon: notificationCare, label: 'Уход' },
  advice: { icon: notificationAdvice, label: 'Совет' },
  system: { icon: notificationSystem, label: 'Система' },
  alert: { icon: notificationAlert, label: 'Пропуск' }
}

const EMPTY_TEXTS = {
  all: 'Пока нет уведомлений. Здесь появятся напоминания о поливе, утренние сводки и итоги недели.',
  watering: 'Пока нет уведомлений о поливе.',
  care: 'Пока нет уведомлений об уходе.'
}

const WEEKLY_RECAP_META = {
  icon: notificationRecap,
  label: 'Итоги недели'
}

function isWeeklyRecapNotification (item) {
  return item?.type === 'weekly_recap'
}

function visualFor (item) {
  if (isWeeklyRecapNotification(item)) {
    return { ...CATEGORIES.watering, ...WEEKLY_RECAP_META }
  }
  if (item?.type === 'garden_view') {
    return { ...CATEGORIES.system, label: 'Сад' }
  }
  return CATEGORIES[categoryFor(item)]
}

function canUsePush () {
  if (typeof window === 'undefined') return false
  try {
    return isPushSupported()
  } catch {
    return false
  }
}

function isMobileDevice () {
  if (typeof navigator === 'undefined') return false
  return isIOS() || /Android/i.test(navigator.userAgent)
}

function categoryFor (item) {
  const title = String(item?.title || '')
  if (item?.type === 'watering_due') return title.includes('пропущ') ? 'alert' : 'watering'
  if (item?.type === 'watering_day_before') return 'watering'
  if (item?.type === 'morning_summary') return 'watering'
  if (item?.type === 'weekly_recap') return 'watering'
  if (item?.type === 'care_reminder') return 'care'
  if (item?.type === 'care_tip') return 'advice'
  return 'system'
}

function feedCategoryFor (item) {
  if (item?.type === 'watering_due' || item?.type === 'watering_day_before' ||
    item?.type === 'morning_summary' || item?.type === 'weekly_recap') {
    return 'watering'
  }
  if (item?.type === 'care_reminder' || item?.type === 'care_tip') return 'care'
  return null
}

function actionLabelFor (item, category) {
  if (item?.type === 'weekly_recap') return 'Итоги недели'
  if (item?.type === 'morning_summary') return 'Сводка'
  if (item?.type === 'garden_view') return 'Сад'
  return CATEGORIES[category].label
}

function countFromStats (stats, keys) {
  if (!stats || typeof stats !== 'object') return null
  for (const key of keys) {
    const value = Number(stats[key])
    if (Number.isFinite(value) && value >= 0) return Math.floor(value)
  }
  return null
}

function recapStatRows (item) {
  const stats = item?.payload?.stats
  const streak = item?.payload?.streak
  const rows = []

  const watered = countFromStats(stats, ['wateredOnTime', 'watered_on_time', 'onTime'])
  if (watered !== null) rows.push({ key: 'watered', label: 'Поливов вовремя', value: watered })

  const late = countFromStats(stats, ['wateredLate', 'watered_late', 'late'])
  if (late !== null) rows.push({ key: 'late', label: 'С опозданием', value: late })

  const photos = countFromStats(stats, ['photos', 'photoCount', 'photo_count'])
  if (photos !== null) rows.push({ key: 'photos', label: 'Фото', value: photos })

  const careActions = countFromStats(stats, ['careActions', 'care_actions', 'careCount'])
  if (careActions !== null) {
    rows.push({ key: 'care', label: 'Действий ухода', value: careActions })
  }

  const skipped = countFromStats(stats, ['skipped', 'skippedCount'])
  if (skipped !== null) rows.push({ key: 'skipped', label: 'Пропущено', value: skipped })

  const bestStreak = countFromStats(streak, ['best', 'bestStreak'])
  if (bestStreak !== null) {
    rows.push({ key: 'best', label: 'Рекорд серии', value: bestStreak })
  }

  return rows
}

function newWord (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'новое'
  return 'новых'
}

function notificationWord (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'напоминание'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'напоминания'
  return 'напоминаний'
}

function digestTitleFor (section) {
  const labels = []
  if (section.wateringCount > 0) labels.push('Полив')
  if (section.careCount > 0) labels.push('уход')
  const combined = labels.join(' и ')
  const label = combined
    ? `${combined.charAt(0).toUpperCase()}${combined.slice(1)}`
    : 'Напоминания'
  return `${label}: ${section.items.length} ${notificationWord(section.items.length)}`
}

function formatClock (value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatCardTime (value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const days = diffInDays(date, new Date())
  const clock = formatClock(date)

  if (days === 0) return clock
  if (days === -1) return `Вчера, ${clock}`
  if (days > -7 && days < 0) {
    const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date)
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${clock}`
  }
  const day = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short'
  }).format(date).replace('.', '')
  return `${day}, ${clock}`
}

function isCareNotification (item) {
  return item?.type === 'care_reminder' || item?.type === 'care_tip'
}

function isWateringNotification (item) {
  return item?.type === 'watering_due' ||
    item?.type === 'watering_day_before' ||
    item?.type === 'morning_summary'
}

function careInitialActionFor (item) {
  const code = item?.payload?.action_code
  if (typeof code === 'string' && CARE_ACTION_CODES.includes(code)) return code
  return item?.type === 'care_tip' ? 'spray' : 'fertilize'
}

function Notifications () {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadByCategory, setUnreadByCategory] = useState({ all: 0, watering: 0, care: 0 })
  const [nextOffset, setNextOffset] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isMarkingAll, setIsMarkingAll] = useState(false)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [permission, setPermission] = useState(() => {
    if (!canUsePush()) return 'unsupported'
    return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  })
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const [pushSuccess, setPushSuccess] = useState('')
  const [selectedNotification, setSelectedNotification] = useState(null)
  const [careSheet, setCareSheet] = useState(null)
  const [preferences, setPreferences] = useState(() => readLocalNotificationPreferences())
  const [prefsStatus, setPrefsStatus] = useState(null)
  const [prefsSaving, setPrefsSaving] = useState('')
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [quietOpen, setQuietOpen] = useState(false)
  const [channelsSummary, setChannelsSummary] = useState('')
  const [plantNames, setPlantNames] = useState({})
  const [quickBusyKey, setQuickBusyKey] = useState('')
  const [quickStatuses, setQuickStatuses] = useState({})
  const [expandedDigestKey, setExpandedDigestKey] = useState('')
  const filterRefs = useRef(new Map())
  const detailRef = useRef(null)
  const lastSyncRef = useRef(0)
  const feedRequestIdRef = useRef(0)
  const activeFilterRef = useRef('all')

  const deliveryMode = preferences.deliveryMode
  const quietHours = preferences.quietHours
  const quietSummary = describeQuietWindow(quietHours)

  const setFilterRef = tabId => node => {
    if (node) {
      filterRefs.current.set(tabId, node)
    } else {
      filterRefs.current.delete(tabId)
    }
  }

  const handleFilterKeyDown = (event, index) => {
    let nextIndex = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = index + 1
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = index - 1
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = FILTER_TABS.length - 1
    }

    if (nextIndex === null) return

    event.preventDefault()
    const nextTab =
      FILTER_TABS[(nextIndex + FILTER_TABS.length) % FILTER_TABS.length]
    filterRefs.current.get(nextTab.id)?.focus()
    setFilter(nextTab.id)
  }

  useEffect(() => {
    let cancelled = false

    loadNotificationPreferences()
      .then(result => {
        if (cancelled) return
        setPreferences(result.preferences)
        if (!result.ok) {
          setPrefsStatus({
            tone: result.unavailable ? 'warning' : 'error',
            text: result.unavailable
              ? 'Сервер настроек уведомлений пока не обновлён — настройки сохраняются на этом устройстве.'
              : 'Не удалось загрузить настройки уведомлений. Показаны сохранённые на этом устройстве.'
          })
        }
      })
      .catch(loadError => {
        if (!cancelled) console.warn('Не удалось загрузить настройки уведомлений:', loadError)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 12000)

    const loadPlants = async () => {
      try {
        const response = await fetch(`${API_URL}/plants`, {
          credentials: 'include',
          signal: controller.signal
        })
        if (!response.ok) return
        const data = await response.json().catch(() => null)
        if (cancelled || !Array.isArray(data)) return
        const map = {}
        data.forEach(plant => {
          if (plant && plant.id !== undefined && plant.name) map[plant.id] = plant.name
        })
        setPlantNames(map)
      } catch (loadError) {
        if (loadError?.name !== 'AbortError') {
          console.warn('Не удалось загрузить растения для группировки уведомлений:', loadError)
        }
      } finally {
        window.clearTimeout(timer)
      }
    }

    loadPlants()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (channelsOpen) return undefined
    let cancelled = false

    getMessengerChannels()
      .then(data => {
        if (cancelled) return
        const linked = data.channels.filter(channel => channel.linked)
        setChannelsSummary(linked.map(channel => channel.title).join(', '))
      })
      .catch(() => {
        if (!cancelled) setChannelsSummary('')
      })

    return () => {
      cancelled = true
    }
  }, [channelsOpen])

  const changeDeliveryMode = async nextMode => {
    if (!nextMode || nextMode === deliveryMode || prefsSaving) return
    const previous = preferences
    setPreferences({ ...previous, deliveryMode: nextMode })
    setPrefsSaving('delivery')
    setPrefsStatus(null)

    try {
      const result = await saveNotificationPreferences({ deliveryMode: nextMode }, previous)
      if (result.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      setPreferences(result.preferences)
      if (result.ok) {
        setPrefsStatus({
          tone: 'success',
          text: nextMode === DELIVERY_MODE_DIGEST
            ? 'Готово: одна сводка вместо сообщений по каждому растению.'
            : 'Готово: отдельные напоминания по каждому растению.'
        })
        return
      }
      setPrefsStatus({
        tone: 'warning',
        text: 'Режим сохранён на этом устройстве — сервер настроек ещё не обновлён.'
      })
    } catch (saveError) {
      console.warn('Не удалось сохранить режим уведомлений:', saveError)
      setPreferences(previous)
      setPrefsStatus({ tone: 'error', text: 'Не удалось сохранить режим. Попробуйте ещё раз.' })
    } finally {
      setPrefsSaving('')
    }
  }

  const saveQuietHours = async next => {
    const validation = validateQuietHours(next)
    if (validation) return { tone: 'error', text: validation }

    const previous = preferences
    setPrefsSaving('quiet')

    try {
      const result = await saveNotificationPreferences({ quietHours: next }, previous)
      if (result.status === 401) {
        navigate('/login', { replace: true })
        return { tone: 'error', text: 'Нужно снова войти в аккаунт.' }
      }
      setPreferences(result.preferences)
      if (result.ok) {
        return {
          tone: 'success',
          text: next.enabled
            ? `Тихие часы включены: ${next.start}–${next.end}.`
            : 'Тихие часы выключены.'
        }
      }
      return {
        tone: 'warning',
        text: 'Сохранено на этом устройстве — сервер настроек ещё не обновлён.'
      }
    } catch (saveError) {
      console.warn('Не удалось сохранить тихие часы:', saveError)
      setPreferences(previous)
      return { tone: 'error', text: 'Не удалось сохранить тихие часы. Попробуйте ещё раз.' }
    } finally {
      setPrefsSaving('')
    }
  }

  const applyReadLocally = (item, serverUnread) => {
    const readAt = new Date().toISOString()
    setItems(current => current.map(entry => (
      entry.id === item.id && !entry.read_at ? { ...entry, read_at: readAt } : entry
    )))
    setUnreadCount(current => {
      const next = Number.isInteger(serverUnread) ? serverUnread : Math.max(0, current - 1)
      publishUnreadCount(next)
      return next
    })
    const feedCategory = feedCategoryFor(item)
    if (feedCategory) {
      setUnreadByCategory(current => ({
        ...current,
        all: Math.max(0, current.all - 1),
        [feedCategory]: Math.max(0, current[feedCategory] - 1)
      }))
    }
  }

  const markItemsReadSilently = async itemsToRead => {
    for (const item of itemsToRead) {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/notifications/${item.id}/read`,
          { method: 'PATCH', credentials: 'include' }
        )
        if (response.status === 401) return
        if (!response.ok) continue
        const data = await response.json().catch(() => ({}))
        applyReadLocally(item, data.unreadCount)
      } catch (readError) {
        console.warn('Не удалось отметить уведомление прочитанным:', readError)
      }
    }
  }

  const markWateredInRow = async section => {
    const plantId = section?.plantId
    const key = section?.key
    if (!plantId || !key || quickBusyKey) return

    setQuickBusyKey(key)
    setQuickStatuses(current => ({ ...current, [key]: null }))

    try {
      const result = await markWateredWithQueue(plantId)
      if (!result.ok) {
        const conflict = classifyWateringResponse(result.status) === 'conflict'
        setQuickStatuses(current => ({
          ...current,
          [key]: {
            tone: conflict ? 'info' : 'error',
            text: conflict
              ? 'Полив за эту дату уже отмечен.'
              : (result.data?.message || 'Не удалось отметить полив. Попробуйте ещё раз.')
          }
        }))
        return
      }

      trackEvent('watering_marked', { queued: Boolean(result.queued) })
      setQuickStatuses(current => ({
        ...current,
        [key]: {
          tone: 'success',
          text: result.queued
            ? 'Нет связи — сохранил отметку, отправим при восстановлении.'
            : 'Полив отмечен.'
        }
      }))

      const unreadItems = (section.items || []).filter(item => !item.read_at)
      if (unreadItems.length) await markItemsReadSilently(unreadItems)
    } catch (waterError) {
      console.warn('Не удалось отметить полив из уведомления:', waterError)
      setQuickStatuses(current => ({
        ...current,
        [key]: { tone: 'error', text: 'Не удалось отметить полив. Попробуйте ещё раз.' }
      }))
    } finally {
      setQuickBusyKey('')
    }
  }

  const markWateredItem = item => {
    const plantId = notificationPlantId(item)
    if (!plantId) return undefined
    return markWateredInRow({ key: `item-${item.id}`, plantId, items: [item] })
  }

  const loadPage = useCallback(async (offset, category = 'all') => {
    const response = await fetchWithTimeout(
      `${API_URL}/notifications?limit=${PAGE_SIZE}&offset=${offset}&status=all&category=${encodeURIComponent(category)}`,
      { method: 'GET', credentials: 'include' }
    )
    if (response.status === 401) {
      navigate('/login', { replace: true })
      return null
    }
    if (!response.ok) {
      throw new Error(`Не удалось загрузить уведомления: HTTP ${response.status}`)
    }
    const data = await response.json().catch(() => ({}))
    if (!Array.isArray(data.items)) {
      throw new Error('Сервер вернул некорректный список уведомлений')
    }
    const unreadCount = Number.isInteger(data.unreadCount) ? data.unreadCount : 0
    const categoryTotals = data.unreadByCategory && typeof data.unreadByCategory === 'object'
      ? data.unreadByCategory
      : {}
    const toCount = value => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0)

    return {
      items: data.items,
      nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null,
      unreadCount,
      unreadByCategory: {
        all: toCount(categoryTotals.all ?? unreadCount),
        watering: toCount(categoryTotals.watering),
        care: toCount(categoryTotals.care)
      }
    }
  }, [navigate])

  const loadInitial = useCallback(async category => {
    const requestId = feedRequestIdRef.current + 1
    feedRequestIdRef.current = requestId
    setIsLoading(true)
    setError('')
    try {
      const page = await loadPage(0, category)
      if (!page || requestId !== feedRequestIdRef.current) return
      setItems(page.items)
      setNextOffset(page.nextOffset)
      setUnreadCount(page.unreadCount)
      setUnreadByCategory(page.unreadByCategory)
    } catch (loadError) {
      if (requestId !== feedRequestIdRef.current) return
      console.error('Ошибка загрузки уведомлений:', loadError)
      setError('Не удалось загрузить уведомления. Проверьте подключение и попробуйте ещё раз.')
    } finally {
      if (requestId === feedRequestIdRef.current) setIsLoading(false)
    }
  }, [loadPage])

  useEffect(() => {
    activeFilterRef.current = filter
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await loadInitial(filter)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [filter, loadInitial])

  const refreshFirstPage = useCallback(async () => {
    const category = filter
    try {
      const page = await loadPage(0, category)
      if (!page || category !== activeFilterRef.current) return
      setItems(current => {
        const freshIds = new Set(page.items.map(item => item.id))
        return [...page.items, ...current.filter(item => !freshIds.has(item.id))]
      })
      setUnreadCount(page.unreadCount)
      setUnreadByCategory(page.unreadByCategory)
    } catch (refreshError) {
      console.warn('Не удалось обновить уведомления:', refreshError)
    }
  }, [filter, loadPage])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const timestamp = Date.now()
      if (timestamp - lastSyncRef.current < 5000) return
      lastSyncRef.current = timestamp
      void refreshFirstPage()
    }

    const stop = subscribeToNotificationChanges(refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      stop()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshFirstPage])

  const pushNotice = useMemo(() => {
    if (!canUsePush()) {
      return {
        tone: 'warning',
        title: 'Уведомления недоступны в этом браузере',
        text: 'Push-уведомления здесь не поддерживаются. Напоминания будут видны только на этом экране.'
      }
    }
    if (isIOS() && !isStandalone()) {
      return {
        tone: 'warning',
        title: 'Установите приложение',
        text: 'На iPhone уведомления приходят только в приложении, добавленном на экран «Домой».'
      }
    }
    if (permission === 'denied') {
      return {
        tone: 'warning',
        title: 'Уведомления отключены',
        text: isIOS()
          ? 'Откройте «Настройки» → «Уведомления» → «Лейка» и разрешите уведомления. Затем вернитесь и нажмите «Проверить снова».'
          : 'Нажмите на значок замка или «Настройки сайта» в адресной строке, разрешите уведомления для этого сайта и нажмите «Проверить снова».',
        action: 'recheck'
      }
    }
    if (permission !== 'granted') {
      return {
        tone: 'info',
        title: 'Включите уведомления',
        text: 'Разрешите push-уведомления, чтобы не пропускать полив растений.',
        action: true
      }
    }
    if (!isStandalone()) {
      return {
        tone: 'info',
        title: isMobileDevice()
          ? 'Добавьте приложение на главный экран'
          : 'Установите приложение',
        text: 'В установленном приложении уведомления приходят стабильнее, даже когда браузер закрыт.'
      }
    }
    return null
  }, [permission])

  const groups = useMemo(() => {
    const today = []
    const earlier = []

    for (const item of items) {
      if (diffInDays(item.created_at, new Date()) === 0) {
        today.push(item)
      } else {
        earlier.push(item)
      }
    }

    const unreadToday = today.filter(item => !item.read_at).length
    const result = []

    if (today.length) {
      result.push({
        id: 'today',
        title: 'Сегодня',
        meta: unreadToday ? `${unreadToday} ${newWord(unreadToday)}` : '',
        items: today
      })
    }

    if (earlier.length) {
      const oldest = earlier[earlier.length - 1]
      const age = Math.abs(diffInDays(oldest.created_at, new Date()))
      result.push({
        id: 'earlier',
        title: 'Ранее',
        meta: age <= 7 ? 'На этой неделе' : 'Ранее',
        items: earlier
      })
    }

    return result
  }, [items])

  const loadMore = async () => {
    if (nextOffset === null || isLoadingMore) return
    const category = filter
    setIsLoadingMore(true)
    setError('')
    try {
      const page = await loadPage(nextOffset, category)
      if (!page || category !== activeFilterRef.current) return
      setItems(current => [
        ...current,
        ...page.items.filter(item => !current.some(existing => existing.id === item.id))
      ])
      setNextOffset(page.nextOffset)
      setUnreadCount(page.unreadCount)
      setUnreadByCategory(page.unreadByCategory)
    } catch (loadError) {
      console.error('Ошибка загрузки уведомлений:', loadError)
      setError('Не удалось загрузить уведомления. Попробуйте ещё раз.')
    } finally {
      setIsLoadingMore(false)
    }
  }

  const markAllRead = async () => {
    if (isMarkingAll || unreadCount === 0) return
    setIsMarkingAll(true)
    setError('')
    try {
      const response = await fetchWithTimeout(`${API_URL}/notifications/read-all`, {
        method: 'PATCH',
        credentials: 'include'
      })
      if (response.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json().catch(() => ({}))
      const readAt = new Date().toISOString()
      setItems(current => current.map(item =>
        item.read_at ? item : { ...item, read_at: readAt }
      ))
      const nextUnread = Number.isInteger(data.unreadCount) ? data.unreadCount : 0
      setUnreadCount(nextUnread)
      setUnreadByCategory({ all: 0, watering: 0, care: 0 })
      publishUnreadCount(nextUnread)
    } catch (markError) {
      console.error('Ошибка отметки уведомлений:', markError)
      setError('Не удалось отметить уведомления прочитанными. Попробуйте ещё раз.')
    } finally {
      setIsMarkingAll(false)
    }
  }

  const openNotification = async item => {
    if (!item) return

    if (!item.read_at) {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/notifications/${item.id}/read`,
          { method: 'PATCH', credentials: 'include' }
        )
        if (response.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (response.ok) {
          const data = await response.json().catch(() => ({}))
          const readAt = new Date().toISOString()
          setItems(current => current.map(entry =>
            entry.id === item.id ? { ...entry, read_at: readAt } : entry
          ))
          const nextUnread = Number.isInteger(data.unreadCount)
            ? data.unreadCount
            : Math.max(0, unreadCount - 1)
          setUnreadCount(nextUnread)
          const feedCategory = feedCategoryFor(item)
          if (feedCategory) {
            setUnreadByCategory(current => ({
              ...current,
              all: Math.max(0, current.all - 1),
              [feedCategory]: Math.max(0, current[feedCategory] - 1)
            }))
          }
          publishUnreadCount(nextUnread)
        }
      } catch (readError) {
        console.warn('Не удалось отметить уведомление прочитанным:', readError)
      }
    }

    setSelectedNotification(item)
  }

  useEffect(() => {
    if (!selectedNotification) return undefined

    const previouslyFocused = document.activeElement
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedNotification(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.querySelector('button')?.focus?.()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [selectedNotification])

  const closeNotificationDetail = () => setSelectedNotification(null)

  const openCareFromNotification = item => {
    setCareSheet({
      plantId: item?.plant_id ?? null,
      initialAction: careInitialActionFor(item),
      notificationId: item?.id ?? null
    })
    setSelectedNotification(null)
  }

  const goToPlantFromNotification = item => {
    setSelectedNotification(null)
    if (item?.plant_id !== null && item?.plant_id !== undefined) {
      navigate(`/my-plants?plant=${item.plant_id}`)
      return
    }
    navigate('/my-plants')
  }

  const subscribeAfterPermission = async () => {
    if (pushBusy) return
    setPushBusy(true)
    setPushError('')
    setPushSuccess('')
    try {
      await subscribeToPush()
      setPushDisabledOnThisDevice(false)
      setPushSuccess('Уведомления включены на этом устройстве.')
      setPermission('granted')
    } catch (pushFailure) {
      console.error('Не удалось включить уведомления:', pushFailure)
      setPushError(pushFailure.message || 'Не удалось включить уведомления. Попробуйте ещё раз.')
    } finally {
      setPushBusy(false)
    }
  }

  const enablePush = async () => {
    if (pushBusy) return
    setPushError('')
    setPushSuccess('')
    try {
      const granted = await requestPermission()
      const nextPermission = typeof Notification !== 'undefined'
        ? Notification.permission
        : 'default'
      setPermission(nextPermission)
      if (!granted) {
        setPushError('Разрешение не выдано. Включите уведомления в настройках браузера и нажмите «Проверить снова».')
        return
      }
      await subscribeAfterPermission()
    } catch (pushFailure) {
      console.error('Не удалось включить уведомления:', pushFailure)
      setPushError(pushFailure.message || 'Не удалось включить уведомления. Попробуйте ещё раз.')
    }
  }

  const recheckPermission = () => {
    setPushError('')
    setPushSuccess('')
    const current = typeof Notification !== 'undefined'
      ? Notification.permission
      : 'default'
    setPermission(current)
    if (current === 'granted') {
      void subscribeAfterPermission()
      return
    }
    setPushError('Разрешение всё ещё не выдано. Измените настройки сайта и нажмите «Проверить снова».')
  }

  const openBottomTab = tabId => {
    if (tabId === 'add') {
      navigate('/add-plant')
      return
    }
    navigate('/home', { state: { activeTab: tabId } })
  }

  const todayDigestSummary = useMemo(() => {
    if (deliveryMode !== DELIVERY_MODE_DIGEST) return ''
    const today = items.filter(item => diffInDays(item.created_at, new Date()) === 0)
    if (!today.length) return ''
    const sections = buildPlantSections(today, { plantNames, mode: 'digest' }).plants
    return buildDigestSummary(sections).text
  }, [items, plantNames, deliveryMode])

  const renderNotificationRow = item => {
    const category = categoryFor(item)
    const visual = visualFor(item)
    const actionLabel = actionLabelFor(item, category)
    const key = `item-${item.id}`
    const quickStatus = quickStatuses[key]
    const busy = quickBusyKey === key
    const canWater = Boolean(notificationPlantId(item)) &&
      isWateringNotification(item) &&
      !isWeeklyRecapNotification(item)

    return (
      <li
        key={item.id}
        className={`notificationsCard${item.read_at ? '' : ' is-unread'}${canWater ? ' has-actions' : ''}`}
      >
        <button
          type='button'
          className='notificationsCardButton'
          onClick={() => openNotification(item)}
        >
          <span className={`notificationsIcon notificationsIcon--${category}`}>
            <img src={visual.icon} alt='' />
          </span>
          <span className='notificationsCardBody'>
            <span className='notificationsCardTop'>
              <span className='notificationsCardTitle'>{item.title}</span>
              {!item.read_at && (
                <span className='notificationsUnreadLabel'>
                  Новое
                  <span className='notificationsVisuallyHidden'>
                    {' '}(не прочитано)
                  </span>
                </span>
              )}
            </span>
            <span className='notificationsCardText'>{item.body}</span>
            <span className='notificationsCardFooter'>
              <span className='notificationsTime'>
                {formatCardTime(item.created_at)}
              </span>
              <span className={`notificationsAction notificationsAction--${category}`}>
                {actionLabel}
              </span>
            </span>
          </span>
        </button>
        {canWater && (
          <div className='notificationsCardActions'>
            <button
              type='button'
              className='notificationsQuickWater'
              onClick={() => markWateredItem(item)}
              disabled={Boolean(quickBusyKey)}
              aria-label={`Отметить полив: ${item.title}`}
            >
              {busy ? 'Отмечаю…' : 'Полил'}
            </button>
          </div>
        )}
        {quickStatus && (
          <p
            className={`notificationsQuickStatus notificationsQuickStatus--${quickStatus.tone}`}
            role={quickStatus.tone === 'error' ? 'alert' : 'status'}
          >
            {quickStatus.text}
          </p>
        )}
      </li>
    )
  }

  const renderPlantSection = section => {
    const digestRow = deliveryMode === DELIVERY_MODE_DIGEST && section.items.length > 1
    const quickStatus = quickStatuses[section.key]
    const busy = quickBusyKey === section.key
    const expanded = expandedDigestKey === section.key
    const canWater = section.wateringCount > 0 && Boolean(section.plantId)

    return (
      <div className='notificationsPlantGroup' key={section.key}>
        <div className='notificationsPlantHeader'>
          <h3>{section.plantName}</h3>
          <span className='notificationsPlantHeaderCount'>
            {section.items.length} {notificationWord(section.items.length)}
          </span>
        </div>

        {digestRow ? (
          <div className={`notificationsDigestCard${section.unreadCount ? ' is-unread' : ''}`}>
            <div className='notificationsDigestTop'>
              <button
                type='button'
                className='notificationsDigestButton'
                onClick={() => setSelectedNotification(section.latestItem)}
              >
                <span className='notificationsDigestTitle'>{digestTitleFor(section)}</span>
                <span className='notificationsDigestMeta'>
                  {formatCardTime(section.latestItem?.created_at)}
                </span>
              </button>
              <button
                type='button'
                className='notificationsDigestExpand'
                aria-expanded={expanded}
                aria-controls={`notificationsDigest-${section.key}`}
                onClick={() => setExpandedDigestKey(current => (
                  current === section.key ? '' : section.key
                ))}
              >
                {expanded ? 'Скрыть' : 'Показать'}
              </button>
            </div>

            {canWater && (
              <div className='notificationsCardActions'>
                <button
                  type='button'
                  className='notificationsQuickWater'
                  onClick={() => markWateredInRow(section)}
                  disabled={Boolean(quickBusyKey)}
                  aria-label={`Отметить полив: ${section.plantName}`}
                >
                  {busy ? 'Отмечаю…' : 'Полил'}
                </button>
              </div>
            )}

            {quickStatus && (
              <p
                className={`notificationsQuickStatus notificationsQuickStatus--${quickStatus.tone}`}
                role={quickStatus.tone === 'error' ? 'alert' : 'status'}
              >
                {quickStatus.text}
              </p>
            )}

            {expanded && (
              <ul
                className='notificationsDigestItems'
                id={`notificationsDigest-${section.key}`}
              >
                {section.items.map(item => (
                  <li key={item.id}>
                    <button
                      type='button'
                      className='notificationsDigestItem'
                      onClick={() => openNotification(item)}
                    >
                      <span className='notificationsDigestItemTitle'>{item.title}</span>
                      <span className='notificationsDigestItemMeta'>
                        {formatCardTime(item.created_at)}
                        {item.read_at ? '' : ' · новое'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className='notificationsList'>
            {section.items.map(item => renderNotificationRow(item))}
          </ul>
        )}
      </div>
    )
  }

  const renderMiscSection = section => (
    <div className='notificationsPlantGroup' key={section.key}>
      <div className='notificationsPlantHeader'>
        <h3>Прочее</h3>
        <span className='notificationsPlantHeaderCount'>
          {section.items.length} {notificationWord(section.items.length)}
        </span>
      </div>
      <ul className='notificationsList'>
        {section.items.map(item => renderNotificationRow(item))}
      </ul>
    </div>
  )

  const detailCategory = selectedNotification ? categoryFor(selectedNotification) : 'system'
  const detailMeta = selectedNotification
    ? visualFor(selectedNotification)
    : CATEGORIES[detailCategory]
  const detailRecapRows =
    selectedNotification && isWeeklyRecapNotification(selectedNotification)
      ? recapStatRows(selectedNotification)
      : []

  return (
    <main className='notificationsPage'>
      <header className='notificationsHeader'>
        <button
          type='button'
          className='notificationsBack'
          onClick={() => navigate('/home')}
          aria-label='Вернуться на главную'
        >
          <img src={BackBtn} alt='' />
        </button>
        <div className='notificationsHeaderText'>
          <h1>Уведомления</h1>
          <p>Центр уведомлений</p>
        </div>
        <button
          type='button'
          className='notificationsMarkAll'
          onClick={markAllRead}
          disabled={unreadCount === 0 || isMarkingAll || isLoading}
          aria-label='Отметить все уведомления прочитанными'
        >
          <img src={notificationCheck} alt='' />
        </button>
      </header>

      <NotificationSettingsBar
        deliveryMode={deliveryMode}
        onDeliveryModeChange={changeDeliveryMode}
        quietSummary={quietSummary}
        channelsSummary={channelsSummary}
        saving={prefsSaving === 'delivery'}
        status={prefsStatus}
        onOpenChannels={() => setChannelsOpen(true)}
        onOpenQuiet={() => setQuietOpen(true)}
      />

      {(pushNotice || pushError || pushSuccess) && (
        <section className={`notificationsPush${pushNotice?.tone === 'warning' ? ' is-warning' : ''}`}>
          <img src={notificationSystem} alt='' />
          <div className='notificationsPushContent'>
            {pushNotice && (
              <>
                <p className='notificationsPushTitle'>{pushNotice.title}</p>
                <p className='notificationsPushText'>{pushNotice.text}</p>
              </>
            )}
            {pushSuccess && <p className='notificationsPushText' role='status'>{pushSuccess}</p>}
            {pushError && <p className='notificationsPushError' role='alert'>{pushError}</p>}
            {pushNotice?.action === true && (
              <button
                type='button'
                className='notificationsPushAction'
                onClick={enablePush}
                disabled={pushBusy}
              >
                {pushBusy ? 'Включаем…' : 'Разрешить уведомления'}
              </button>
            )}
            {pushNotice?.action === 'recheck' && (
              <button
                type='button'
                className='notificationsPushAction'
                onClick={recheckPermission}
                disabled={pushBusy}
              >
                {pushBusy ? 'Проверяем…' : 'Проверить снова'}
              </button>
            )}
            {!pushNotice?.action && pushError && permission === 'granted' && (
              <button
                type='button'
                className='notificationsPushAction'
                onClick={subscribeAfterPermission}
                disabled={pushBusy}
              >
                {pushBusy ? 'Подключаем…' : 'Повторить подписку'}
              </button>
            )}
          </div>
        </section>
      )}

      <div className='notificationsFilters' role='tablist' aria-label='Фильтр уведомлений'>
        {FILTER_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={setFilterRef(tab.id)}
            type='button'
            role='tab'
            id={FILTER_TAB_ID(tab.id)}
            aria-selected={filter === tab.id}
            aria-controls={FILTER_PANEL_ID}
            tabIndex={filter === tab.id ? 0 : -1}
            className={filter === tab.id ? 'is-active' : ''}
            onClick={() => setFilter(tab.id)}
            onKeyDown={event => handleFilterKeyDown(event, index)}
          >
            {tab.label}
            {(tab.id === 'all' ? unreadCount : unreadByCategory[tab.id]) > 0 && (
              <span className='notificationsFilterCount'>
                {tab.id === 'all' ? unreadCount : unreadByCategory[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        className='notificationsPanel'
        id={FILTER_PANEL_ID}
        role='tabpanel'
        aria-labelledby={FILTER_TAB_ID(filter)}
      >
        {error && (
          <div className='notificationsError' role='alert'>
            <p>{error}</p>
            <button type='button' onClick={() => loadInitial(filter)}>Повторить</button>
          </div>
        )}

        {todayDigestSummary && !isLoading && (
          <p className='notificationsDigestSummary' role='status'>{todayDigestSummary}</p>
        )}

        {isLoading ? (
          <p className='notificationsStatus' role='status'>Загружаем уведомления…</p>
        ) : groups.length === 0 && !error ? (
          <div className='notificationsEmpty'>
            <p>{EMPTY_TEXTS[filter]}</p>
          </div>
        ) : (
          groups.map(group => {
            const layout = buildPlantSections(group.items, {
              plantNames,
              mode: deliveryMode
            })
            return (
              <section key={group.id} className='notificationsGroup'>
                <div className='notificationsGroupHeader'>
                  <h2>{group.title}</h2>
                  {group.meta && <span>{group.meta}</span>}
                </div>
                {layout.plants.map(section => renderPlantSection(section))}
                {layout.misc.map(section => renderMiscSection(section))}
              </section>
            )
          })
        )}

        {nextOffset !== null && !isLoading && (
          <button
            type='button'
            className='notificationsMore'
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Загружаем…' : 'Показать более ранние'}
          </button>
        )}
      </div>

      {selectedNotification && (
        <div
          className='notificationsDetailOverlay'
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeNotificationDetail()
          }}
        >
          <section
            className='notificationsDetail'
            ref={detailRef}
            role='dialog'
            aria-modal='true'
            aria-labelledby='notificationDetailTitle'
          >
            <header className='notificationsDetailHeader'>
              <span className={`notificationsIcon notificationsIcon--${detailCategory}`}>
                <img src={detailMeta.icon} alt='' />
              </span>
              <div className='notificationsDetailHeading'>
                <span className='notificationsDetailType'>{detailMeta.label}</span>
                <h2 id='notificationDetailTitle'>{selectedNotification.title}</h2>
              </div>
              <button
                type='button'
                className='notificationsDetailClose'
                onClick={closeNotificationDetail}
                aria-label='Закрыть'
              >
                ×
              </button>
            </header>

            <p className='notificationsDetailBody'>{selectedNotification.body}</p>
            <p className='notificationsDetailTime'>
              {formatCardTime(selectedNotification.created_at)}
            </p>

            {detailRecapRows.length > 0 && (
              <dl className='notificationsRecapStats'>
                {detailRecapRows.map(row => (
                  <div key={row.key} className='notificationsRecapStat'>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className='notificationsDetailActions'>
              {isWateringNotification(selectedNotification) && (
                <button
                  type='button'
                  className='notificationsDetailPrimary'
                  onClick={() => {
                    markWateredItem(selectedNotification)
                    closeNotificationDetail()
                  }}
                >
                  Полил
                </button>
              )}

              {isCareNotification(selectedNotification) && (
                <>
                  <button
                    type='button'
                    className='notificationsDetailPrimary'
                    onClick={() => openCareFromNotification(selectedNotification)}
                  >
                    Выполнено
                  </button>
                  {selectedNotification.plant_id !== null &&
                    selectedNotification.plant_id !== undefined && (
                      <button
                        type='button'
                        className='notificationsDetailSecondary'
                        onClick={() => goToPlantFromNotification(selectedNotification)}
                      >
                        К растению
                      </button>
                    )}
                </>
              )}

              {isWeeklyRecapNotification(selectedNotification) && (
                <button
                  type='button'
                  className='notificationsDetailPrimary'
                  onClick={() => {
                    closeNotificationDetail()
                    navigate('/home')
                  }}
                >
                  Смотреть на главной
                </button>
              )}

              {!isWateringNotification(selectedNotification) &&
                !isCareNotification(selectedNotification) &&
                !isWeeklyRecapNotification(selectedNotification) && (
                  <button
                    type='button'
                    className='notificationsDetailPrimary'
                    onClick={() => {
                      closeNotificationDetail()
                      navigate('/my-plants')
                    }}
                  >
                    К растениям
                  </button>
                )}

              <button
                type='button'
                className='notificationsDetailSecondary'
                onClick={closeNotificationDetail}
              >
                Закрыть
              </button>
            </div>
          </section>
        </div>
      )}

      {channelsOpen && (
        <NotificationChannelsDialog onClose={() => setChannelsOpen(false)} />
      )}

      {quietOpen && (
        <NotificationQuietHoursDialog
          quietHours={quietHours}
          timezone={quietHours.timezone}
          saving={prefsSaving === 'quiet'}
          onSave={saveQuietHours}
          onClose={() => setQuietOpen(false)}
        />
      )}

      <CareActionSheet
        open={Boolean(careSheet)}
        plantId={careSheet?.plantId ?? null}
        initialAction={careSheet?.initialAction ?? 'fertilize'}
        notificationId={careSheet?.notificationId ?? null}
        onClose={() => setCareSheet(null)}
        onSaved={() => setCareSheet(null)}
      />

      <nav className='notificationsBottomNav' aria-label='Основная навигация'>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type='button'
            className='notificationsBottomTab'
            onClick={() => openBottomTab(tab.id)}
          >
            <img src={tab.icon} alt='' />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

export default Notifications
