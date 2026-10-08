import { useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import CalendarIcon from '../../assets/CalendarIcon.svg'
import ArrowLeft from '../../assets/ArrowLeft.svg'
import ArrowRight from '../../assets/ArrowRight.svg'
import {
  addDays,
  dayOfMonth,
  diffInDays,
  isBefore,
  isSameDay,
  monthNominative,
  startOfISOWeek,
  toDate,
  today,
  toISODate,
} from '../../utils/date.js'
import './MiniCalendar.css'
import './MiniCalendar.desktop.css'
import './dark-theme.css'

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_IN_VIEW = 14
const MONTH_WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1)

const MiniCalendar = forwardRef(function MiniCalendar(
  { onSelectDay, scheduleMap, pastDates, overdueDates, externalIso },
  ref
) {
  const [anchorTime, setAnchorTime] = useState(
    () => startOfISOWeek(today()).getTime()
  )
  const [desktopMonthTime, setDesktopMonthTime] = useState(() => {
    const current = today()
    return new Date(current.getFullYear(), current.getMonth(), 1).getTime()
  })
  const [direction, setDirection] = useState('next')
  const [animKey, setAnimKey] = useState(0)

  const anchor = useMemo(() => toDate(anchorTime), [anchorTime])

  const futureWaterings = useMemo(
    () => (scheduleMap ? [...scheduleMap.keys()] : []),
    [scheduleMap]
  )

  const todayDate = useMemo(() => today(), [])

  const days = useMemo(
    () => Array.from({ length: DAYS_IN_VIEW }, (_, i) => addDays(anchor, i)),
    [anchor]
  )

  const title = `${capitalize(monthNominative(anchor))} ${anchor.getFullYear()}`
  const desktopMonth = useMemo(() => toDate(desktopMonthTime), [desktopMonthTime])
  const desktopMonthTitle = `${capitalize(monthNominative(desktopMonth))} ${desktopMonth.getFullYear()}`
  const desktopMonthDays = useMemo(() => {
    const firstDay = new Date(desktopMonth.getFullYear(), desktopMonth.getMonth(), 1)
    const lastDay = new Date(desktopMonth.getFullYear(), desktopMonth.getMonth() + 1, 0)
    const firstVisibleDay = startOfISOWeek(firstDay)
    const visibleDays = Math.ceil((lastDay.getDate() + diffInDays(firstDay, firstVisibleDay)) / 7) * 7

    return Array.from({ length: visibleDays }, (_, index) => addDays(firstVisibleDay, index))
  }, [desktopMonth])

  const prev = () => {
    setDirection('prev')
    setAnchorTime(current => addDays(current, -DAYS_IN_VIEW).getTime())
    setAnimKey(k => k + 1)
  }

  const next = () => {
    setDirection('next')
    setAnchorTime(current => addDays(current, DAYS_IN_VIEW).getTime())
    setAnimKey(k => k + 1)
  }

  const prevDesktopMonth = () => {
    setDesktopMonthTime(current => {
      const date = toDate(current)
      return new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime()
    })
  }

  const nextDesktopMonth = () => {
    setDesktopMonthTime(current => {
      const date = toDate(current)
      return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
    })
  }

  useImperativeHandle(ref, () => ({
    scrollTo(iso) {
      const target = startOfISOWeek(toDate(iso))
      setDirection(isBefore(target, anchor) ? 'prev' : 'next')
      setAnchorTime(target.getTime())
      setAnimKey(k => k + 1)
      const targetDate = toDate(iso)
      setDesktopMonthTime(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).getTime())
    }
  }), [anchor])

  const handleSelect = useCallback((date) => {
    onSelectDay?.(date)
  }, [onSelectDay])

  const getWateringState = useCallback((dateStr) => ({
    isFuture: futureWaterings.includes(dateStr),
    isPast: pastDates?.has?.(dateStr) ?? false,
    isOverdue: overdueDates?.has?.(dateStr) ?? false,
  }), [futureWaterings, pastDates, overdueDates])

  const renderDots = ({ isFuture, isPast, isOverdue }) => (
    <div className='mini-calendar__dots'>
      {isFuture && <span className='dot dot--future' title='Будущий полив' />}
      {isOverdue && <span className='dot dot--overdue' title='Пропущенный полив' />}
      {isPast && !isOverdue && <span className='dot dot--past' title='Прошлый полив' />}
    </div>
  )

  return (
    <div className='mini-calendar'>
      <div className='mini-calendar__header mini-calendar__mobile-header'>
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
            const dateStr = toISODate(day)
            const isToday = isSameDay(day, todayDate)
            const isSelected = externalIso === dateStr
            const { isFuture, isPast, isOverdue } = getWateringState(dateStr)

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
                onClick={() => handleSelect(day)}
              >
                <span className='mini-calendar__day-number'>{dayOfMonth(day)}</span>
                {renderDots({ isFuture, isPast, isOverdue })}
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
      <div className='mini-calendar__desktop-view'>
        <div className='mini-calendar__header'>
          <div className='mini-calendar__title'>
            <img src={CalendarIcon} alt='' />
            <span>{desktopMonthTitle}</span>
          </div>
          <div className='mini-calendar__nav'>
            <button onClick={prevDesktopMonth} aria-label='Предыдущий месяц'>
              <img src={ArrowLeft} alt='' />
            </button>
            <button onClick={nextDesktopMonth} aria-label='Следующий месяц'>
              <img src={ArrowRight} alt='' />
            </button>
          </div>
        </div>
        <div className='mini-calendar__weekdays'>
          {MONTH_WEEK_DAYS.map(day => <span key={day}>{day}</span>)}
        </div>
        <div className='mini-calendar__month-grid'>
          {desktopMonthDays.map(day => {
            const dateStr = toISODate(day)
            const isCurrentMonth = day.getMonth() === desktopMonth.getMonth()
            const isToday = isSameDay(day, todayDate)
            const isSelected = externalIso === dateStr
            const { isFuture, isPast, isOverdue } = getWateringState(dateStr)
            const isWateringDay = isFuture || isPast || isOverdue
            const wateringLabels = [
              isFuture && 'будущий полив',
              isOverdue && 'пропущенный полив',
              isPast && !isOverdue && 'прошлый полив',
            ].filter(Boolean)

            return (
              <button
                key={dateStr}
                className={[
                  'mini-calendar__month-day',
                  !isCurrentMonth && 'is-outside',
                  isToday && 'is-today',
                  isSelected && 'is-selected',
                  isWateringDay && 'is-watering-day',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(day)}
                aria-label={`${dayOfMonth(day)} ${monthNominative(day)}${wateringLabels.length ? `, ${wateringLabels.join(', ')}` : ''}`}
              >
                <span className='mini-calendar__day-number'>{dayOfMonth(day)}</span>
                {renderDots({ isFuture, isPast, isOverdue })}
              </button>
            )
          })}
        </div>
        <div className='mini-calendar__desktop-legend'>
          <span><i className='dot dot--future' /> Будущий полив</span>
          <span><i className='dot dot--past' /> Прошлый полив</span>
          <span><i className='dot dot--overdue' /> Пропущенный</span>
          <span><i className='dot dot--today' /> Сегодня</span>
        </div>
      </div>
    </div>
  )
})

export default MiniCalendar
