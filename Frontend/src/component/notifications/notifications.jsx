import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { diffInDays } from '../../utils/date.js'
import { TABS } from '../tools/tabs.js'
import {
  isPushSupported,
  isIOS,
  isStandalone,
  requestPermission,
  subscribeToPush
} from '../../utils/pushNotifications.js'
import './notifications.css'
import './dark-theme.css'

const PAGE_SIZE = 20

const FILTER_TABS = [
  { id: 'all', label: 'Все' },
  { id: 'watering', label: 'Поливы' },
  { id: 'care', label: 'Уход' },
  { id: 'advice', label: 'Советы' }
]

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
  care: 'Пока нет уведомлений об уходе.',
  advice: 'Пока нет советов по уходу.'
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
  return 'system'
}

function actionLabelFor (item, category) {
  if (item?.type === 'morning_summary') return 'Сводка'
  return CATEGORIES[category].label
}

function matchesFilter (item, filter) {
  if (filter === 'all') return true
  const category = categoryFor(item)
  if (filter === 'watering') return category === 'watering' || category === 'alert'
  return category === filter
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

function readableUrl (value) {
  return typeof value === 'string' && value.startsWith('/') ? value : '/home'
}

function Notifications () {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
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

  const loadPage = useCallback(async offset => {
    const response = await fetchWithTimeout(
      `${API_URL}/notifications?limit=${PAGE_SIZE}&offset=${offset}&status=all`,
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
    return {
      items: data.items,
      nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null,
      unreadCount: Number.isInteger(data.unreadCount) ? data.unreadCount : 0
    }
  }, [navigate])

  const loadInitial = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const page = await loadPage(0)
      if (!page) return
      setItems(page.items)
      setNextOffset(page.nextOffset)
      setUnreadCount(page.unreadCount)
    } catch (loadError) {
      console.error('Ошибка загрузки уведомлений:', loadError)
      setError('Не удалось загрузить уведомления. Проверьте подключение и попробуйте ещё раз.')
    } finally {
      setIsLoading(false)
    }
  }, [loadPage])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await loadInitial()
    }
    run()
    return () => {
      cancelled = true
    }
  }, [loadInitial])

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
        text: 'Разрешите уведомления в настройках браузера для этого сайта — иначе напоминания не придут.'
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

  const visibleItems = useMemo(
    () => items.filter(item => matchesFilter(item, filter)),
    [filter, items]
  )

  const groups = useMemo(() => {
    const today = []
    const earlier = []

    for (const item of visibleItems) {
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
  }, [visibleItems])

  const loadMore = async () => {
    if (nextOffset === null || isLoadingMore) return
    setIsLoadingMore(true)
    setError('')
    try {
      const page = await loadPage(nextOffset)
      if (!page) return
      setItems(current => [
        ...current,
        ...page.items.filter(item => !current.some(existing => existing.id === item.id))
      ])
      setNextOffset(page.nextOffset)
      setUnreadCount(page.unreadCount)
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
      setUnreadCount(Number.isInteger(data.unreadCount) ? data.unreadCount : 0)
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
          if (Number.isInteger(data.unreadCount)) {
            setUnreadCount(data.unreadCount)
          } else {
            setUnreadCount(current => Math.max(0, current - 1))
          }
        }
      } catch (readError) {
        console.warn('Не удалось отметить уведомление прочитанным:', readError)
      }
    }

    navigate(readableUrl(item.url))
  }

  const enablePush = async () => {
    if (pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      const granted = await requestPermission()
      const nextPermission = typeof Notification !== 'undefined'
        ? Notification.permission
        : 'default'
      setPermission(nextPermission)
      if (!granted) {
        setPushError('Разрешение не выдано. Включите уведомления в настройках браузера.')
        return
      }
      await subscribeToPush()
    } catch (pushFailure) {
      console.error('Не удалось включить уведомления:', pushFailure)
      setPushError(pushFailure.message || 'Не удалось включить уведомления. Попробуйте ещё раз.')
    } finally {
      setPushBusy(false)
    }
  }

  const openBottomTab = tabId => {
    if (tabId === 'add') {
      navigate('/add-plant')
      return
    }
    navigate('/home', { state: { activeTab: tabId } })
  }

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

      {(pushNotice || pushError) && (
        <section className={`notificationsPush${pushNotice?.tone === 'warning' ? ' is-warning' : ''}`}>
          <img src={notificationSystem} alt='' />
          <div className='notificationsPushContent'>
            {pushNotice && (
              <>
                <p className='notificationsPushTitle'>{pushNotice.title}</p>
                <p className='notificationsPushText'>{pushNotice.text}</p>
              </>
            )}
            {pushError && <p className='notificationsPushError' role='alert'>{pushError}</p>}
            {pushNotice?.action && (
              <button
                type='button'
                className='notificationsPushAction'
                onClick={enablePush}
                disabled={pushBusy}
              >
                {pushBusy ? 'Включаем…' : 'Разрешить уведомления'}
              </button>
            )}
          </div>
        </section>
      )}

      <div className='notificationsFilters' role='tablist' aria-label='Фильтр уведомлений'>
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={filter === tab.id}
            className={filter === tab.id ? 'is-active' : ''}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className='notificationsError' role='alert'>
          <p>{error}</p>
          <button type='button' onClick={loadInitial}>Повторить</button>
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
                            <span className='notificationsUnread' aria-hidden='true' />
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
