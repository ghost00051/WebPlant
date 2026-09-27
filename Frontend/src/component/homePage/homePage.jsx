import LogoMark from '../../assets/LogoMark.svg'
import Notification from '../../assets/NotifBtn.svg'
import MiniCalendar from '../MiniCalendar/MiniCalendar'
import { useEffect, useState, useCallback, useMemo } from 'react'
import check from '../../assets/check.svg'
import droplets from '../../assets/droplets.svg'
import VisionNextPlant from '../visionNextPlant/visionNextPlant'
import moment from 'moment/min/moment-with-locales'
moment.locale('ru')

import './homePage.css'

const EXIT_MS = 420

function HomePage() {
  const [plant, setPlant] = useState([])
  const [allPlants, setAllPlants] = useState([])
  const [wateringId, setWateringId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [now, setNow] = useState(new Date())

  const scheduleMap = useMemo(() => {
    const map = new Map()
    for (const item of schedule) map.set(item.date, item.plants ?? [])
    return map
  }, [schedule])

  const getWateringPlant = useCallback(async () => {
    try {
      const response = await fetch(
        'https://server.checktheplants.ru/api/plants/need-watering',
        { method: 'GET', credentials: 'include' }
      )
      if (response.ok) {
        const data = await response.json()
        setPlant(data)
      }
    } catch (error) {
      console.error('Ошибка получения растений:', error)
    }
  }, [])

  const getAllPlants = useCallback(async () => {
    try {
      const response = await fetch(
        'https://server.checktheplants.ru/api/plants',
        { method: 'GET', credentials: 'include' }
      )
      if (response.ok) {
        const data = await response.json()
        setAllPlants(data)
      }
    } catch (error) {
      console.error('Ошибка получения растений:', error)
    }
  }, [])

  const getPlantSchedule = useCallback(async () => {
    try {
      const response = await fetch(
        'https://server.checktheplants.ru/api/plants/schedule',
        { method: 'GET', credentials: 'include' }
      )
      if (response.ok) {
        const data = await response.json()
        setSchedule(Array.isArray(data.items) ? data.items : [])
      }
    } catch (error) {
      console.error('Ошибка получения расписания:', error)
    }
  }, [])

  useEffect(() => {
    getWateringPlant()
    getAllPlants()
    getPlantSchedule()
  }, [getWateringPlant, getAllPlants, getPlantSchedule])

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
        `https://server.checktheplants.ru/api/plants/${plantId}/water`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include'
        }
      )
      if (!response.ok) {
        setWateringId(null)
        return
      }

      setRemovingId(plantId)
      setTimeout(() => {
        setPlant(prev => prev.filter(p => p.id !== plantId))
        setRemovingId(null)
        setWateringId(null)
      }, EXIT_MS)

      getWateringPlant()
      getAllPlants()
      getPlantSchedule()
    } catch (error) {
      console.error('Ошибка полива:', error)
      setWateringId(null)
    }
  }

  const hours = now.getHours()
  let greeting = ''
  if (hours >= 5 && hours < 12) greeting = 'Доброе утро!'
  else if (hours >= 12 && hours < 18) greeting = 'Добрый день!'
  else greeting = 'Добрый вечер!'

  const allPlantsMap = useMemo(() => {
    const map = new Map()
    for (const p of allPlants) map.set(p.id, p)
    return map
  }, [allPlants])

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

  const handleSelectDay = useCallback((date) => {
    setSelectedDay(prev => {
      if (prev && prev.date.getTime() === date.getTime()) return null

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
      const plants = scheduleMap.get(iso) ?? []     

      return {
        date,
        diffDays,
        relative,
        iso,
        plants,
        dayNumber: m.format('D'),
        dayOfWeek: capitalize(m.format('dddd')),
        month: capitalize(m.format('MMMM')),
        year: m.format('YYYY'),
        full: `${capitalize(m.format('dddd'))}, ${m.format('D MMMM')}`,
      }
    })
  }, [scheduleMap])                               

  return (
    <div>
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

      <MiniCalendar
        onSelectDay={handleSelectDay}
        scheduleMap={scheduleMap}                   
      />

      <div>
        <div className='headerNotificiotinsOfHomePAge'>
          <p>Сегодня нужно полить</p>
          <button type='button'>Все</button>
        </div>

        <div>
          {plant.length === 0 ? (
            <p className='plant-empty'>Все растения политы 💚</p>
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
      </div>

      <VisionNextPlant
        active={!!selectedDay}
        day={selectedDay}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  )
}

export default HomePage