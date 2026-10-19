import { useEffect, useRef, useState } from 'react'
import {
  isIOS,
  isStandalone,
  markPushPromptAnswered,
  requestPermission,
  setPushDisabledOnThisDevice,
  subscribeToPush
} from '../../utils/pushNotifications.js'
import './NotificationPrompt.css'
import './dark-theme.css'
import dropletIcon from '../../assets/droplet.svg'
import alertIcon from '../../assets/alert-triangle.svg'
import appIcon from '../../assets/AppIcon.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'

function NotificationPrompt({ onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const needsIOSInstall = isIOS() && !isStandalone()

  const dialogRef = useRef(null)
  const primaryButtonRef = useRef(null)
  const secondaryButtonRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement

    const initialFocus = primaryButtonRef.current || secondaryButtonRef.current
    if (initialFocus) initialFocus.focus()

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        markPushPromptAnswered('declined')
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll('button:not([disabled])')
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const previous = previouslyFocusedRef.current
      if (previous && typeof previous.focus === 'function' && previous.isConnected) {
        previous.focus()
      }
    }
  }, [])

  const handleAccept = async () => {
    if (needsIOSInstall) return

    setLoading(true)
    setError('')
    try {
      if (Notification.permission === 'denied') {
        setError(
          'Уведомления заблокированы в настройках браузера. Разрешите их для этого сайта и попробуйте снова.'
        )
        return
      }

      const granted = await requestPermission()
      if (!granted) {

        setError(
          'Разрешение не получено. Разрешите уведомления в настройках браузера и нажмите «Включить» ещё раз.'
        )
        return
      }

      setPushDisabledOnThisDevice(false)
      await subscribeToPush()
      markPushPromptAnswered('accepted')
      console.log('✅ Подписка сохранена на сервере')
      onClose()
    } catch (err) {

      console.error('❌ Ошибка подписки:', err)
      setError(
        err.message || 'Не удалось включить уведомления. Проверьте подключение и попробуйте ещё раз.'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleDecline = () => {
    markPushPromptAnswered('declined')
    onClose()
  }

  return (
    <div className='notification-prompt-overlay'>
      <div
        className='notification-prompt'
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='notification-prompt-title'
        aria-describedby='notification-prompt-description'
      >
        <div className='godOfNotifications'>
          <div className='notification-prompt-icon'>
            <ThemedIcon src={appIcon} alt='' />
          </div>
          {needsIOSInstall ? (
            <>
              <h2 id='notification-prompt-title'>Уведомления на iPhone и iPad</h2>
              <p className='notification-prompt-text' id='notification-prompt-description'>
                Сначала добавьте «Лейку» на экран «Домой»: в Safari нажмите
                «Поделиться» → «На экран Домой», затем откройте приложение с
                иконки. Push-уведомления доступны начиная с iOS/iPadOS 16.4.
              </p>
            </>
          ) : (
            <>
              <h2 id='notification-prompt-title'>«Лейка» хочет отправлять вам уведомления</h2>
              <p className='notification-prompt-text' id='notification-prompt-description'>
                Уведомления помогают не забыть о поливе: напомним в нужный момент и
                предупредим, если растение пересохло.
              </p>
              <div>
                <div className='whetToWater'>
                  <img src={dropletIcon} alt='когда полить' />
                  <p>Напомним, когда пора полить</p>
                </div>
                <div className='driedOut'>
                  <img src={alertIcon} alt='предупреждение' />
                  <p>Предупредим, если почва пересохнет</p>
                </div>
              </div>
            </>
          )}
          {error && (
            <p className='notification-prompt-error' role='alert'>
              {error}
            </p>
          )}
        </div>
        <div className='notification-prompt-buttons'>
          <button
            type='button'
            className='notification-prompt-btn-secondary'
            onClick={handleDecline}
            disabled={loading}
            ref={secondaryButtonRef}
          >
            {needsIOSInstall ? 'Понятно' : 'Не сейчас'}
          </button>
          {!needsIOSInstall && <div className='line'></div>}
          {!needsIOSInstall && (
            <button
              type='button'
              className='notification-prompt-btn-primary'
              onClick={handleAccept}
              disabled={loading}
              aria-busy={loading}
              ref={primaryButtonRef}
            >
              {loading ? 'Подключение...' : 'Включить'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationPrompt
