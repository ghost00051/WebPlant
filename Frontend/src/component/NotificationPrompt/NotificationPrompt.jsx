import { useState } from 'react'
import {
  requestPermission,
  subscribeToPush
} from '../../utils/pushNotifications.js'
import './NotificationPrompt.css'
import dropletIcon from '../../assets/droplet.svg'
import alertIcon from '../../assets/alert-triangle.svg'
import appIcon from '../../assets/AppIcon.svg'   // 👈 импорт

function NotificationPrompt({ onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const markShown = () => {
    localStorage.setItem('push_prompt_last_shown', Date.now().toString())
  }

  const handleAccept = async () => {
    setLoading(true)
    setError('')
    try {
      if (Notification.permission === 'denied') {
        setError('Уведомления заблокированы в настройках браузера')
        markShown()
        return
      }

      const granted = await requestPermission()
      if (!granted) {
        setError('Разрешение не получено')
        markShown()
        setTimeout(onClose, 1500)
        return
      }

      await subscribeToPush()
      console.log('✅ Подписка сохранена на сервере')
      markShown()
      onClose()
    } catch (err) {
      console.error('❌ Ошибка подписки:', err)
      setError(err.message || 'Не удалось включить уведомления')
    } finally {
      setLoading(false)
    }
  }

  const handleDecline = () => {
    markShown()
    onClose()
  }

  return (
    <div className='notification-prompt-overlay'>
      <div className='notification-prompt'>
        <div className='godOfNotifications'>
          <div className='notification-prompt-icon'>
            <img src={appIcon} alt='' />
          </div>
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
          {error && <p className='notification-prompt-error'>{error}</p>}
        </div>
        <div className='notification-prompt-buttons'>
          <button
            className='notification-prompt-btn-secondary'
            onClick={handleDecline}
            disabled={loading}
          >
            Не сейчас
          </button>
          <div className='line'></div>
          <button
            className='notification-prompt-btn-primary'
            onClick={handleAccept}
            disabled={loading}
          >
            {loading ? 'Подключение...' : 'Включить'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotificationPrompt