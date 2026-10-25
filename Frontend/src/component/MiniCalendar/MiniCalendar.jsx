import { useState, useMemo, useCallback, forwardRef, useImperativeHandle, useRef } from 'react'
import CalendarIcon from '../../assets/CalendarIcon.svg'
import ArrowLeft from '../../assets/ArrowLeft.svg'
import ArrowRight from '../../assets/ArrowRight.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import {
  addDays,
  dayOfMonth,
  diffInDays,
  isBefore,
  isSameDay,
  monthGenitive,
  monthNominative,
  resolveWateringMarkers,
  startOfISOWeek,
  toDate,
  today,
  toISODate,
} from '../../utils/date.js'
import {
  hasCareMarkers,
  sortedCareGroups,
} from '../../utils/careEvents.js'
import './MiniCalendar.css'
import './MiniCalendar.desktop.css'
import './dark-theme.css'

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_IN_VIEW = 14
const MONTH_WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_IN_WEEK = 7

const CARE_GROUP_LABELS = {
  feed: 'Подкормка',
  spray: 'Опрыскивание',
  other: 'Другой уход',
}

const PLANNED_CARE_GROUP_LABELS = {
  feed: 'Плановая подкормка',
  spray: 'Плановое опрыскивание',
  other: 'Плановый другой уход',
}

const EMPTY_CARE_MAP = new Map()

const careGroupLabel = (group, isPlanned = false) => {
  const labels = isPlanned ? PLANNED_CARE_GROUP_LABELS : CARE_GROUP_LABELS
  return labels[group] ?? ''
}

const collectCareGroups = (pastTypes, futureTypes, iso) => {
  const past = pastTypes instanceof Map ? pastTypes.get(iso) : null
  const future = futureTypes instanceof Map ? futureTypes.get(iso) : null
  const groups = new Set()
  if (past instanceof Set) for (const group of past) groups.add(group)
  if (future instanceof Set) for (const group of future) groups.add(group)

  return sortedCareGroups(groups).map(group => ({
    group,
    planned:
      Boolean(future instanceof Set && future.has(group)) &&
      !(past instanceof Set && past.has(group)),
  }))
}

const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1)

const wateringStateLabels = ({ isFuture, isPast, isOverdue }) => [
  isFuture && 'будущий полив',
  isOverdue && 'пропущенный полив',
  isPast && 'прошлый полив',
].filter(Boolean)

const buildDayLabel = (
  date,
  { isToday, isSelected, isFuture, isPast, isOverdue, careGroups = [] }
) => {
  const parts = [`${dayOfMonth(date)} ${monthGenitive(date)}`]
  if (isToday) parts.push('сегодня')
  const watering = wateringStateLabels({ isFuture, isPast, isOverdue })
  if (watering.length) parts.push(watering.join(', '))
  const care = careGroups
    .map(item => careGroupLabel(item.group, item.planned).toLowerCase())
    .filter(Boolean)
  if (care.length) parts.push(care.join(', '))
  if (isSelected) parts.push('выбран')
  return parts.join(', ')
}

