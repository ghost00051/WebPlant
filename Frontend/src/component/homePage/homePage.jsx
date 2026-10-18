import LogoMark from '../../assets/LogoMark.svg'
import Notification from '../../assets/NotifBtn.svg'
import MiniCalendar from '../MiniCalendar/MiniCalendar'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
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

import './homePage.css'
import './homePage.desktop.css'
import './dark-theme.css'
import './notifications-button.css'

const EXIT_MS = 420
const POUR_ANIMATION_MS = 1200
const OFF_SCHEDULE_PREVIEW_COUNT = 3

function plantWordForm (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'растение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return 'растения'
  return 'растений'
}

function badgeValue (count) {
  const value = Number(count) || 0
  if (value <= 0) return ''
  return value > 99 ? '99+' : String(value)
}

function HomePage ({ user, onTabChange }) {
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
  const [now, setNow] = useState(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [badgeText, setBadgeText] = useState('')
  const [offScheduleTarget, setOffScheduleTarget] = useState(null)
  const [pouringOffSchedule, setPouringOffSchedule] = useState(null)
  const [offScheduleExpanded, setOffScheduleExpanded] = useState(false)

  const calendarRef = useRef(null)
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

  const pastDatesSet = useMemo(() => new Set(historyMap.keys()), [historyMap])

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
      if (!response.ok) {
        throw new Error(
          `Не удалось определить кол-во непрочитанных уведомлений ${response.status}`
        )
      }
      const data = await response.json()
      setBadgeText(data)
    } catch (error) {
      console.warn('Не удалось загрузить уведомления:', error)
    }
  }, [])

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
      return {
        date: item.date,
        events,
        hasOverdue,
        hasWatered
      }
    })

    setHistory(normalized)
  }, [])

  const loadHomeData = useCallback(
    async ({ showLoading = false } = {}) => {
      setDataError('')
      if (showLoading) setIsLoading(true)

      const results = await Promise.allSettled([
        getWateringPlant(),
        getAllPlants(),
        getPlantSchedule(),
        getPlantHistory()
      ])
      const errors = results
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
    [getWateringPlant, getAllPlants, getPlantSchedule, getPlantHistory]
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

  const waterPlant = async plantId => {
    if (!plantId || wateringId) return
    setWateringId(plantId)

    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/${plantId}/water`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include'
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.message ||
            `Не удалось отметить полив: HTTP ${response.status}`
        )
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

  const waterMissedPlant = async (plantId, scheduledFor) => {
    if (!plantId || missedWateringId) {
      return { ok: false, message: '' }
    }

    setMissedWateringId(plantId)
    let alreadyWatered = false
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/${plantId}/water`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_for: scheduledFor }),
          credentials: 'include'
        }
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        alreadyWatered = response.status === 409
        throw new Error(
          data.message || `Не удалось отметить полив: HTTP ${response.status}`
        )
      }

      await loadHomeData()
      return { ok: true, convertedSkip: Boolean(data.converted_skip) }
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
  const hours = now.getHours()
  const greeting =
    hours >= 5 && hours < 12
      ? 'Доброе утро!'
      : hours >= 12 && hours < 18
      ? 'Добрый день!'
      : 'Добрый вечер!'
  const dateLabel = `${capitalize(weekdayName(now))}, ${dayOfMonth(
    now
  )} ${monthGenitive(now)}`
  const displayName = user?.name || user?.username || 'садовод'

  const allPlantsMap = useMemo(() => {
    const map = new Map()
    for (const p of allPlants) map.set(p.id, p)
    return map
  }, [allPlants])

  const buildDay = useCallback(
    date => {
      const target = toDate(date)
      const relative = relativeDayLabel(target)
      const iso = toISODate(target)
      const futurePlants = scheduleMap.get(iso) ?? []
      const pastItem = historyMap.get(iso) ?? null
      const pastEvents = pastItem?.events ?? []

      const view = buildDayView({
        date: target,
        now,
        plannedPlants: futurePlants,
        events: pastEvents
      })

      return {
        date: target,
        diffDays: diffInDays(target, now),
        relative,
        iso,
        kind: view.kind,
        plants: view.plants,
        events: view.events,
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

  return (
    <div className='homePageDashboard'>
      <div className='headerOfHOmePagw'>
        <div className='nameHeaderOfHomePage'>
          <img src={LogoMark} alt='' />
          <p>{greeting}</p>
          <p>Мои растения</p>
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
            {greeting.replace('!', '')}, {displayName} · {dateLabel}
          </p>
        </div>
        <div className='desktopHeaderActions'>
          <span className='desktopDateBadge'>
            <img src={CalendarIcon} alt='' />
            Сегодня, {dayOfMonth(now)} {monthGenitive(now)}
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
        />
        <section className='homePageWatering'>
          <div className='headerNotificiotinsOfHomePAge'>
            <p>Сегодня нужно полить</p>
          </div>
          <div>
            {dataError && (
              <p className='homePageDataError' role='alert'>
                {dataError}
                <button
                  type='button'
                  onClick={() => loadHomeData({ showLoading: true })}
                >
                  Повторить
                </button>
              </p>
            )}
            {isLoading ? (
              <p className='plant-empty' role='status'>
                Загружаем расписание…
              </p>
            ) : plant.length === 0 ? (
              dataError ? null : allPlants.length === 0 ? (
                <div className='plant-empty'>
                  <p>В коллекции пока нет растений.</p>
                  <button
                    type='button'
                    className='homePageAddPlant'
                    onClick={() => navigate('/add-plant')}
                  >
                    Добавить первое растение
                  </button>
                </div>
              ) : (
                <p className='plant-empty'>Все растения политы 💚</p>
              )
            ) : (
              plant.map(item => {
                const fullInfo = allPlantsMap.get(item.id)
                const mainPhoto =
                  fullInfo?.photos?.find(p => p.is_main)?.url ??
                  fullInfo?.photos?.[0]?.url
                const isRemoving = removingId === item.id
                const isWatering = wateringId === item.id
                return (
                  <div
                    key={item.id}
                    className={`plantRender ${isRemoving ? 'is-removing' : ''}`}
                  >
                    <div className='description'>
                      {mainPhoto ? (
                        <PlantPhoto src={mainPhoto} alt={item.name} />
                      ) : (
                        <div className='no-photo' />
                      )}
                      <div className='plant-info'>
                        <p className='plant-name'>{item.name}</p>
                        <div className='plant-details'>
                          <span>{item.species}</span>
                          <span className='separator'>·</span>
                          <span>
                            Каждые {fullInfo?.watering_interval_days ?? '—'}{' '}
                            дней
                          </span>
                        </div>
                        <div className='watering-badge'>
                          <img src={droplets} alt='' />
                          Полить сегодня
                        </div>
                      </div>
                    </div>
                    <button
                      type='button'
                      className={`check-button ${
                        isWatering ? 'is-watering' : ''
                      }`}
                      onClick={() => waterPlant(item.id)}
                      disabled={!!wateringId}
                      aria-label={`Отметить, что «${item.name}» полит`}
                    >
                      <img src={check} alt='' />
                      <span>Полить</span>
                    </button>
                  </div>
                )
              })
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
                      <div className='menuOfSoffSchedule'>
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
                                <p>Раз в {view.watering_interval_days} дней</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
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
        wateringPlantId={missedWateringId}
        deletingWateringId={deletingWateringId}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  )
}

export default HomePage
