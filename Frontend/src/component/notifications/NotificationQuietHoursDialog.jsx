import { useEffect, useRef, useState } from 'react'
import { isTimeValue, validateQuietHours } from '../../utils/notificationsExtraApi.js'

const HALF_HOUR_OPTIONS = (() => {
  const options = []
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minutes of ['00', '30']) {
      const value = `${String(hour).padStart(2, '0')}:${minutes}`
      options.push(value)
    }
  }
  return options
})()

function NotificationQuietHoursDialog({ quietHours, timezone, saving, onSave, onClose }) {
  const [enabled, setEnabled] = useState(Boolean(quietHours?.enabled))
  const [start, setStart] = useState(isTimeValue(quietHours?.start) ? quietHours.start : '22:00')
  const [end, setEnd] = useState(isTimeValue(quietHours?.end) ? quietHours.end : '08:00')
  const [status, setStatus] = useState(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector('button, select, input')?.focus?.()
    })
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  const submit = async () => {
    const next = { enabled, start, end }
    const validation = validateQuietHours(next)
    if (validation) {
      setStatus({ tone: 'error', text: validation })
      return
    }
    setStatus({ tone: 'info', text: 'Сохраняю…' })
    const result = await onSave(next)
    setStatus({ tone: result?.tone || 'success', text: result?.text || 'Сохранено.' })
  }

  const preview = enabled ? `${start}–${end}` : ''

  return (
    <div
      className='notificationsSheetOverlay'
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className='notificationsSheet'
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='notificationQuietHoursTitle'
      >
        <header className='notificationsSheetHeader'>
          <h2 id='notificationQuietHoursTitle'>Тихие часы</h2>
          <button
            type='button'
            className='notificationsSheetClose'
            onClick={onClose}
            aria-label='Закрыть настройку тихих часов'
          >
            ×
          </button>
        </header>

        <p className='notificationsSheetText'>
          В это время не приходят push и сообщения в мессенджеры. Уведомления
          в приложении сохранятся и будут ждать вас здесь.
        </p>

        <div className='notificationsQuietToggle'>
          <label className='notificationsSwitch'>
            <input
              type='checkbox'
              checked={enabled}
              disabled={saving}
              aria-label='Включить тихие часы'
              onChange={event => {
                setEnabled(event.target.checked)
                setStatus(null)
              }}
            />
            <span className='notificationsSwitchTrack' aria-hidden='true' />
          </label>
          <div className='notificationsQuietToggleText'>
            <p>{enabled ? 'Тихие часы включены' : 'Тихие часы выключены'}</p>
            <span>{enabled ? `Доставка не раньше ${end}` : 'Доставка в любое время'}</span>
          </div>
        </div>

        <div className='notificationsQuietFields'>
          <label className='notificationsQuietField'>
            <span>Начало</span>
            <select
              value={start}
              onChange={event => {
                setStart(event.target.value)
                setStatus(null)
              }}
              disabled={!enabled || saving}
            >
              {HALF_HOUR_OPTIONS.map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className='notificationsQuietField'>
            <span>Конец</span>
            <select
              value={end}
              onChange={event => {
                setEnd(event.target.value)
                setStatus(null)
              }}
              disabled={!enabled || saving}
            >
              {HALF_HOUR_OPTIONS.map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        {preview && (
          <p className='notificationsQuietPreview'>
            Окно доставки: {preview}
            {timezone ? ` · ${timezone}` : ''}
          </p>
        )}

        {status && (
          <p
            className={`notificationsSheetStatus notificationsSheetStatus--${status.tone}`}
            role={status.tone === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </p>
        )}

        <div className='notificationsSheetActions'>
          <button
            type='button'
            className='notificationsSheetPrimary'
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button
            type='button'
            className='notificationsSheetSecondary'
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>
      </section>
    </div>
  )
}

export default NotificationQuietHoursDialog
