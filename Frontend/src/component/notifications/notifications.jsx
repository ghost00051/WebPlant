import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackBtn from '../../assets/BackBtn.svg'
import notificationWater from '../../assets/notification-water.svg'
import notificationCare from '../../assets/notification-care.svg'
import notificationAdvice from '../../assets/notification-advice.svg'
import notificationSystem from '../../assets/notification-system.svg'
import notificationAlert from '../../assets/notification-alert.svg'
import notificationCheck from '../../assets/notification-check.svg'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { CARE_ACTION_CODES } from '../../utils/careEvents.js'
import { subscribeToNotificationChanges } from '../../utils/notificationSync.js'
import { publishUnreadCount } from '../../utils/appBadge.js'
import { diffInDays } from '../../utils/date.js'
import CareActionSheet from '../careActions/CareActionSheet.jsx'
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
  all: 'Пока нет уведомлений. Здесь появятся напоминания о поливе и утренние сводки.',
  watering: 'Пока нет уведомлений о поливе.',
  care: 'Пока нет уведомлений об уходе.'
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
  if (item?.type === 'care_reminder') return 'care'
  if (item?.type === 'care_tip') return 'advice'
  return 'system'
}

function feedCategoryFor (item) {
  if (item?.type === 'watering_due' || item?.type === 'watering_day_before' ||
    item?.type === 'morning_summary') {
    return 'watering'
  }
  if (item?.type === 'care_reminder' || item?.type === 'care_tip') return 'care'
  return null
}

function actionLabelFor (item, category) {
  if (item?.type === 'morning_summary') return 'Сводка'
  return CATEGORIES[category].label
}

function newWord (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'новое'
  return 'новых'
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
  const filterRefs = useRef(new Map())
  const detailRef = useRef(null)
  const lastSyncRef = useRef(0)
  const feedRequestIdRef = useRef(0)
  const activeFilterRef = useRef('all')

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

  const detailCategory = selectedNotification ? categoryFor(selectedNotification) : 'system'
  const detailMeta = CATEGORIES[detailCategory]

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

        {isLoading ? (
          <p className='notificationsStatus' role='status'>Загружаем уведомления…</p>
        ) : groups.length === 0 && !error ? (
          <div className='notificationsEmpty'>
            <p>{EMPTY_TEXTS[filter]}</p>
          </div>
        ) : (
          groups.map(group => (
            <section key={group.id} className='notificationsGroup'>
              <div className='notificationsGroupHeader'>
                <h2>{group.title}</h2>
                {group.meta && <span>{group.meta}</span>}
              </div>
              <ul className='notificationsList'>
                {group.items.map(item => {
                  const category = categoryFor(item)
                  const meta = CATEGORIES[category]
                  const actionLabel = actionLabelFor(item, category)

                  return (
                    <li
                      key={item.id}
                      className={`notificationsCard${item.read_at ? '' : ' is-unread'}`}
                    >
                      <button
                        type='button'
                        className='notificationsCardButton'
                        onClick={() => openNotification(item)}
                      >
                        <span className={`notificationsIcon notificationsIcon--${category}`}>
                          <img src={meta.icon} alt='' />
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
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
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

            <div className='notificationsDetailActions'>
              {isWateringNotification(selectedNotification) && (
                <button
                  type='button'
                  className='notificationsDetailPrimary'
                  onClick={() => {
                    closeNotificationDetail()
                    navigate('/home')
                  }}
                >
                  Полить
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

              {!isWateringNotification(selectedNotification) &&
                !isCareNotification(selectedNotification) && (
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