const handleGridKeyDown = (event, grid, setFocusIndex) => {
  const buttons = grid ? [...grid.querySelectorAll('button[data-day]')] : []
  if (!buttons.length) return
  const currentIndex = buttons.indexOf(document.activeElement)
  if (currentIndex < 0) return

  let nextIndex
  switch (event.key) {
    case 'ArrowLeft':
      nextIndex = currentIndex - 1
      break
    case 'ArrowRight':
      nextIndex = currentIndex + 1
      break
    case 'ArrowUp':
      nextIndex = currentIndex - DAYS_IN_WEEK
      break
    case 'ArrowDown':
      nextIndex = currentIndex + DAYS_IN_WEEK
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = buttons.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  nextIndex = Math.max(0, Math.min(nextIndex, buttons.length - 1))
  setFocusIndex(nextIndex)
  buttons[nextIndex].focus()
}

const MiniCalendar = forwardRef(function MiniCalendar(
  {
    onSelectDay,
    futureDates,
    pastDates,
    overdueDates,
    externalIso,
    carePastTypes = EMPTY_CARE_MAP,
    careFutureTypes = EMPTY_CARE_MAP,
  },
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
  const [mobileFocusIndex, setMobileFocusIndex] = useState(null)
  const [desktopFocusIndex, setDesktopFocusIndex] = useState(null)

  const mobileGridRef = useRef(null)
  const desktopGridRef = useRef(null)

  const anchor = useMemo(() => toDate(anchorTime), [anchorTime])

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

  const mobileStartIndex = useMemo(() => {
    const todayIndex = days.findIndex(day => isSameDay(day, todayDate))
    if (todayIndex >= 0) return todayIndex
    const selectedIndex = days.findIndex(day => externalIso === toISODate(day))
    return selectedIndex >= 0 ? selectedIndex : 0
  }, [days, todayDate, externalIso])

  const desktopStartIndex = useMemo(() => {
    const todayIndex = desktopMonthDays.findIndex(day => isSameDay(day, todayDate))
    if (todayIndex >= 0) return todayIndex
    const selectedIndex = desktopMonthDays.findIndex(day => externalIso === toISODate(day))
    return selectedIndex >= 0 ? selectedIndex : 0
  }, [desktopMonthDays, todayDate, externalIso])

  const mobileTabIndex = mobileFocusIndex ?? mobileStartIndex
  const desktopTabIndex = desktopFocusIndex ?? desktopStartIndex

  const prev = () => {
    setDirection('prev')
    setAnchorTime(current => addDays(current, -DAYS_IN_VIEW).getTime())
    setAnimKey(k => k + 1)
    setMobileFocusIndex(null)
  }

  const next = () => {
    setDirection('next')
    setAnchorTime(current => addDays(current, DAYS_IN_VIEW).getTime())
    setAnimKey(k => k + 1)
    setMobileFocusIndex(null)
  }

  const prevDesktopMonth = () => {
    setDesktopMonthTime(current => {
      const date = toDate(current)
      return new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime()
    })
    setDesktopFocusIndex(null)
  }

  const nextDesktopMonth = () => {
    setDesktopMonthTime(current => {
      const date = toDate(current)
      return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
    })
    setDesktopFocusIndex(null)
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

  const getWateringState = useCallback((dateStr) => resolveWateringMarkers({
    isPlanned: futureDates?.has?.(dateStr) ?? false,
    hasHistory: pastDates?.has?.(dateStr) ?? false,
    hasMissed: overdueDates?.has?.(dateStr) ?? false,
  }), [futureDates, pastDates, overdueDates])

  const getCareGroups = useCallback(
    dateStr => collectCareGroups(carePastTypes, careFutureTypes, dateStr),
    [carePastTypes, careFutureTypes]
  )

  const showCareLegend = hasCareMarkers(carePastTypes, careFutureTypes)

  const renderDots = ({ isFuture, isPast, isOverdue }, careGroups = []) => (
    <>
      <div className='mini-calendar__dots' aria-hidden='true'>
        {isFuture && <span className='dot dot--future' title='Будущий полив' />}
        {isOverdue && <span className='dot dot--overdue' title='Просроченный или пропущенный полив' />}
        {isPast && <span className='dot dot--past' title='Прошлый полив' />}
      </div>
      {careGroups.length > 0 && (
        <div className='mini-calendar__care-dots'>
          {careGroups.map(({ group, planned }) => {
            const label = careGroupLabel(group, planned)
            return (
              <span
                key={group}
                className={`care-dot care-dot--${group}${planned ? ' care-dot--planned' : ''}`}
                title={label}
                aria-label={label}
              />
            )
          })}
        </div>
      )}
    </>
  )

  return (
    <div className='mini-calendar'>
      <div className='mini-calendar__header mini-calendar__mobile-header'>
        <div className='mini-calendar__title'>
          <img src={CalendarIcon} alt='' />
          <span key={title}>{title}</span>
        </div>
        <div className='mini-calendar__nav'>
          <button type='button' onClick={prev} aria-label='Предыдущие 2 недели'>
            <ThemedIcon src={ArrowLeft} alt='' />
          </button>
          <button type='button' onClick={next} aria-label='Следующие 2 недели'>
            <ThemedIcon src={ArrowRight} alt='' />
          </button>
        </div>
      </div>

      <div className='mini-calendar__weekdays'>
        {WEEK_DAYS.map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div
        className='mini-calendar__grid-wrap'
        role='group'
        aria-label='Календарь полива, две недели'
        aria-describedby='mini-calendar-legend-mobile'
        ref={mobileGridRef}
        onKeyDown={event => handleGridKeyDown(event, mobileGridRef.current, setMobileFocusIndex)}
      >
        <div
          key={animKey}
          className={`mini-calendar__grid slide-${direction}`}
        >
          {days.map((day, index) => {
            const dateStr = toISODate(day)
            const isToday = isSameDay(day, todayDate)
            const isSelected = externalIso === dateStr
            const wateringState = getWateringState(dateStr)
            const careGroups = getCareGroups(dateStr)

            return (
              <button
                key={dateStr}
                type='button'
                data-day='true'
                tabIndex={index === mobileTabIndex ? 0 : -1}
                aria-label={buildDayLabel(day, {
                  isToday,
                  isSelected,
                  ...wateringState,
                  careGroups,
                })}
                aria-current={isToday ? 'date' : undefined}
                className={[
                  'mini-calendar__day',
                  isToday && 'is-today',
                  isSelected && 'is-selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleSelect(day)}
                onFocus={() => setMobileFocusIndex(index)}
              >
                <span className='mini-calendar__day-number'>{dayOfMonth(day)}</span>
                {renderDots(wateringState, careGroups)}
              </button>
            )
          })}
        </div>
      </div>

      <div className='mini-calendar__legend' id='mini-calendar-legend-mobile'>
        <span className='legend-item'>
          <span className='dot dot--future' aria-hidden='true' /> Будущий полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--past' aria-hidden='true' /> Прошлый полив
        </span>
        <span className='legend-item'>
          <span className='dot dot--overdue' aria-hidden='true' /> Пропущенный/просроченный
        </span>
        <span className='legend-item'>
          <span className='legend-today-swatch' aria-hidden='true' /> Сегодня
        </span>
        {showCareLegend && (
          <>
            <span className='legend-item legend-item--care'>
              <span className='care-dot care-dot--feed' aria-hidden='true' /> Подкормка
            </span>
            <span className='legend-item legend-item--care'>
              <span className='care-dot care-dot--spray' aria-hidden='true' /> Опрыскивание
            </span>
            <span className='legend-item legend-item--care'>
              <span className='care-dot care-dot--other' aria-hidden='true' /> Другой уход
            </span>
          </>
        )}
      </div>
      <div className='mini-calendar__desktop-view'>
        <div className='mini-calendar__header'>
          <div className='mini-calendar__title'>
            <img src={CalendarIcon} alt='' />
            <span>{desktopMonthTitle}</span>
          </div>
          <div className='mini-calendar__nav'>
            <button type='button' onClick={prevDesktopMonth} aria-label='Предыдущий месяц'>
              <ThemedIcon src={ArrowLeft} alt='' />
            </button>
            <button type='button' onClick={nextDesktopMonth} aria-label='Следующий месяц'>
              <ThemedIcon src={ArrowRight} alt='' />
            </button>
          </div>
        </div>
        <div className='mini-calendar__weekdays'>
          {MONTH_WEEK_DAYS.map(day => <span key={day}>{day}</span>)}
        </div>
        <div
          className='mini-calendar__month-grid'
          role='group'
          aria-label='Календарь полива, месяц'
          aria-describedby='mini-calendar-legend-desktop'
          ref={desktopGridRef}
          onKeyDown={event => handleGridKeyDown(event, desktopGridRef.current, setDesktopFocusIndex)}
        >
          {desktopMonthDays.map((day, index) => {
            const dateStr = toISODate(day)
            const isCurrentMonth = day.getMonth() === desktopMonth.getMonth()
            const isToday = isSameDay(day, todayDate)
            const isSelected = externalIso === dateStr
            const wateringState = getWateringState(dateStr)
            const careGroups = getCareGroups(dateStr)
            const isWateringDay = wateringState.isFuture || wateringState.isPast || wateringState.isOverdue

            return (
              <button
                key={dateStr}
                type='button'
                data-day='true'
                tabIndex={index === desktopTabIndex ? 0 : -1}
                aria-label={buildDayLabel(day, {
                  isToday,
                  isSelected,
                  ...wateringState,
                  careGroups,
                })}
                aria-current={isToday ? 'date' : undefined}
                className={[
                  'mini-calendar__month-day',
                  !isCurrentMonth && 'is-outside',
                  isToday && 'is-today',
                  isSelected && 'is-selected',
                  isWateringDay && 'is-watering-day',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(day)}
                onFocus={() => setDesktopFocusIndex(index)}
              >
                <span className='mini-calendar__day-number'>{dayOfMonth(day)}</span>
                {renderDots(wateringState, careGroups)}
              </button>
            )
          })}
        </div>
        <div className='mini-calendar__desktop-legend' id='mini-calendar-legend-desktop'>
          <span><i className='dot dot--future' aria-hidden='true' /> Будущий полив</span>
          <span><i className='dot dot--past' aria-hidden='true' /> Прошлый полив</span>
          <span><i className='dot dot--overdue' aria-hidden='true' /> Пропущенный/просроченный</span>
          <span><span className='legend-today-swatch' aria-hidden='true' /> Сегодня</span>
          {showCareLegend && (
            <>
              <span><i className='care-dot care-dot--feed' aria-hidden='true' /> Подкормка</span>
              <span><i className='care-dot care-dot--spray' aria-hidden='true' /> Опрыскивание</span>
              <span><i className='care-dot care-dot--other' aria-hidden='true' /> Другой уход</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

export default MiniCalendar
