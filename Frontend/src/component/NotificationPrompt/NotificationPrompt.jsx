import { useState } from 'react'
import {
    requestPermission,
    subscribeToPush
} from '../../utils/pushNotifications.js'
import './NotificationPrompt.css'

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
        <div className="notification-prompt-overlay">
            <div className="notification-prompt">
                <div className="notification-prompt-icon">🔔</div>
                <h2>Включить уведомления?</h2>
                <p className="notification-prompt-text">
                    Мы будем присылать вам важные уведомления:
                </p>
                <ul className="notification-prompt-list">
                    <li>💧 Напоминания о поливе растений</li>
                    <li>🌱 Советы по уходу</li>
                    <li>📊 Новости вашего сада</li>
                </ul>
                <p className="notification-prompt-note">
                    Вы всегда сможете отключить их в настройках
                </p>

                {error && <p className="notification-prompt-error">{error}</p>}

                <div className="notification-prompt-buttons">
                    <button
                        className="notification-prompt-btn-secondary"
                        onClick={handleDecline}
                        disabled={loading}
                    >
                        Не сейчас
                    </button>
                    <button
                        className="notification-prompt-btn-primary"
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