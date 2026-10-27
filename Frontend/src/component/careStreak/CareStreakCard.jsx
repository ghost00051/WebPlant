import { useEffect, useRef, useState } from 'react'
import { API_URL, getCareStreak, isApiUnavailable } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { subscribeToNotificationsRefresh } from '../../utils/notificationSync.js'
import {
  describeStreakBreak,
  normalizeStreakFreeze
} from '../../utils/careStreakExtra.js'
import {
  buildWeekDays,
  describeWeekProgress,
  formatRecapDate,
  hasCareStreakData,
  streakCountLabel,
  weekProgressPercent
} from '../../utils/careStreak.js'
import './careStreak.css'
import './dark-theme.css'

const MIN_LOAD_INTERVAL_MS = 1_200
const REFRESH_EVENT_THROTTLE_MS = 5_000

function CareStreakCard ({ refreshSignal = 0 }) {
  const [streak, setStreak] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [reloadId, setReloadId] = useState(0)
  const [extras, setExtras] = useState(null)
  const [freezeBusy, setFreezeBusy] = useState(false)
  const [freezeNotice, setFreezeNotice] = useState('')
  const lastLoadAtRef = useRef(0)
  const lastRefreshEventAtRef = useRef(0)

  useEffect(() => {
    if (Date.now() - lastLoadAtRef.current < MIN_LOAD_INTERVAL_MS) {
      return undefined
    }
    lastLoadAtRef.current = Date.now()

    let active = true

    getCareStreak()
      .then(data => {
        if (!active) return
        setStreak(data)
        setError('')
        setUnavailable(false)
      })
      .catch(loadError => {
        if (!active) return
        console.warn('Не удалось загрузить серию ухода:', loadError)
        if (isApiUnavailable(loadError)) {
          setUnavailable(true)
          return
        }
        setError(
          loadError?.message || 'Не удалось загрузить серию ухода. Попробуйте ещё раз.'
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [refreshSignal, reloadId])

  useEffect(() => {
    if (!streak) return undefined
    let active = true

    const loadExtras = async () => {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/users/me/care-streak`,
          { method: 'GET', credentials: 'include' }
        )
        if (!response.ok) return
        const data = await response.json().catch(() => ({}))
        if (!active || !data || typeof data !== 'object') return
        setExtras({
          freeze: normalizeStreakFreeze(data),
          breakReason:
            typeof data.breakReason === 'string' ? data.breakReason : ''
        })
      } catch (error) {
        console.warn('Не удалось загрузить детали серии ухода:', error)
      }
    }

    void loadExtras()
    return () => {
      active = false
    }
  }, [streak, reloadId])

  useEffect(
    () =>
      subscribeToNotificationsRefresh(() => {
        const timestamp = Date.now()
        if (timestamp - lastRefreshEventAtRef.current < REFRESH_EVENT_THROTTLE_MS) {
          return
        }
        lastRefreshEventAtRef.current = timestamp
        setReloadId(value => value + 1)
      }),
    []
  )

  const handleRetry = () => {
    lastLoadAtRef.current = 0
    setLoading(true)
    setError('')
    setUnavailable(false)
    setReloadId(value => value + 1)
  }

  const handleFreeze = async () => {
    if (freezeBusy) return
    setFreezeBusy(true)
    setFreezeNotice('')

    try {
      const response = await fetchWithTimeout(
        `${API_URL}/users/me/care-streak/freeze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include'
        }
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (
          response.status === 404 ||
          response.status === 405 ||
          response.status === 501
        ) {
          setExtras(current => (current ? { ...current, freeze: null } : current))
          setFreezeNotice('Заморозка пока недоступна — загляните позже')
          return
        }
        throw new Error(
          data.message || `Не удалось заморозить серию: HTTP ${response.status}`
        )
      }

      setFreezeNotice('Пропуск заморожен — серия сохранена')
      setReloadId(value => value + 1)
    } catch (error) {
      console.error('Ошибка заморозки серии:', error)
      setFreezeNotice(
        error?.message || 'Не удалось заморозить серию. Попробуйте ещё раз.'
      )
    } finally {
      setFreezeBusy(false)
    }
  }

  if (!streak && unavailable) return null

  if (!streak && error) {
    return (
      <section
        className='careStreakCard'
        aria-labelledby='careStreakTitle'
      >
        <h2 id='careStreakTitle'>Серия ухода</h2>
        <p className='careStreakError' role='alert'>
          {error}
        </p>
        <button
          type='button'
          className='careStreakRetry'
          onClick={handleRetry}
          disabled={loading}
        >
          Повторить
        </button>
      </section>
    )
  }

  if (!streak) {
    return (
      <section
        className='careStreakCard'
        aria-labelledby='careStreakTitle'
        aria-busy='true'
      >
        <h2 id='careStreakTitle'>Серия ухода</h2>
        <p className='careStreakStatus' role='status'>
          Считаем серию ухода…
        </p>
      </section>
    )
  }

  const hasData = hasCareStreakData(streak)
  const weekText = describeWeekProgress(streak.week)
  const weekDays = buildWeekDays(streak.week.days)
  const weekPercent = weekProgressPercent(streak.week)
  const recap = streak.latestRecap
  const recapDate = recap ? formatRecapDate(recap.createdAt) : ''
  const freeze = normalizeStreakFreeze(extras)
  const breakInfo = describeStreakBreak({
    week: streak.week,
    current: streak.current,
    best: streak.best,
    freeze,
    breakReason: extras?.breakReason
  })

  return (
    <section className='careStreakCard' aria-labelledby='careStreakTitle'>
      <header className='careStreakHeader'>
        <div>
          <h2 id='careStreakTitle'>Серия ухода</h2>
          <p className='careStreakSubtitle'>
            Поливайте вовремя — серия и рекорд будут расти
          </p>
        </div>
      </header>

      {!hasData ? (
        <p className='careStreakEmpty'>
          Отметьте первый полив — здесь появится ваша серия. Поливайте вовремя,
          чтобы она росла, а в конце недели приходили итоги.
        </p>
      ) : (
        <>
          <div className='careStreakStats'>
            <p className='careStreakCurrent'>
              <span className='careStreakFlame' aria-hidden='true'>
                🔥
              </span>
              Серия: {streakCountLabel(streak.current)} вовремя
            </p>
            <p className='careStreakBest'>
              Рекорд: {streak.best}
              <span className='careStreakVisuallyHidden'>
                {' '}
                {streakCountLabel(streak.best)} вовремя
              </span>
            </p>
          </div>

          {weekText && (
            <p className='careStreakWeekText'>{weekText}</p>
          )}

          {weekDays.length > 1 && (
            <ul
              className='careStreakDays'
              aria-label='Поливы на этой неделе'
            >
              {weekDays.map(day => (
                <li
                  key={day.iso}
                  className={`careStreakDay is-${day.status}${
                    day.isToday ? ' is-today' : ''
                  }`}
                  aria-label={day.title}
                  title={day.title}
                >
                  <span className='careStreakDayDot' aria-hidden='true' />
                  <span className='careStreakDayLabel' aria-hidden='true'>
                    {day.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {weekPercent > 0 && (
            <div
              className='careStreakProgress'
              role='img'
              aria-label={`Выполнено ${weekPercent}% поливов недели`}
            >
              <span
                className='careStreakProgressFill'
                style={{ width: `${weekPercent}%` }}
              />
            </div>
          )}

          {breakInfo && (
            <p className='careStreakBreak' role='status'>
              {breakInfo.text}
            </p>
          )}

          {freeze && freeze.available && (
            <div className='careStreakFreeze' role='group' aria-label='Заморозка серии'>
              <div className='careStreakFreezeText'>
                <p className='careStreakFreezeTitle'>Заморозка серии</p>
                <p>
                  {freeze.used
                    ? 'На этой неделе заморозка уже использована — берегите следующий пропуск.'
                    : 'Один пропуск в неделю не прервёт серию: заморозим день.'}
                </p>
              </div>
              {freeze.canFreeze && breakInfo && (
                <button
                  type='button'
                  className='careStreakFreezeButton'
                  onClick={handleFreeze}
                  disabled={freezeBusy}
                  aria-busy={freezeBusy || undefined}
                >
                  {freezeBusy ? 'Замораживаем…' : 'Заморозить'}
                </button>
              )}
            </div>
          )}

          {freezeNotice && (
            <p className='careStreakNotice' role='status' aria-live='polite'>
              {freezeNotice}
            </p>
          )}

          {recap && (
            <article
              className='careStreakRecap'
              aria-labelledby='careStreakRecapTitle'
            >
              <header className='careStreakRecapHeader'>
                <h3 id='careStreakRecapTitle'>{recap.title}</h3>
                {recapDate && (
                  <time
                    className='careStreakRecapDate'
                    dateTime={recap.createdAt || undefined}
                  >
                    {recapDate}
                  </time>
                )}
              </header>
              {recap.body && (
                <p className='careStreakRecapBody'>{recap.body}</p>
              )}
            </article>
          )}
        </>
      )}
    </section>
  )
}

export default CareStreakCard
