import { useState } from 'react'
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

function NotificationPrompt({ onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const needsIOSInstall = isIOS() && !isStandalone()

  const handleAccept = async () => {
    if (needsIOSInstall) return

    setLoading(true)
    setError('')
    try {
      if (Notification.permission === 'denied') {
        setError('Уведомления заблокированы в настройках браузера')
        markPushPromptAnswered('declined')
        return
      }

      const granted = await requestPermission()
      if (!granted) {
        setError('Разрешение не получено')
        markPushPromptAnswered('declined')
        setTimeout(onClose, 1500)
        return
      }

      setPushDisabledOnThisDevice(false)
      await subscribeToPush()
      markPushPromptAnswered('accepted')
      console.log('✅ Подписка сохранена на сервере')
      onClose()
    } catch (err) {
      markPushPromptAnswered('accepted')
      console.error('❌ Ошибка подписки:', err)
      setError(err.message || 'Не удалось включить уведомления')
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
      <div className='notification-prompt'>
        <div className='godOfNotifications'>
          <div className='notification-prompt-icon'>
            <img src={appIcon} alt='' />
          </div>
          {needsIOSInstall ? (
            <>
              <h2>Уведомления на iPhone и iPad</h2>
              <p className='notification-prompt-text'>
                Сначала добавьте «Лейку» на экран «Домой»: в Safari нажмите
                «Поделиться» → «На экран Домой», затем откройте приложение с
                иконки. Push-уведомления доступны начиная с iOS/iPadOS 16.4.
              </p>
            </>
          ) : (
            <>
              <h2>«Лейка» хочет отправлять вам уведомления</h2>
              <p className='notification-prompt-text'>
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
          {error && <p className='notification-prompt-error'>{error}</p>}
        </div>
        <div className='notification-prompt-buttons'>
          <button
            className='notification-prompt-btn-secondary'
            onClick={handleDecline}
            disabled={loading}
          >
            {needsIOSInstall ? 'Понятно' : 'Не сейчас'}
          </button>
          {!needsIOSInstall && <div className='line'></div>}
          {!needsIOSInstall && (
            <button
              className='notification-prompt-btn-primary'
              onClick={handleAccept}
              disabled={loading}
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