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
import HistoryChat from '../historyChat/historyChat.jsx'
import Profile from '../profile/profile.jsx'
import PwaInstallHint from '../PwaInstallHint/PwaInstallHint.jsx'
import { API_URL } from '../../utils/api.js'
import LogoMark from '../../assets/LogoMark.svg'
import Notification from '../../assets/NotifBtn.svg'
import './home.css'
import './home.desktop.css'
import './dark-theme.css'

function Home() {
    const navigate = useNavigate()
    const location = useLocation()
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [showPrompt, setShowPrompt] = useState(false)
    const [activeTab, setActiveTab] = useState(
        location.state?.activeTab === 'profile' ? 'profile' : 'home'
    )

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await fetch(`${API_URL}/users/me`, {
                    method: 'GET',
                    credentials: 'include'
                })

                if (res.status === 401 || res.status === 404) {
                    setUser(null)
                    navigate('/login', { replace: true })
                    return
                }
                if (!res.ok) {
                    throw new Error(`Ошибка проверки авторизации: HTTP ${res.status}`)
                }

                const userData = await res.json()
                setUser(userData)

                if (!isPushSupported()) {
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
                if (lastShown && !(isIOS() && isStandalone())) {
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
                return <HomePage user={user} onTabChange={setActiveTab} />
            case 'profile':
                return <Profile />
            default:
                return <HomePage user={user} onTabChange={setActiveTab} />
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
                <div className='godOfBlocksChat'>
                    <header className="desktopAppHeader">
                        <div className="desktopBrand">
                            <img src={LogoMark} alt="" />
                            <span>Лейка</span>
                        </div>
                        <div className="desktopAccount">
                            <img className="desktopNotifications" src={Notification} alt="Уведомления" />
                            <button
                                type="button"
                                className="desktopProfileButton"
                                onClick={() => setActiveTab('profile')}
                            >
                                <span className="desktopAvatar">
                                    {(user.name || user.username || user.email || '?').charAt(0).toUpperCase()}
                                </span>
                                <span className="desktopProfileText">
                                    <strong>{user.name || user.username || user.email}</strong>
                                    <small>Садовод-любитель</small>
                                </span>
                            </button>
                        </div>
                    </header>
                    <HistoryChat />
                    <Chat />
                    <Tools onTabChange={handleTabChange} activeTab={activeTab} />
                    {showPrompt && (
                        <NotificationPrompt
                            userId={user.id}
                            onClose={() => setShowPrompt(false)}
                        />
                    )}
                </div>
            </>
        )
    }
    return (
        <div className="gofOfMain">
            <header className="desktopAppHeader">
                <div className="desktopBrand">
                    <img src={LogoMark} alt="" />
                    <span>Лейка</span>
                </div>
                <div className="desktopAccount">
                    <img className="desktopNotifications" src={Notification} alt="Уведомления" />
                    <button
                        type="button"
                        className="desktopProfileButton"
                        onClick={() => setActiveTab('profile')}
                    >
                        <span className="desktopAvatar">
                            {(user.name || user.username || user.email || '?').charAt(0).toUpperCase()}
                        </span>
                        <span className="desktopProfileText">
                            <strong>{user.name || user.username || user.email}</strong>
                            <small>Садовод-любитель</small>
                        </span>
                    </button>
                </div>
            </header>
            <div key={activeTab} className="screenTransition">
                {activeTab === 'home' && <PwaInstallHint />}
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