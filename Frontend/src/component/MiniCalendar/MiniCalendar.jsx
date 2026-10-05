import { useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import moment from 'moment/min/moment-with-locales'
import CalendarIcon from '../../assets/CalendarIcon.svg'
import ArrowLeft from '../../assets/ArrowLeft.svg'
import ArrowRight from '../../assets/ArrowRight.svg'
import './MiniCalendar.css'
moment.locale('ru')

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_IN_VIEW = 14

const MiniCalendar = forwardRef(function MiniCalendar(
  { onSelectDay, scheduleMap, pastDates, overdueDates, externalIso },
  ref
) {
  const [anchor, setAnchor] = useState(moment().startOf('isoWeek'))
  const [direction, setDirection] = useState('next')
  const [animKey, setAnimKey] = useState(0)

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

  const prev = () => {
    setDirection('prev')
    setAnchor(a => a.clone().subtract(DAYS_IN_VIEW, 'days'))
    setAnimKey(k => k + 1)
  }

  const next = () => {
    setDirection('next')
    setAnchor(a => a.clone().add(DAYS_IN_VIEW, 'days'))
    setAnimKey(k => k + 1)
  }

  useImperativeHandle(ref, () => ({
    scrollTo(iso) {
      const m = moment(iso)
      const target = m.clone().startOf('isoWeek')
      setDirection(target.isBefore(anchor) ? 'prev' : 'next')
      setAnchor(target)
      setAnimKey(k => k + 1)
    }
  }), [anchor])

  return (
    <div className='mini-calendar'>
      <div className='mini-calendar__header'>
        <div className='mini-calendar__title'>
          <img src={CalendarIcon} alt='' />
          <span key={title}>{title}</span>
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
        {WEEK_DAYS.map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className='mini-calendar__grid-wrap'>
        <div
          key={animKey}
          className={`mini-calendar__grid slide-${direction}`}
        >
          {days.map(day => {
            const dateStr = day.format('YYYY-MM-DD')
            const isToday = isSameDay(day, today)
            const isSelected = externalIso === dateStr
            const isFuture = futureWaterings.includes(dateStr)
            const isPast = pastDates?.has?.(dateStr) ?? false
            const isOverdue = overdueDates?.has?.(dateStr) ?? false

            return (
              <button
                key={dateStr}
                className={[
                  'mini-calendar__day',
                  isToday && 'is-today',
                  isSelected && 'is-selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectDay?.(day.toDate())}
              >
                <span className='mini-calendar__day-number'>{day.date()}</span>
                <div className='mini-calendar__dots'>
                  {isFuture && <span className='dot dot--future' title='Будущий полив' />}
                  {isOverdue && <span className='dot dot--overdue' title='Пропущенный полив' />}
                  {isPast && !isOverdue && <span className='dot dot--past' title='Прошлый полив' />}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className='mini-calendar__legend'>
        <span className='legend-item'>
          <span className='dot dot--future' /> Будущий полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--past' /> Прошлый полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--overdue' /> Пропущенный
        </span>
        <span className='legend-item'>
          <span className='dot dot--today' /> Сегодня
        </span>
      </div>
    </div>
  )
})

export default MiniCalendar