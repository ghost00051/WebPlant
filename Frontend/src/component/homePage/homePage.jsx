import LogoMark from '../../assets/LogoMark.svg'
import Notification from '../../assets/NotifBtn.svg'
import MiniCalendar from '../MiniCalendar/MiniCalendar'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import check from '../../assets/check.svg'
import droplets from '../../assets/droplets.svg'
import VisionNextPlant from '../visionNextPlant/visionNextPlant'
import chevronleft from '../../assets/chevron-left.svg'
import IconTile from '../../assets/IconTile.svg'
import CalendarIcon from '../../assets/CalendarIcon.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import PlantPhoto from '../PlantPhoto/PlantPhoto'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { trackEvent } from '../../utils/productEvents.js'
import { subscribeToNotificationChanges } from '../../utils/notificationSync.js'
import { setAppBadgeCount } from '../../utils/appBadge.js'
import { DEFAULT_TIME_ZONE } from '../../utils/timeZone.js'
import { TAB_ELEMENT_ID, TAB_PANEL_ID } from '../tools/tabs.js'
import {
  buildDayView,
  dayOfMonth,
  diffInDays,
  monthGenitive,
  monthNominative,
  partitionScheduleDates,
  relativeDayLabel,
  toDate,
  toISODate,
  weekdayName
} from '../../utils/date.js'
import {
  missedWateringLabel,
  splitNeedWateringPlants
} from '../../utils/wateringNeeds.js'
import { isPushSupported } from '../../utils/pushNotifications.js'
import { PLANTS } from '../../data/plants.js'
import FirstPlantQuickAdd, {
  OnboardingChecklist
} from '../onboarding/onboarding.jsx'
import {
  buildQuickPlantPayload,
  clearFirstPlantPending,
  deriveOnboardingChecklist,
  describeCreatePlantError,
  parseIntervalDays,
  pickPopularPlants,
  readFirstPlantPending,
  saveFirstPlantPending
} from '../../utils/onboarding.js'
import { markWateredWithQueue } from '../../utils/offlineQueue.js'
import {
  careFutureMarkersFromSchedule,
  carePastMarkersFromTimeline
} from '../../utils/careEvents.js'

import './homePage.css'
import './homePage.desktop.css'
import './dark-theme.css'
import './notifications-button.css'

const EXIT_MS = 420
const POUR_ANIMATION_MS = 1200
const OFF_SCHEDULE_PREVIEW_COUNT = 3
const WATERING_NOTICE_TTL_MS = 8000

const POPULAR_PLANTS = pickPopularPlants(PLANTS)

const WATERING_TABS = [
  { id: 'today', label: 'Сегодня нужно полить' },
  { id: 'missed', label: 'Пропущенные поливы' }
]

const WATERING_TAB_ID = tabId => `homePageWateringTab-${tabId}`
const WATERING_PANEL_ID = 'homePageWateringPanel'

function plantWordForm (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'растение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return 'растения'
  return 'растений'
}

function plural (count, forms) {
  const value = Math.abs(Number(count))
  if (!Number.isFinite(value)) return forms[2]
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

const DAY_WORD_FORMS = ['день', 'дня', 'дней']

function pluralizeDays (count) {
  return plural(count, DAY_WORD_FORMS)
}

function wateringEveryLabel (intervalDays) {
  const value = Number(intervalDays)
  if (!Number.isInteger(value) || value < 1) return '—'
  if (value === 1) return 'Каждый день'
  return `Каждые ${value} ${pluralizeDays(value)}`
}

function wateringIntervalLabel (intervalDays) {
  const value = Number(intervalDays)
  if (!Number.isInteger(value) || value < 1) return '—'
  if (value === 1) return 'Раз в день'
  return `Раз в ${value} ${pluralizeDays(value)}`
}

function getZonedDateParts (date, timeZone) {
  const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date()
  const preferredTimeZone = timeZone || DEFAULT_TIME_ZONE

  const readParts = tz => {
    try {
      const parts = new Intl.DateTimeFormat('ru-RU', {
        timeZone: tz,
        hour: '2-digit',
        hourCycle: 'h23',
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }).formatToParts(safeDate)
      const values = {}
      for (const part of parts) {
        if (part.type !== 'literal') values[part.type] = part.value
      }
      const hours = Number(values.hour)
      if (!Number.isFinite(hours)) return null
      return {
        hours: hours % 24,
        day: values.day || String(safeDate.getDate()),
        month: values.month || '',
        weekday: values.weekday || ''
      }
    } catch {
      return null
    }
  }

  const zoned =
    readParts(preferredTimeZone) ||
    (preferredTimeZone !== DEFAULT_TIME_ZONE ? readParts(DEFAULT_TIME_ZONE) : null)
  if (zoned) return zoned

  console.warn('Не удалось определить дату в часовом поясе профиля, используется локальное время')
  return {
    hours: safeDate.getHours(),
    day: String(safeDate.getDate()),
    month: '',
    weekday: ''
  }
}

function getGreeting (hours) {
  if (!Number.isFinite(hours)) return 'Добрый день!'
  if (hours < 5) return 'Доброй ночи!'
  if (hours < 12) return 'Доброе утро!'
  if (hours < 18) return 'Добрый день!'
  return 'Добрый вечер!'
}

function badgeValue (count) {
  const value = Number(count) || 0
  if (value <= 0) return ''
  return value > 99 ? '99+' : String(value)
}

function readReminderState () {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  if (window.Notification.permission === 'granted') return 'granted'
  if (window.Notification.permission === 'denied') return 'denied'
  return isPushSupported() ? 'default' : 'unsupported'
}

function HomePage ({
  user,
  onTabChange,
  onCollectionSummary,
  onRequestPushPrompt
}) {
  const navigate = useNavigate()
  const [plant, setPlant] = useState([])
  const [allPlants, setAllPlants] = useState([])
  const [wateringId, setWateringId] = useState(null)
  const [deletingWateringId, setDeletingWateringId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [missedWateringId, setMissedWateringId] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [history, setHistory] = useState([])
  const [carePastTypes, setCarePastTypes] = useState(() => new Map())
  const [careFutureTypes, setCareFutureTypes] = useState(() => new Map())
  const [now, setNow] = useState(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [badgeText, setBadgeText] = useState('')
  const [offScheduleTarget, setOffScheduleTarget] = useState(null)
  const [pouringOffSchedule, setPouringOffSchedule] = useState(null)
  const [offScheduleExpanded, setOffScheduleExpanded] = useState(false)
  const [wateringTab, setWateringTab] = useState('today')
  const [creatingPlantSlug, setCreatingPlantSlug] = useState(null)
  const [onboardingError, setOnboardingError] = useState('')
  const [onboarding, setOnboarding] = useState(null)
  const [reminderState, setReminderState] = useState('default')
  const [wateringNotice, setWateringNotice] = useState('')

  const calendarRef = useRef(null)
  const wateringTabRefs = useRef(new Map())
  const pendingTimers = useRef(new Set())
  const currentDayRef = useRef(toISODate(new Date()))
  const lastRefreshAtRef = useRef(0)

  useEffect(
    () => () => {
      for (const timer of pendingTimers.current) clearTimeout(timer)
      pendingTimers.current.clear()
    },
    []
  )

  const scheduleTimeout = useCallback((callback, delay) => {
    const timer = setTimeout(() => {
      pendingTimers.current.delete(timer)
      callback()
    }, delay)
    pendingTimers.current.add(timer)
    return timer
  }, [])

  const setWateringTabRef = tabId => node => {
    if (node) {
      wateringTabRefs.current.set(tabId, node)
    } else {
      wateringTabRefs.current.delete(tabId)
    }
  }

  const handleWateringTabKeyDown = (event, index) => {
    let nextIndex = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = index + 1
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = index - 1
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = WATERING_TABS.length - 1
    }

    if (nextIndex === null) return

    event.preventDefault()
    const nextTab =
      WATERING_TABS[(nextIndex + WATERING_TABS.length) % WATERING_TABS.length]
    wateringTabRefs.current.get(nextTab.id)?.focus()
    setWateringTab(nextTab.id)
  }

  const scheduleMap = useMemo(() => {
    const map = new Map()
    for (const item of schedule) map.set(item.date, item.plants ?? [])
    return map
  }, [schedule])

  const historyMap = useMemo(() => {
    const map = new Map()
    for (const item of history) {
      map.set(item.date, item)
    }
    return map
  }, [history])

  const pastDatesSet = useMemo(
    () => new Set(history.filter(item => item.hasWatering).map(item => item.date)),
    [history]
  )

  const { planned: plannedDates, missed: missedScheduleDates } = useMemo(
    () => partitionScheduleDates(schedule, now),
    [schedule, now]
  )

  const overdueDatesSet = useMemo(() => {
    const set = new Set(missedScheduleDates)
    for (const item of history) {
      if (item.hasOverdue) set.add(item.date)
    }
    return set
  }, [history, missedScheduleDates])

  const getWateringPlant = useCallback(async () => {
    const response = await fetchWithTimeout(`${API_URL}/plants/need-watering`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(
        `Не удалось загрузить список полива: HTTP ${response.status}`
      )
    }
    const data = await response.json()
    if (!Array.isArray(data))
      throw new Error('Сервер вернул некорректный список полива')
    setPlant(data)
  }, [])

  const getNotifications = useCallback(async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/notifications/unread-count`,
        {
          method: 'GET',
          credentials: 'include'
        }
      )
      if (response.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        throw new Error(
          `Не удалось определить кол-во непрочитанных уведомлений ${response.status}`
        )
      }
      const data = await response.json()
      if (Number.isInteger(data?.unreadCount)) {
        setBadgeText(data)
        setAppBadgeCount(data.unreadCount)
      }
    } catch (error) {
      console.warn('Не удалось загрузить уведомления:', error)
    }
  }, [navigate])

  const getAllPlants = useCallback(async () => {
    const response = await fetchWithTimeout(`${API_URL}/plants`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(`Не удалось загрузить растения: HTTP ${response.status}`)
    }
    const data = await response.json()
    if (!Array.isArray(data))
      throw new Error('Сервер вернул некорректный список растений')
    setAllPlants(data)
  }, [])

  const getPlantSchedule = useCallback(async () => {
    const response = await fetchWithTimeout(`${API_URL}/plants/schedule`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(
        `Не удалось загрузить расписание: HTTP ${response.status}`
      )
    }
    const data = await response.json()
    if (!Array.isArray(data.items))
      throw new Error('Сервер вернул некорректное расписание')
    setSchedule(data.items)
  }, [])

  const getPlantHistory = useCallback(async () => {
    const response = await fetchWithTimeout(`${API_URL}/plants/timeline`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(
        `Не удалось загрузить историю полива: HTTP ${response.status}`
      )
    }
    const data = await response.json()
    if (!Array.isArray(data.items))
      throw new Error('Сервер вернул некорректную историю полива')
    const normalized = data.items.map(item => {
      const events = Array.isArray(item.events) ? item.events : []
      const hasOverdue = events.some(
        e => e.kind === 'overdue' || e.kind === 'skipped'
      )
      const hasWatered = events.some(e => e.kind === 'watered')
      const hasWatering = events.some(e => e.kind !== 'care')
      return {
        date: item.date,
        events,
        hasOverdue,
        hasWatered,
        hasWatering
      }
    })

    setHistory(normalized)
    setCarePastTypes(carePastMarkersFromTimeline(data.items))
  }, [])

  const getCareSchedule = useCallback(async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/care-schedule?days=90`,
        {
          method: 'GET',
          credentials: 'include'
        }
      )
      if (!response.ok) {
        throw new Error(
          `Не удалось загрузить расписание ухода: HTTP ${response.status}`
        )
      }
      const data = await response.json()
      if (!Array.isArray(data.items)) {
        throw new Error('Сервер вернул некорректное расписание ухода')
      }
      setCareFutureTypes(careFutureMarkersFromSchedule(data.items))
    } catch (error) {
      console.warn('Не удалось загрузить расписание ухода:', error)
    }
  }, [])

  const loadHomeData = useCallback(
    async ({ showLoading = false } = {}) => {
      setDataError('')
      if (showLoading) setIsLoading(true)

      const results = await Promise.allSettled([
        getWateringPlant(),
        getAllPlants(),
        getPlantSchedule(),
        getPlantHistory(),
        getCareSchedule()
      ])
      const errors = results
        .slice(0, -1)
        .filter(result => result.status === 'rejected')
        .map(result => result.reason)

      if (errors.length) {
        errors.forEach(error =>
          console.error('Ошибка загрузки главного экрана:', error)
        )
        setDataError(
          'Не удалось загрузить часть данных. Проверьте подключение и попробуйте ещё раз.'
        )
      } else {
        setDataError('')
      }
      setIsLoading(false)
    },
    [
      getWateringPlant,
      getAllPlants,
      getPlantSchedule,
      getPlantHistory,
      getCareSchedule
    ]
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHomeData()
    getNotifications()
  }, [loadHomeData, getNotifications])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(
    () =>
      subscribeToNotificationChanges(() => {
        void getNotifications()
      }),
    [getNotifications]
  )

  useEffect(() => {
    const refreshReminderState = () => setReminderState(readReminderState())

    refreshReminderState()
    window.addEventListener('focus', refreshReminderState)
    document.addEventListener('visibilitychange', refreshReminderState)

    return () => {
      window.removeEventListener('focus', refreshReminderState)
      document.removeEventListener('visibilitychange', refreshReminderState)
    }
  }, [])

  useEffect(() => {
    const refresh = ({ force = false } = {}) => {
      const current = new Date()
      setNow(current)
      const dayKey = toISODate(current)
      const dayChanged = dayKey !== currentDayRef.current
      if (!dayChanged && !force) return
      currentDayRef.current = dayKey
      const timestamp = Date.now()
      if (timestamp - lastRefreshAtRef.current < 5000) return
      lastRefreshAtRef.current = timestamp
      void loadHomeData()
      void getNotifications()
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh({ force: true })
    }
    const handleFocus = () => refresh({ force: true })
    const handleOnline = () => refresh({ force: true })

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    const dayTimer = setInterval(() => refresh(), 60_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      clearInterval(dayTimer)
    }
  }, [getNotifications, loadHomeData])

  useEffect(() => {
    if (!offScheduleTarget) return undefined

    const handleKeyDown = event => {
      if (event.key === 'Escape') setOffScheduleTarget(null)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [offScheduleTarget])

  const showWateringNotice = useCallback(
    message => {
      setWateringNotice(message)
      scheduleTimeout(() => {
        setWateringNotice(current => (current === message ? '' : current))
      }, WATERING_NOTICE_TTL_MS)
    },
    [scheduleTimeout]
  )

  const collectionSummary = useMemo(
    () => ({
      plantCount: allPlants.length,
      hasWatering:
        history.some(item => item.hasWatered) ||
        Boolean(onboarding?.firstWateringDone)
    }),
    [allPlants, history, onboarding]
  )

  useEffect(() => {
    onCollectionSummary?.(collectionSummary)
  }, [onCollectionSummary, collectionSummary])

  useEffect(() => {
    if (onboarding || isLoading || allPlants.length === 0) return

    const pending = readFirstPlantPending()
    if (!pending) return

    const existing = allPlants.find(item => item.id === pending.id)
    if (!existing || existing.last_watered_at) {
      clearFirstPlantPending()
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnboarding({
      plant: {
        id: existing.id,
        name: existing.name || pending.name,
        intervalDays: parseIntervalDays(existing.watering_interval_days),
        image: ''
      },
      firstWateringDone: false,
      dismissed: false
    })
  }, [allPlants, isLoading, onboarding])

  const createFirstPlant = async popularPlant => {
    if (creatingPlantSlug || !popularPlant?.name) return

    const payload = buildQuickPlantPayload(popularPlant)
    if (!payload) {
      setOnboardingError('Не удалось подготовить данные растения. Попробуйте другое.')
      return
    }

    setCreatingPlantSlug(popularPlant.slug)
    setOnboardingError('')
    setWateringNotice('')

    try {
      const response = await fetchWithTimeout(`${API_URL}/plants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(describeCreatePlantError({ status: response.status, data }))
      }
      if (!data || !data.id) {
        throw new Error('Сервер не вернул созданное растение. Обновите страницу.')
      }

      trackEvent('plant_created', {
        source: 'onboarding_quick_add',
        hasSpecies: Boolean(payload.species),
        intervalDays: payload.watering_interval_days
      })

      const createdName = data.name || payload.name
      setOnboarding({
        plant: {
          id: data.id,
          name: createdName,
          intervalDays: payload.watering_interval_days,
          image: popularPlant.image || ''
        },
        firstWateringDone: false,
        dismissed: false
      })
      setWateringTab('today')
      saveFirstPlantPending({
        id: data.id,
        name: createdName,
        intervalDays: payload.watering_interval_days
      })
      showWateringNotice(
        `«${createdName}» добавлено. Отметьте первый полив в блоке «Сегодня».`
      )
      await loadHomeData()
    } catch (error) {
      console.error('Ошибка добавления первого растения:', error)
      const rawMessage = typeof error?.message === 'string' ? error.message : ''
      const isNetworkError =
        /failed to fetch|load failed|network|timeout|aborted|превышено/i.test(
          rawMessage
        )
      setOnboardingError(
        isNetworkError
          ? 'Нет сети. Проверьте подключение и попробуйте снова.'
          : rawMessage || 'Не удалось добавить растение. Попробуйте ещё раз.'
      )
    } finally {
      setCreatingPlantSlug(null)
    }
  }

  const markFirstWatering = async () => {
    const firstPlant = onboarding?.plant
    if (!firstPlant || onboarding.firstWateringDone || wateringId) return

    const plantId = firstPlant.id
    setWateringId(plantId)

    try {
      const result = await markWateredWithQueue(plantId)
      const alreadyWatered = result?.status === 409

      if (!alreadyWatered && (!result || !result.ok)) {
        throw new Error(
          result?.data?.message ||
            'Не удалось отметить полив. Попробуйте ещё раз.'
        )
      }

      trackEvent('watering_marked', { onTime: true })
      clearFirstPlantPending()

      if (!alreadyWatered && result.queued) {
        showWateringNotice(
          'Нет сети — отметка сохранена и отправится автоматически'
        )
        setPlant(prev => prev.filter(item => item.id !== plantId))
      } else {
        showWateringNotice(
          alreadyWatered
            ? 'Полив уже отмечен — шаг засчитан.'
            : 'Первый полив отмечен. Дальше подскажем, когда полить снова.'
        )
        setRemovingId(plantId)
        scheduleTimeout(() => {
          setPlant(prev => prev.filter(item => item.id !== plantId))
          setRemovingId(null)
        }, EXIT_MS)
        if (!alreadyWatered) await loadHomeData()
      }

      setOnboarding(current =>
        current && current.plant.id === plantId
          ? { ...current, firstWateringDone: true }
          : current
      )
    } catch (error) {
      console.error('Ошибка отметки первого полива:', error)
      setDataError(
        error.message || 'Не удалось отметить полив. Попробуйте ещё раз.'
      )
    } finally {
      setWateringId(null)
    }
  }

  const handleChecklistAction = type => {
    if (type === 'mark-watering') {
      void markFirstWatering()
      return
    }
    if (type === 'enable-reminders') {
      const requested = onRequestPushPrompt?.()
      if (requested) {
        showWateringNotice(
          'Разрешите уведомления в появившемся окне — напомним о поливе.'
        )
      } else {
        showWateringNotice(
          'Уведомления можно включить позже в настройках профиля.'
        )
      }
    }
  }

  const dismissOnboardingChecklist = () => {
    setOnboarding(current =>
      current ? { ...current, dismissed: true } : current
    )
  }

  const onboardingChecklist = useMemo(() => {
    if (!onboarding) return null
    return deriveOnboardingChecklist({
      plantName: onboarding.plant.name,
      reminderState,
      hasWatered: onboarding.firstWateringDone
    })
  }, [onboarding, reminderState])

  const waterPlant = async (plantId, { onTime = true } = {}) => {
    if (!plantId || wateringId) return
    setWateringId(plantId)

    try {
      const result = await markWateredWithQueue(plantId)

      if (!result || !result.ok) {
        throw new Error(
          result?.data?.message ||
            'Не удалось отметить полив. Попробуйте ещё раз.'
        )
      }

      trackEvent('watering_marked', { onTime })

      if (result.queued) {
        showWateringNotice(
          'Нет сети — отметка сохранена и отправится автоматически'
        )
        setPlant(prev => prev.filter(p => p.id !== plantId))
        setWateringId(null)
        return
      }

      setRemovingId(plantId)

      scheduleTimeout(() => {
        setPlant(prev => prev.filter(p => p.id !== plantId))
        setRemovingId(null)
        setWateringId(null)
      }, EXIT_MS)

      loadHomeData()
    } catch (error) {
      console.error('Ошибка полива:', error)
      setDataError(
        error.message || 'Не удалось отметить полив. Попробуйте ещё раз.'
      )
      setWateringId(null)
    }
  }

  const deleteWatering = async (plantId, logId) => {
    if (deletingWateringId) return false

    setDeletingWateringId(logId)
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/${plantId}/water/${logId}`,
        { method: 'DELETE', credentials: 'include' }
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.message ||
            `Не удалось удалить запись: HTTP ${response.status}`
        )
      }

      setSelectedDate(null)
      await loadHomeData()
      return true
    } catch (error) {
      console.error('Ошибка удаления записи о поливе:', error)
      setDataError(error.message || 'Не удалось удалить запись о поливе.')
      return false
    } finally {
      setDeletingWateringId(null)
    }
  }

  const deleteCareAction = async (plantId, logId) => {
    if (plantId === null || plantId === undefined) {
      return { ok: false, message: '' }
    }
    if (logId === null || logId === undefined) {
      return { ok: false, message: '' }
    }

    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/${plantId}/care-actions/${logId}`,
        { method: 'DELETE', credentials: 'include' }
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.message ||
            `Не удалось отменить действие ухода: HTTP ${response.status}`
        )
      }

      await loadHomeData()
      return { ok: true, message: '' }
    } catch (error) {
      console.error('Ошибка отмены действия ухода:', error)
      return {
        ok: false,
        message:
          error.message || 'Не удалось отменить действие ухода. Попробуйте ещё раз.'
      }
    }
  }

  const waterMissedPlant = async (plantId, scheduledFor) => {
    if (!plantId || missedWateringId) {
      return { ok: false, message: '' }
    }

    setMissedWateringId(plantId)
    let alreadyWatered = false
    try {
      const result = await markWateredWithQueue(plantId, { scheduledFor })
      alreadyWatered = result?.status === 409

      if (!alreadyWatered && (!result || !result.ok)) {
        throw new Error(
          result?.data?.message ||
            'Не удалось отметить полив. Попробуйте ещё раз.'
        )
      }

      trackEvent('watering_marked', { onTime: false })

      if (!alreadyWatered && result.queued) {
        showWateringNotice(
          'Нет сети — отметка сохранена и отправится автоматически'
        )
        return { ok: true, convertedSkip: false }
      }

      await loadHomeData()
      return {
        ok: true,
        convertedSkip: Boolean(result?.data?.converted_skip)
      }
    } catch (error) {
      console.error('Ошибка отметки просроченного полива:', error)
      if (alreadyWatered) await loadHomeData()
      return {
        ok: false,
        message:
          error.message || 'Не удалось отметить полив. Попробуйте ещё раз.'
      }
    } finally {
      setMissedWateringId(null)
    }
  }

  const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1)
  const timeZone = user?.timezone || DEFAULT_TIME_ZONE
  const zonedNow = useMemo(() => getZonedDateParts(now, timeZone), [now, timeZone])
  const greeting = getGreeting(zonedNow.hours)
  const todayLabel = `Сегодня, ${zonedNow.day} ${zonedNow.month}`.trim()
  const displayName = user?.name || user?.username || 'садовод'

  const allPlantsMap = useMemo(() => {
    const map = new Map()
    for (const p of allPlants) map.set(p.id, p)
    return map
  }, [allPlants])

  const { today: todayPlants, missed: missedPlants } = useMemo(
    () => splitNeedWateringPlants(plant, { now, timeZone }),
    [plant, now, timeZone]
  )

  const missedCount = missedPlants.length
  const needWateringUnavailable =
    Boolean(dataError) && plant.length === 0 && allPlants.length === 0
  const collectionEmpty = plant.length === 0 && allPlants.length === 0

  const firstPlantId = onboarding?.plant?.id ?? null
  const firstPlantIsDueToday =
    firstPlantId !== null &&
    (todayPlants.some(item => item.id === firstPlantId) ||
      missedPlants.some(entry => entry.plant?.id === firstPlantId))

  const buildDay = useCallback(
    date => {
      const target = toDate(date)
      const relative = relativeDayLabel(target)
      const iso = toISODate(target)
      const futurePlants = scheduleMap.get(iso) ?? []
      const pastItem = historyMap.get(iso) ?? null
      const pastEvents = pastItem?.events ?? []
      const careEvents = pastEvents.filter(event => event?.kind === 'care')
      const wateringEvents = pastEvents.filter(event => event?.kind !== 'care')

      const view = buildDayView({
        date: target,
        now,
        plannedPlants: futurePlants,
        events: wateringEvents
      })

      const events = careEvents.length
        ? [...view.events, ...careEvents]
        : view.events
      const kind =
        view.kind === 'empty' && events.length
          ? view.isPastDay
            ? 'past'
            : 'future'
          : view.kind

      return {
        date: target,
        diffDays: diffInDays(target, now),
        relative,
        iso,
        kind,
        plants: view.plants,
        events,
        futurePlants,
        pastEvents,
        hasOverdue: pastItem?.hasOverdue ?? false,
        hasWatered: pastItem?.hasWatered ?? false,
        dayNumber: String(dayOfMonth(target)),
        dayOfWeek: capitalize(weekdayName(target)),
        month: capitalize(monthNominative(target)),
        year: String(target.getFullYear()),
        full: `${capitalize(weekdayName(target))}, ${dayOfMonth(
          target
        )} ${monthGenitive(target)}`
      }
    },
    [scheduleMap, historyMap, now]
  )

  const selectedDay = useMemo(
    () => (selectedDate ? buildDay(selectedDate) : null),
    [selectedDate, buildDay]
  )

  const handleSelectDay = useCallback(date => {
    const target = toDate(date)
    setSelectedDate(prev =>
      prev && prev.getTime() === target.getTime() ? null : target
    )
  }, [])

  const nextWatering = useMemo(() => {
    if (!selectedDay) return null
    const fromIso = selectedDay.iso

    const upcoming = schedule
      .filter(
        item =>
          item.date > fromIso &&
          item.plants?.length &&
          plannedDates.has(item.date)
      )
      .sort((a, b) => a.date.localeCompare(b.date))

    if (!upcoming.length) return null

    const nextDate = toDate(upcoming[0].date)
    return {
      iso: upcoming[0].date,
      label: `${dayOfMonth(nextDate)} ${monthGenitive(nextDate)}`
    }
  }, [schedule, selectedDay, plannedDates])

  const handleGoToDate = useCallback(iso => {
    calendarRef.current?.scrollTo(iso)
    setSelectedDate(toDate(iso))
  }, [])

  const offSchedulePlants = useMemo(() => {
    const sorted = [...schedule].sort((a, b) => a.date.localeCompare(b.date))
    const plannedByPlant = new Map()
    const anyByPlant = new Map()

    for (const day of sorted) {
      for (const plant of day.plants ?? []) {
        const isPlanned =
          typeof plant.is_missed === 'boolean'
            ? !plant.is_missed
            : plannedDates.has(day.date)

        if (!anyByPlant.has(plant.id)) {
          anyByPlant.set(plant.id, { ...plant, nextDate: day.date })
        }
        if (isPlanned && !plannedByPlant.has(plant.id)) {
          plannedByPlant.set(plant.id, { ...plant, nextDate: day.date })
        }
      }
    }

    const source = plannedByPlant.size ? plannedByPlant : anyByPlant

    return [...source.values()].sort((a, b) =>
      a.nextDate.localeCompare(b.nextDate)
    )
  }, [schedule, plannedDates])

  const visibleOffSchedulePlants = useMemo(() => {
    const base = offScheduleExpanded
      ? offSchedulePlants
      : offSchedulePlants.slice(0, OFF_SCHEDULE_PREVIEW_COUNT)

    if (
      pouringOffSchedule &&
      !base.some(plant => plant.id === pouringOffSchedule.id)
    ) {
      return [...base, pouringOffSchedule]
    }

    return base
  }, [offSchedulePlants, offScheduleExpanded, pouringOffSchedule])

  const hiddenOffScheduleCount = Math.max(
    0,
    offSchedulePlants.length - OFF_SCHEDULE_PREVIEW_COUNT
  )

  const openOffScheduleConfirm = plant => {
    if (!plant || pouringOffSchedule || wateringId) return
    setOffScheduleTarget(plant)
  }

  const closeOffScheduleConfirm = () => {
    setOffScheduleTarget(null)
  }

  const confirmOffScheduleWater = async () => {
    const target = offScheduleTarget
    if (!target || pouringOffSchedule) return

    setOffScheduleTarget(null)
    setPouringOffSchedule(target)

    const startedAt = Date.now()
    await waterPlant(target.id)

    const elapsed = Date.now() - startedAt
    if (elapsed < POUR_ANIMATION_MS) {
      await new Promise(resolve => {
        scheduleTimeout(resolve, POUR_ANIMATION_MS - elapsed)
      })
    }

    setPouringOffSchedule(null)
  }

  const renderWateringCard = (item, { overdue = false, daysLate = 0 } = {}) => {
    const fullInfo = allPlantsMap.get(item.id)
    const mainPhoto =
      fullInfo?.photos?.find(photo => photo.is_main)?.url ??
      fullInfo?.photos?.[0]?.url
    const isRemoving = removingId === item.id
    const isWatering = wateringId === item.id

    return (
      <div
        key={item.id}
        className={`plantRender ${isRemoving ? 'is-removing' : ''}`}
      >
        <Link
          to='/my-plants'
          className='description plantOpenLink'
          aria-label={`Открыть «${item.name}» в списке растений`}
        >
          {mainPhoto ? (
            <PlantPhoto src={mainPhoto} alt={item.name} />
          ) : (
            <div className='no-photo' />
          )}
          <div className='plant-info'>
            <p className='plant-name'>{item.name}</p>
            <div className='plant-details'>
              <span>{wateringEveryLabel(fullInfo?.watering_interval_days)}</span>
            </div>
            <div
              className={`watering-badge${
                overdue ? ' watering-badge--overdue' : ''
              }`}
            >
              <img src={droplets} alt='' />
              {overdue ? missedWateringLabel(daysLate) : 'Полить сегодня'}
            </div>
          </div>
        </Link>
        <button
          type='button'
          className={`check-button ${isWatering ? 'is-watering' : ''}`}
          onClick={() => waterPlant(item.id, { onTime: !overdue })}
          disabled={!!wateringId}
          aria-label={`Отметить, что «${item.name}» полит`}
        >
          <img src={check} alt='' />
          <span>Полить</span>
        </button>
      </div>
    )
  }

  const renderFirstWateringCard = () => {
    if (!onboarding || onboarding.firstWateringDone || firstPlantIsDueToday) {
      return null
    }

    const firstPlant = onboarding.plant
    const fullInfo = allPlantsMap.get(firstPlant.id)
    const mainPhoto =
      fullInfo?.photos?.find(photo => photo.is_main)?.url ??
      fullInfo?.photos?.[0]?.url
    const isWatering = wateringId === firstPlant.id
    const isRemoving = removingId === firstPlant.id

    return (
      <div
        key={`first-plant-${firstPlant.id}`}
        className={`plantRender plantRender--first ${
          isRemoving ? 'is-removing' : ''
        }`}
      >
        <Link
          to='/my-plants'
          className='description plantOpenLink'
          aria-label={`Открыть «${firstPlant.name}» в списке растений`}
        >
          {mainPhoto ? (
            <PlantPhoto src={mainPhoto} alt={firstPlant.name} />
          ) : (
            <div className='no-photo' />
          )}
          <div className='plant-info'>
            <p className='plant-name'>{firstPlant.name}</p>
            <div className='plant-details'>
              <span>{wateringEveryLabel(firstPlant.intervalDays)}</span>
            </div>
            <div className='watering-badge watering-badge--first'>
              <img src={droplets} alt='' />
              Первый полив — отметьте, что полили
            </div>
          </div>
        </Link>
        <button
          type='button'
          className={`check-button check-button--first ${
            isWatering ? 'is-watering' : ''
          }`}
          onClick={markFirstWatering}
          disabled={!!wateringId}
          aria-busy={isWatering || undefined}
          aria-label={`Уже полил(а) «${firstPlant.name}»`}
        >
          <img src={check} alt='' />
          <span>Уже полил(а)</span>
        </button>
      </div>
    )
  }

  return (
    <div
      className='homePageDashboard'
      role='tabpanel'
      id={TAB_PANEL_ID('home')}
      aria-labelledby={TAB_ELEMENT_ID('home')}
    >
      <div className='headerOfHOmePagw'>
        <div className='nameHeaderOfHomePage'>
          <img src={LogoMark} alt='' />
          <p>{greeting}</p>
          <h1 className='homePageMobileTitle'>Мои растения</h1>
          {allPlants.length > 0 && (
            <Link to='/my-plants' className='homePageAllPlantsLink'>
              Все растения ({allPlants.length})
            </Link>
          )}
        </div>
        <div
          className='notificationsButtonWrap'
          data-badge={badgeValue(badgeText.unreadCount)}
        >
          <button
            type='button'
            className='notificationsTrigger'
            onClick={() => navigate('/notifications')}
            aria-label={badgeValue(badgeText.unreadCount)
              ? `Уведомления, непрочитанных: ${badgeValue(badgeText.unreadCount)}`
              : 'Уведомления'}
          >
            <ThemedIcon src={Notification} alt='' />
          </button>
        </div>
      </div>
      <div className='desktopDashboardHeader'>
        <div>
          <h1>Мои растения</h1>
          <p>
            {greeting.replace('!', '')}, {displayName}
          </p>
        </div>
        <div className='desktopHeaderActions'>
          {allPlants.length > 0 && (
            <Link to='/my-plants' className='desktopAllPlantsLink'>
              Все растения ({allPlants.length})
            </Link>
          )}
          <span className='desktopDateBadge'>
            <img src={CalendarIcon} alt='' />
            {todayLabel}
          </span>
          <button
            type='button'
            className='desktopNotificationsButton'
            onClick={() => navigate('/notifications')}
            aria-label={badgeValue(badgeText.unreadCount)
              ? `Уведомления, непрочитанных: ${badgeValue(badgeText.unreadCount)}`
              : 'Уведомления'}
          >
            <ThemedIcon src={Notification} alt='' />
            {badgeValue(badgeText.unreadCount) && (
              <span className='desktopNotificationsBadge'>
                {badgeValue(badgeText.unreadCount)}
              </span>
            )}
          </button>
        </div>
      </div>
      <div className='homePageGrid'>
        <MiniCalendar
          ref={calendarRef}
          onSelectDay={handleSelectDay}
          futureDates={plannedDates}
          pastDates={pastDatesSet}
          overdueDates={overdueDatesSet}
          externalIso={selectedDay?.iso}
          carePastTypes={carePastTypes}
          careFutureTypes={careFutureTypes}
        />
        <section className='homePageWatering'>
          {onboarding && !onboarding.dismissed && onboardingChecklist && (
            <OnboardingChecklist
              checklist={onboardingChecklist}
              onAction={handleChecklistAction}
              onDismiss={dismissOnboardingChecklist}
            />
          )}
          {wateringNotice && (
            <p className='homePageNotice' role='status'>
              <span>{wateringNotice}</span>
              <button
                type='button'
                className='homePageNoticeDismiss'
                onClick={() => setWateringNotice('')}
                aria-label='Скрыть сообщение'
              >
                <span aria-hidden='true'>×</span>
              </button>
            </p>
          )}
          <div
            className='wateringTabs'
            role='tablist'
            aria-label='Полив растений'
          >
            <span
              className={`wateringTabsIndicator${
                wateringTab === 'missed' ? ' is-missed' : ''
              }`}
              aria-hidden='true'
            />
            {WATERING_TABS.map((tab, index) => {
              const isActive = wateringTab === tab.id
              const isMissed = tab.id === 'missed'

              return (
                <button
                  key={tab.id}
                  ref={setWateringTabRef(tab.id)}
                  type='button'
                  role='tab'
                  id={WATERING_TAB_ID(tab.id)}
                  aria-selected={isActive}
                  aria-controls={WATERING_PANEL_ID}
                  aria-label={
                    isMissed
                      ? `Пропущенные поливы, просрочено: ${missedCount}`
                      : undefined
                  }
                  tabIndex={isActive ? 0 : -1}
                  className={`wateringTab${
                    isMissed ? ' wateringTab--missed' : ''
                  }`}
                  onClick={() => setWateringTab(tab.id)}
                  onKeyDown={event => handleWateringTabKeyDown(event, index)}
                >
                  <span className='wateringTabLabel'>{tab.label}</span>
                  {isMissed && (
                    <span
                      className={`wateringTabBadge${
                        missedCount === 0 ? ' wateringTabBadge--empty' : ''
                      }`}
                      aria-hidden='true'
                    >
                      {missedCount > 99 ? '99+' : missedCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            className='wateringPanel'
            id={WATERING_PANEL_ID}
            role='tabpanel'
            aria-labelledby={WATERING_TAB_ID(wateringTab)}
          >
            {dataError && (
              <p className='homePageDataError' role='alert'>
                {dataError}
                <button
                  type='button'
                  onClick={() => {
                    loadHomeData({ showLoading: true })
                    getNotifications()
                  }}
                >
                  Повторить
                </button>
              </p>
            )}
            {isLoading ? (
              <p className='plant-empty' role='status'>
                Загружаем расписание…
              </p>
            ) : needWateringUnavailable ? null : collectionEmpty ? (
              <FirstPlantQuickAdd
                plants={POPULAR_PLANTS}
                creatingSlug={creatingPlantSlug}
                error={onboardingError}
                onCreate={createFirstPlant}
              />
            ) : (
              <div key={wateringTab} className='wateringPanelContent'>
                {wateringTab === 'today' ? (
                  <>
                    {renderFirstWateringCard()}
                    {todayPlants.length > 0 ? (
                      todayPlants.map(item => renderWateringCard(item))
                    ) : onboarding && !onboarding.firstWateringDone ? null : (
                      <p className='plant-empty'>На сегодня всё полито 💚</p>
                    )}
                  </>
                ) : missedCount > 0 ? (
                  <div
                    className='wateringMissedList'
                    role='group'
                    aria-label='Пропущенные поливы'
                  >
                    {missedPlants.map(({ plant: item, daysLate }) =>
                      renderWateringCard(item, { overdue: true, daysLate })
                    )}
                  </div>
                ) : (
                  <p className='plant-empty'>Просроченных поливов нет 💚</p>
                )}
              </div>
            )}
          </div>
        </section>
        <section className='offScheduleWatering'>
          <div className='descriptioOfoffScheduleWatering'>
            <ThemedIcon src={IconTile} alt='' />
            <div>
              <p>Полив вне графика</p>
              <p>Отметьте растение, которое полили раньше срока</p>
            </div>
            <ThemedIcon src={chevronleft} alt='' />
          </div>
          <div>
            {visibleOffSchedulePlants.length > 0 && (
              <div className='offScheduleList' id='offScheduleList'>
                {visibleOffSchedulePlants.map(plant => {
                  const isPouring = pouringOffSchedule?.id === plant.id
                  const isConfirming = offScheduleTarget?.id === plant.id
                  const view = isPouring ? pouringOffSchedule : plant

                  return (
                    <div
                      key={plant.id}
                      className={`godOfplantSoffSchedule ${
                        isPouring ? 'is-pouring' : ''
                      }`}
                    >
                      {isPouring && (
                        <div
                          className='offSchedulePourLayer'
                          aria-hidden='true'
                        >
                          <span className='offScheduleDrop offScheduleDrop--1' />
                          <span className='offScheduleDrop offScheduleDrop--2' />
                          <span className='offScheduleDrop offScheduleDrop--3' />
                          <span className='offScheduleDrop offScheduleDrop--4' />
                          <span className='offScheduleDrop offScheduleDrop--5' />
                        </div>
                      )}
                      <Link
                        to='/my-plants'
                        className='menuOfSoffSchedule plantOpenLink'
                        aria-label={`Открыть «${view.name}» в списке растений`}
                      >
                        <div className='childOfmenuOfSoffSchedule'>
                          {view.photo_url ? (
                            <PlantPhoto src={view.photo_url} alt={view.name} />
                          ) : (
                            <div className='no-photo' />
                          )}
                          <div className='veryChildOfchildOfmenuOfSoffSchedule'>
                            <span className='plantSoffSchedule'>
                              {view.name}
                            </span>
                            <div>
                              <div>
                                <p>План:</p>
                                <p>
                                  {dayOfMonth(view.nextDate)}{' '}
                                  {monthGenitive(view.nextDate)}
                                </p>
                              </div>
                              <span className='spanOfBlockchildOfmenuOfSoffSchedule'></span>
                              <div>
                                <p>{wateringIntervalLabel(view.watering_interval_days)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                      <button
                        type='button'
                        className={`offScheduleWaterButton ${
                          isPouring ? 'is-pouring' : ''
                        }`}
                        onClick={() => openOffScheduleConfirm(plant)}
                        disabled={
                          Boolean(pouringOffSchedule) || Boolean(wateringId)
                        }
                        aria-busy={isPouring}
                        aria-label={
                          isPouring
                            ? `Поливаем «${view.name}»`
                            : `Полить «${view.name}» вне графика`
                        }
                      >
                        {isPouring ? 'Поливаем…' : 'Полить'}
                      </button>
                      {isPouring && (
                        <p className='offSchedulePourStatus' role='status'>
                          Поливаем «{view.name}», обновляем график
                        </p>
                      )}
                      <div
                        className={`checkPlantSoffScheduleoverlay ${
                          isConfirming ? 'active' : ''
                        }`}
                        onClick={closeOffScheduleConfirm}
                      >
                        <div
                          className={`checkPlantSoffSchedule ${
                            isConfirming ? 'active' : ''
                          }`}
                          role='dialog'
                          aria-modal='true'
                          aria-labelledby={`offScheduleConfirmTitle-${plant.id}`}
                          aria-describedby={`offScheduleConfirmPlant-${plant.id}`}
                          onClick={event => event.stopPropagation()}
                        >
                          <p id={`offScheduleConfirmTitle-${plant.id}`}>
                            Вы точно хотите полить:
                          </p>
                          <p id={`offScheduleConfirmPlant-${plant.id}`}>
                            {plant.name}
                          </p>
                          <div>
                            <button
                              type='button'
                              className='checkPlantSoffScheduleYes'
                              onClick={confirmOffScheduleWater}
                            >
                              Да
                            </button>
                            <button
                              type='button'
                              className='checkPlantSoffScheduleNo'
                              onClick={closeOffScheduleConfirm}
                            >
                              Нет
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {hiddenOffScheduleCount > 0 && (
              <button
                type='button'
                className='offScheduleToggle'
                onClick={() => setOffScheduleExpanded(value => !value)}
                aria-expanded={offScheduleExpanded}
                aria-controls='offScheduleList'
              >
                {offScheduleExpanded
                  ? 'Свернуть'
                  : `Показать ещё ${hiddenOffScheduleCount} ${plantWordForm(
                      hiddenOffScheduleCount
                    )}`}
              </button>
            )}
          </div>
        </section>
        <button
          type='button'
          className='desktopDashboardAssistant'
          onClick={() => onTabChange?.('chat')}
        >
          <ThemedIcon src={IconTile} alt='' />
          <span>
            <strong>Спросить ИИ-помощника</strong>
            <small>Подскажет, когда и как поливать ваши растения</small>
          </span>
          <ThemedIcon
            className='desktopAssistantChevron'
            src={chevronleft}
            alt=''
          />
        </button>
      </div>
      <VisionNextPlant
        active={!!selectedDay}
        day={selectedDay}
        nextWatering={nextWatering}
        onGoToDate={handleGoToDate}
        onWater={waterMissedPlant}
        onDeleteWatering={deleteWatering}
        onDeleteCareAction={deleteCareAction}
        wateringPlantId={missedWateringId}
        deletingWateringId={deletingWateringId}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  )
}

export default HomePage
