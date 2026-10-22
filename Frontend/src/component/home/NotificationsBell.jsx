import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NotificationIcon from '../../assets/NotifBtn.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { subscribeToNotificationChanges } from '../../utils/notificationSync.js'
import { setAppBadgeCount } from '../../utils/appBadge.js'
import './notificationsBell.css'

function badgeValue (count) {
    const value = Number(count) || 0
    if (value <= 0) return ''
    return value > 99 ? '99+' : String(value)
}

function notificationsBellLabel (count) {
    const badge = badgeValue(count)
    return badge ? `Уведомления, непрочитанных: ${badge}` : 'Уведомления'
}

function NotificationsBell ({ className = '' }) {
    const navigate = useNavigate()
    const [unreadCount, setUnreadCount] = useState(0)

    const loadUnreadCount = useCallback(async () => {
        try {
            const response = await fetchWithTimeout(
                `${API_URL}/notifications/unread-count`,
                { method: 'GET', credentials: 'include' }
            )
            if (!response.ok) return
            const data = await response.json().catch(() => ({}))
            if (Number.isInteger(data?.unreadCount)) {
                setUnreadCount(data.unreadCount)
                setAppBadgeCount(data.unreadCount)
            }
        } catch {
            return
        }
    }, [])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- первичная загрузка счётчика при монтировании шапки
        void loadUnreadCount()

        const refresh = () => {
            if (document.visibilityState === 'visible') void loadUnreadCount()
        }
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', refresh)
        return () => {
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', refresh)
        }
    }, [loadUnreadCount])

    useEffect(
        () =>
            subscribeToNotificationChanges(() => {
                void loadUnreadCount()
            }),
        [loadUnreadCount]
    )

    const badge = badgeValue(unreadCount)

    return (
        <button
            type='button'
            className={`notificationsBell${className ? ` ${className}` : ''}`}
            aria-label={notificationsBellLabel(unreadCount)}
            onClick={() => navigate('/notifications')}
        >
            <ThemedIcon src={NotificationIcon} alt='' />
            {badge && (
                <span className='notificationsBellBadge' aria-hidden='true'>
                    {badge}
                </span>
            )}
        </button>
    )
}

export default NotificationsBell
