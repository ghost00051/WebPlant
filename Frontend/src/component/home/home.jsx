import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import NotificationPrompt from '../NotificationPrompt/NotificationPrompt.jsx'
import {
    isPushSupported,
    isIOS,
    isStandalone
} from '../../utils/pushNotifications.js'
import Tools from '../tools/tools.jsx'
import HomePage from '../homePage/homePage.jsx'
import Chat from '../chat/chat.jsx'
import Profile from '../profile/profile.jsx'
import './home.css'

function Home() {
    const navigate = useNavigate()
    const location = useLocation()
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [showPrompt, setShowPrompt] = useState(false)
    const [activeTab, setActiveTab] = useState('home')

    useEffect(() => {
        const requestedTab = location.state?.activeTab
        if (requestedTab === 'profile') {
            setActiveTab('profile')
        }
    }, [location.state])

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const API_URL = import.meta.env.VITE_API_URL || 'https://server.checktheplants.ru/api'
                const res = await fetch(`${API_URL}/users/me`, {
                    method: 'GET',
                    credentials: 'include'
                })

                if (res.status === 401 || res.status === 404) {
                    setUser(null)
                    navigate('/', { replace: true })
                    return
                }
                if (!res.ok) {
                    throw new Error(`Ошибка проверки авторизации: HTTP ${res.status}`)
                }

                const userData = await res.json()
                setUser(userData)
                console.log('✅ Пользователь:', userData)

                if (!isPushSupported()) {
                    setLoading(false)
                    return
                }

                if (isIOS() && !isStandalone()) {
                    setLoading(false)
                    return
                }

                if (Notification.permission === 'granted') {
                    const reg = await navigator.serviceWorker.ready
                    const sub = await reg.pushManager.getSubscription()
                    if (sub) {
                        setLoading(false)
                        return
                    }
                }

                if (Notification.permission === 'denied') {
                    setLoading(false)
                    return
                }

                const lastShown = localStorage.getItem('push_prompt_last_shown')
                if (lastShown) {
                    const daysSince = (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60 * 24)
                    if (daysSince < 7) {
                        setLoading(false)
                        return
                    }
                }

                setTimeout(() => setShowPrompt(true), 2000)
                setLoading(false)

            } catch (error) {
                console.error('❌ Ошибка проверки:', error)
                setLoading(false)
            }
        }

        checkAuth()
    }, [navigate])

    if (loading) return <div>Загрузка...</div>
    if (!user) return null

    const renderScreen = () => {
        switch (activeTab) {
            case 'home':
                return <HomePage />
            case 'profile':
                return <Profile />
            default:
                return <HomePage />
        }
    }

    const handleTabChange = tab => {
        if (tab === 'add') {
            navigate('/add-plant')
            return
        }
        setActiveTab(tab)
    }

    if (activeTab === 'chat') {
        return (
            <>
                <Chat />
                <Tools onTabChange={handleTabChange} activeTab={activeTab} />
                {showPrompt && (
                    <NotificationPrompt
                        userId={user.id}
                        onClose={() => setShowPrompt(false)}
                    />
                )}
            </>
        )
    }

    return (
        <div className="gofOfMain">
            <div key={activeTab} className="screenTransition">
                {renderScreen()}
            </div>
            <Tools onTabChange={handleTabChange} activeTab={activeTab} />
            {showPrompt && (
                <NotificationPrompt
                    userId={user.id}
                    onClose={() => setShowPrompt(false)}
                />
            )}
        </div>
    )
}

export default Home