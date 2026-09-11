import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NotificationPrompt from '../NotificationPrompt/NotificationPrompt.jsx'
import {
    isPushSupported,
    isIOS,
    isStandalone
} from '../../utils/pushNotifications.js'
import Tools from '../tools/tools.jsx'

function Home() {
    const navigate = useNavigate()
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [showPrompt, setShowPrompt] = useState(false)

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const API_URL = import.meta.env.VITE_API_URL || 'https://server.checktheplants.ru/api'
                const res = await fetch(`${API_URL}/users/me`, {
                    credentials: 'include' 
                })

                if (!res.ok) {
                    navigate('/')
                    return
                }

                const userData = await res.json()
                setUser(userData)
                console.log('✅ Пользователь:', userData)

                if (!isPushSupported()) {
                    console.log('❌ Push не поддерживается')
                    setLoading(false)
                    return
                }

                if (isIOS() && !isStandalone()) {
                    console.log('❌ iOS — не PWA')
                    setLoading(false)
                    return
                }

                if (Notification.permission === 'granted') {
                    const reg = await navigator.serviceWorker.ready
                    const sub = await reg.pushManager.getSubscription()
                    if (sub) {
                        console.log('✅ Уже подписан на push')
                        setLoading(false)
                        return
                    }
                }

                if (Notification.permission === 'denied') {
                    console.log('❌ Уведомления запрещены')
                    setLoading(false)
                    return
                }

                const lastShown = localStorage.getItem('push_prompt_last_shown')
                if (lastShown) {
                    const daysSince = (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60 * 24)
                    if (daysSince < 7) {
                        console.log('⏭️ Недавно показывали')
                        setLoading(false)
                        return
                    }
                }

                setTimeout(() => setShowPrompt(true), 2000)
                setLoading(false)

            } catch (error) {
                console.error('❌ Ошибка проверки:', error)
                navigate('/')
            }
        }

        checkAuth()
    }, [navigate])

    if (loading) return <div>Загрузка...</div>
    if (!user) return null

    return (
        <div className="gofOfMain">
            <p>Привет</p>
            {/* <DayPicker
                mode="single"
                selected={selected}
                onSelect={setSelected}
                footer={
                    selected ? `Selected: ${selected.toLocaleDateString()}` : "Pick a day."
                }
            /> */}
            <Tools />
            {showPrompt && (
                <NotificationPrompt
                    userId={user.id}
                    onClose={() => setShowPrompt(false)}
                />
            )}
        </div>
    );
}

export default Home