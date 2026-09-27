import { useState, useEffect, useCallback, useMemo } from 'react'
import moment from 'moment/min/moment-with-locales'
moment.locale('ru')
import CalendarIcon from '../../assets/CalendarIcon.svg'
import ArrowLeft from '../../assets/ArrowLeft.svg'
import ArrowRight from '../../assets/ArrowRight.svg'
import './MiniCalendar.css'

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_IN_VIEW = 14

function MiniCalendar({ onSelectDay, scheduleMap }) {
  const [anchor, setAnchor] = useState(moment().startOf('isoWeek'))
  const [pastWaterings, setPastWaterings] = useState([])

  const futureWaterings = useMemo(
    () => (scheduleMap ? [...scheduleMap.keys()] : []),
    [scheduleMap]
  )

  const today = moment().startOf('day')

  const days = Array.from({ length: DAYS_IN_VIEW }, (_, i) =>
    anchor.clone().add(i, 'day')
  )

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)
  const title = capitalize(anchor.format('MMMM YYYY'))

  const isSameDay = (a, b) => a.isSame(b, 'day')

  const prev = () => setAnchor(a => a.clone().subtract(DAYS_IN_VIEW, 'days'))
  const next = () => setAnchor(a => a.clone().add(DAYS_IN_VIEW, 'days'))


  const getPlantHistory = useCallback(async () => {
    try {
      const response = await fetch(
        'https://server.checktheplants.ru/api/plants/history',
        { method: 'GET', credentials: 'include' }
      )
      if (response.ok) {
        const data = await response.json()
        const plantsArray = Array.isArray(data) ? data : data.plants || []
        const pastDates = plantsArray
          .filter(p => p.last_watered_at)
          .map(p => moment(p.last_watered_at).format('YYYY-MM-DD'))
        setPastWaterings([...new Set(pastDates)])
      }
    } catch (error) {
      console.error('Ошибка получения истории:', error)
    }
  }, [])

  useEffect(() => {
    getPlantHistory()
  }, [getPlantHistory])

  return (
    <div className='mini-calendar'>
      <div className='mini-calendar__header'>
        <div className='mini-calendar__title'>
          <img src={CalendarIcon} alt='' />
          <span>{title}</span>
        </div>
        <div className='mini-calendar__nav'>
          <button onClick={prev} aria-label='Предыдущие 2 недели'>
            <img src={ArrowLeft} alt='' />
          </button>
          <button onClick={next} aria-label='Следующие 2 недели'>
            <img src={ArrowRight} alt='' />
          </button>
        </div>
      </div>

      <div className='mini-calendar__weekdays'>
        {WEEK_DAYS.map(d => <span key={d}>{d}</span>)}
      </div>

      <div className='mini-calendar__grid'>
        {days.map(day => {
          const dateStr = day.format('YYYY-MM-DD')
          const isToday = isSameDay(day, today)
          const isFuture = futureWaterings.includes(dateStr)
          const isPast = pastWaterings.includes(dateStr)

          return (
            <button
              key={dateStr}
              className={['mini-calendar__day', isToday && 'is-today']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDay?.(day.toDate())}
            >
              <span className='mini-calendar__day-number'>{day.date()}</span>
              <div className='mini-calendar__dots'>
                {isFuture && <span className='dot dot--future' title='Будущий полив' />}
                {isPast && <span className='dot dot--past' title='Прошлый полив' />}
              </div>
            </button>
          )
        })}
      </div>

      <div className='mini-calendar__legend'>
        <span className='legend-item'>
          <span className='dot dot--future' /> Будущий полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--past' /> Прошлый полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--today' /> Сегодня
        </span>
      </div>
    </div>
  )
}

export default MiniCalendar