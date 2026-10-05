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
import moment from 'moment/min/moment-with-locales'
import { API_URL } from '../../utils/api.js'
moment.locale('ru')

import './homePage.css'

const EXIT_MS = 420

function HomePage() {
  const navigate = useNavigate()
  const [plant, setPlant] = useState([])
  const [allPlants, setAllPlants] = useState([])
  const [wateringId, setWateringId] = useState(null)
  const [deletingWateringId, setDeletingWateringId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [history, setHistory] = useState([])
  const [now, setNow] = useState(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [dataError, setDataError] = useState('')

  const calendarRef = useRef(null)

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
    () => new Set(historyMap.keys()),
    [historyMap]
  )

  const overdueDatesSet = useMemo(() => {
    const set = new Set()
    for (const item of history) {
      if (item.hasOverdue) set.add(item.date)
    }
    return set
  }, [history])

  const getWateringPlant = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/plants/need-watering`,
      { method: 'GET', credentials: 'include' }
    )
    if (!response.ok) {
      throw new Error(`Не удалось загрузить список полива: HTTP ${response.status}`)
    }
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('Сервер вернул некорректный список полива')
    setPlant(data)
  }, [])

  const getAllPlants = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/plants`,
      { method: 'GET', credentials: 'include' }
    )
    if (!response.ok) {
      throw new Error(`Не удалось загрузить растения: HTTP ${response.status}`)
    }
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('Сервер вернул некорректный список растений')
    setAllPlants(data)
  }, [])

  const getPlantSchedule = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/plants/schedule`,
      { method: 'GET', credentials: 'include' }
    )
    if (!response.ok) {
      throw new Error(`Не удалось загрузить расписание: HTTP ${response.status}`)
    }
    const data = await response.json()
    if (!Array.isArray(data.items)) throw new Error('Сервер вернул некорректное расписание')
    setSchedule(data.items)
  }, [])

  const getPlantHistory = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/plants/timeline`,
      { method: 'GET', credentials: 'include' }
    )
    if (!response.ok) {
      throw new Error(`Не удалось загрузить историю полива: HTTP ${response.status}`)
    }
    const data = await response.json()
    if (!Array.isArray(data.items)) throw new Error('Сервер вернул некорректную историю полива')
    const normalized = data.items.map(item => {
      const events = Array.isArray(item.events) ? item.events : []
      const hasOverdue = events.some(e => e.kind === 'overdue')
      const hasWatered = events.some(e => e.kind === 'watered')
      return {
        date: item.date,
        events,
        hasOverdue,
        hasWatered,
      }
    })

    setHistory(normalized)
  }, [])

  const loadHomeData = useCallback(async ({ showLoading = false } = {}) => {
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
      errors.forEach(error => console.error('Ошибка загрузки главного экрана:', error))
      setDataError('Не удалось загрузить часть данных. Проверьте подключение и попробуйте ещё раз.')
    } else {
      setDataError('')
    }
    setIsLoading(false)
  }, [getWateringPlant, getAllPlants, getPlantSchedule, getPlantHistory])

  useEffect(() => {
    // The callbacks update UI state only after their fetches resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHomeData()
  }, [loadHomeData])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.body.style.overflow = selectedDay ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [selectedDay])

  const waterPlant = async plantId => {
    if (!plantId || wateringId) return
    setWateringId(plantId)

    try {
      const response = await fetch(
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
        throw new Error(errorData.message || `Не удалось отметить полив: HTTP ${response.status}`)
      }

      setRemovingId(plantId)

      setTimeout(() => {
        setPlant(prev => prev.filter(p => p.id !== plantId))
        setRemovingId(null)
        setWateringId(null)
      }, EXIT_MS)

      loadHomeData()
    } catch (error) {
      console.error('Ошибка полива:', error)
      setDataError(error.message || 'Не удалось отметить полив. Попробуйте ещё раз.')
      setWateringId(null)
    }
  }

  const deleteWatering = async (plantId, logId) => {
    if (deletingWateringId) return
    if (!window.confirm('Удалить запись о поливе? Если это последний полив, растение вернётся в расписание с исходной датой.')) {
      return
    }

    setDeletingWateringId(logId)
    try {
      const response = await fetch(
        `${API_URL}/plants/${plantId}/water/${logId}`,
        { method: 'DELETE', credentials: 'include' }
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `Не удалось удалить запись: HTTP ${response.status}`)
      }

      setSelectedDay(null)
      await loadHomeData()
    } catch (error) {
      console.error('Ошибка удаления записи о поливе:', error)
      setDataError(error.message || 'Не удалось удалить запись о поливе.')
    } finally {
      setDeletingWateringId(null)
    }
  }

  const hours = now.getHours()
  const greeting = hours >= 5 && hours < 12
    ? 'Доброе утро!'
    : hours >= 12 && hours < 18
      ? 'Добрый день!'
      : 'Добрый вечер!'

  const allPlantsMap = useMemo(() => {
    const map = new Map()
    for (const p of allPlants) map.set(p.id, p)
    return map
  }, [allPlants])

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

  const buildDay = useCallback((date) => {
    const m = moment(date)
    const today = moment().startOf('day')
    const target = m.clone().startOf('day')
    const diffDays = target.diff(today, 'days')

    let relative = 'Сегодня'
    if (diffDays === -1) relative = 'Вчера'
    else if (diffDays === 1) relative = 'Завтра'
    else if (diffDays < -1) relative = m.fromNow()
    else if (diffDays > 1) relative = `через ${target.fromNow(true)}`

    const iso = m.format('YYYY-MM-DD')
    const futurePlants = scheduleMap.get(iso) ?? []
    const pastItem = historyMap.get(iso) ?? null
    const pastEvents = pastItem?.events ?? []

    let kind = 'empty'
    let plants = []
    let events = []

    if (futurePlants.length) {
      kind = 'future'
      plants = futurePlants
    } else if (pastEvents.length) {
      kind = 'past'
      events = pastEvents
    }

    return {
      date: m.toDate(),
      diffDays,
      relative,
      iso,
      kind,
      plants,
      events,
      futurePlants,
      pastEvents,
      hasOverdue: pastItem?.hasOverdue ?? false,
      hasWatered: pastItem?.hasWatered ?? false,
      dayNumber: m.format('D'),
      dayOfWeek: capitalize(m.format('dddd')),
      month: capitalize(m.format('MMMM')),
      year: m.format('YYYY'),
      full: `${capitalize(m.format('dddd'))}, ${m.format('D MMMM')}`,
    }
  }, [scheduleMap, historyMap])

  const handleSelectDay = useCallback((date) => {
    setSelectedDay(prev => {
      if (prev && prev.date.getTime() === date.getTime()) return null
      return buildDay(date)
    })
  }, [buildDay])

  const nextWatering = useMemo(() => {
    if (!selectedDay) return null
    const fromIso = selectedDay.iso

    const upcoming = schedule
      .filter(item => item.date > fromIso && item.plants?.length)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (!upcoming.length) return null

    const m = moment(upcoming[0].date)
    return {
      iso: upcoming[0].date,
      label: capitalize(m.format('D MMMM')),
    }
  }, [schedule, selectedDay])

  const handleGoToDate = useCallback((iso) => {
    calendarRef.current?.scrollTo(iso)
    setSelectedDay(buildDay(moment(iso).toDate()))
  }, [buildDay])


  const onePlant = useMemo(() => {
    const firstDay = schedule.find(d => d.plants?.length > 0)
    if (!firstDay) return null
    return { ...firstDay.plants[0], nextDate: firstDay.date }
  }, [schedule])

  return (
    <div className='homePageDashboard'>
      <div className='headerOfHOmePagw'>
        <div className='nameHeaderOfHomePage'>
          <img src={LogoMark} alt='' />
          <p>{greeting}</p>
          <p>Мои растения</p>
        </div>
        <div>
          <img src={Notification} alt='уведомления' />
        </div>
      </div>
      <div className='homePageGrid'>
        <MiniCalendar
          ref={calendarRef}
          onSelectDay={handleSelectDay}
          scheduleMap={scheduleMap}
          pastDates={pastDatesSet}
          overdueDates={overdueDatesSet}
          externalIso={selectedDay?.iso}
        />
        <section className='homePageWatering'>
          <div className='headerNotificiotinsOfHomePAge'>
            <p>Сегодня нужно полить</p>
            <button type='button' onClick={() => navigate('/my-plants')}>Все</button>
          </div>
          <div>
            {dataError && (
              <p className='homePageDataError' role='alert'>
                {dataError}
                <button type='button' onClick={() => loadHomeData({ showLoading: true })}>Повторить</button>
              </p>
            )}
            {isLoading ? (
              <p className='plant-empty' role='status'>Загружаем расписание…</p>
            ) : plant.length === 0 ? (
              dataError ? null : (
                allPlants.length === 0 ? (
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
                        <img src={mainPhoto} alt={item.name} />
                      ) : (
                        <div className='no-photo' />
                      )}
                      <div className='plant-info'>
                        <p className='plant-name'>{item.name}</p>
                        <div className='plant-details'>
                          <span>{item.species}</span>
                          <span className='separator'>·</span>
                          <span>
                            Каждые {fullInfo?.watering_interval_days ?? '—'} дней
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
                      className={`check-button ${isWatering ? 'is-watering' : ''}`}
                      onClick={() => waterPlant(item.id)}
                      disabled={!!wateringId}
                      aria-label={`Отметить, что «${item.name}» полит`}
                    >
                      <img src={check} alt='' />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </section>
        <section className='offScheduleWatering'>
          <div className='descriptioOfoffScheduleWatering'>
            <img src={IconTile} alt="" />
            <div>
              <p>Полив вне графика</p>
              <p>Отметьте растение, которое полили раньше срока</p>
            </div>
            <img src={chevronleft} alt="" />
          </div>
          <div>
            {onePlant && (
              <div className='godOfplantSoffSchedule'>
                <div className='menuOfSoffSchedule'>
                  <div className='childOfmenuOfSoffSchedule'>
                    {onePlant.photo_url ? (
                      <img src={onePlant.photo_url} alt={onePlant.name} />
                    ) : (
                      <div className='no-photo' />
                    )}
                    <div className='veryChildOfchildOfmenuOfSoffSchedule'>
                      <span className='plantSoffSchedule'>{onePlant.name}</span>
                      <div>
                        <div>
                          <p>План:</p>
                          <p>{moment(onePlant.nextDate).format('D MMMM')}</p>
                        </div>
                        <span className='spanOfBlockchildOfmenuOfSoffSchedule'></span>
                        <div>
                          <p>Раз в {onePlant.watering_interval_days} дней</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <button onClick={() => waterPlant(onePlant.id)}>Полить</button>
              </div>
            )}
          </div>
        </section>
      </div>
      <VisionNextPlant
        active={!!selectedDay}
        day={selectedDay}
        nextWatering={nextWatering}
        onGoToDate={handleGoToDate}
        onDeleteWatering={deleteWatering}
        deletingWateringId={deletingWateringId}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  )
}

export default HomePage