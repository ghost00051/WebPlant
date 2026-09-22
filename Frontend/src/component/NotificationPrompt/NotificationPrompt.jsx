import { useState } from 'react'
import {
  requestPermission,
  subscribeToPush
} from '../../utils/pushNotifications.js'
import './NotificationPrompt.css'
import dropletIcon from '../../assets/droplet.svg'
import alert from '../../assets/alert-triangle.svg'

function NotificationPrompt({ userId, onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAccept = async () => {
    setLoading(true)
    setError('')
    try {
      const granted = await requestPermission()
      if (!granted) {
        setError('Разрешение не получено')
        localStorage.setItem('push_prompt_last_shown', Date.now().toString())
        setTimeout(onClose, 1500)
        return
      }

      console.log('📤 Подписываемся для user_id =', userId)
      await subscribeToPush()

      alert('✅ Уведомления включены!')
      onClose()
    } catch (err) {
      console.error('❌ Ошибка:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDecline = () => {
    localStorage.setItem('push_prompt_last_shown', Date.now().toString())
    onClose()
  }

  return (
    <div className='notification-prompt-overlay'>
      <div className='notification-prompt'>
        <div className='godOfNotifications'>
          <div className='notification-prompt-icon'>
            <img src='../../src/assets/AppIcon.svg' alt='' />
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
              <img src={alert} alt='предупреждение' />
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
