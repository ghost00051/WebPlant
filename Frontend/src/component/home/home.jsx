import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import NotificationPrompt from '../NotificationPrompt/NotificationPrompt.jsx'
import {
    isPushSupported,
    getActivePushSubscription,
    markPushPromptShown,
    restorePushSubscription,
    shouldOfferPushPrompt,
    syncPushSubscription
} from '../../utils/pushNotifications.js'
import Tools from '../tools/tools.jsx'
import MobileNav from '../tools/MobileNav.jsx'
import HomePage from '../homePage/homePage.jsx'
import Chat from '../chat/chat.jsx'
import { useChatSessions } from '../chat/useChatSessions.js'
import AiTicker from '../aiTicker/aiTicker.jsx'
import HistoryChat from '../historyChat/historyChat.jsx'
import Profile from '../profile/profile.jsx'
import PwaInstallHint from '../PwaInstallHint/PwaInstallHint.jsx'
import { API_URL } from '../../utils/api.js'
import { syncUserTimeZone } from '../../utils/timeZone.js'
import LogoMark from '../../assets/LogoMark.svg'
import NotificationsBell from './NotificationsBell.jsx'
import { TAB_ELEMENT_ID, TAB_PANEL_ID } from '../tools/tabs.js'
import './home.css'
import './home.desktop.css'
import './dark-theme.css'

function AppHeader ({ user, onProfileClick }) {
    const accountName = user.name || user.username || user.email

    return (
        <header className='desktopAppHeader'>
            <div className='desktopBrand'>
                <img src={LogoMark} alt='' />
                <span>Лейка</span>
            </div>
            <div className='desktopAccount'>
                <NotificationsBell className='desktopNotifications' />
                <button
                    type='button'
                    className='desktopProfileButton'
                    onClick={onProfileClick}
                    aria-label={`Профиль: ${accountName}`}
                >
                    <span className='desktopAvatar'>
                        {(accountName || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className='desktopProfileText'>
                        <strong>{accountName}</strong>
                        <small>Садовод-любитель</small>
                    </span>
                </button>
            </div>
        </header>
    )
}

function Home() {
    const navigate = useNavigate()
    const location = useLocation()
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [authError, setAuthError] = useState('')
    const [authAttempt, setAuthAttempt] = useState(0)
    const [showPrompt, setShowPrompt] = useState(false)
    const requestedTab = location.state?.activeTab
    const [activeTab, setActiveTab] = useState(
        requestedTab === 'profile' || requestedTab === 'chat' ? requestedTab : 'home'
    )
    const chat = useChatSessions(user?.id, activeTab === 'chat')

    useEffect(() => {
        let cancelled = false
        let promptTimer = null

        const checkAuth = async () => {
            let userData
            try {
                const res = await fetch(`${API_URL}/users/me`, {
                    method: 'GET',
                    credentials: 'include'
                })

                if (cancelled) return

                if (res.status === 401 || res.status === 404) {
                    setUser(null)
                    navigate('/login', { replace: true })
                    return
                }
                if (!res.ok) {
                    throw new Error(`Ошибка проверки авторизации: HTTP ${res.status}`)
                }

                userData = await res.json()
            } catch (error) {
                console.error('❌ Ошибка проверки:', error)
                if (cancelled) return
                setUser(null)
                setAuthError(
                    'Сервер не ответил. Проверьте подключение и попробуйте ещё раз.'
                )
                setLoading(false)
                return
            }

            if (cancelled) return
            setUser(userData)

            void syncUserTimeZone(userData.timezone).then(timeZone => {
                if (cancelled) return
                if (timeZone && timeZone !== userData.timezone) {
                    setUser(current => (current ? { ...current, timezone: timeZone } : current))
                }
            })

            try {
                if (!isPushSupported()) {
                    setLoading(false)
                    return
                }

                if (window.Notification.permission === 'granted') {
                    const subscription = await getActivePushSubscription()
                    if (cancelled) return
                    if (subscription) {
                        void syncPushSubscription()
                    } else {
                        void restorePushSubscription()
                    }
                    setLoading(false)
                    return
                }

                if (window.Notification.permission === 'denied') {
                    setLoading(false)
                    return
                }

                if (!shouldOfferPushPrompt()) {
                    setLoading(false)
                    return
                }

                promptTimer = setTimeout(() => {
                    if (cancelled) return
                    markPushPromptShown()
                    setShowPrompt(true)
                }, 2000)
                setLoading(false)
            } catch (error) {
                console.error('❌ Ошибка настройки уведомлений:', error)
                if (!cancelled) setLoading(false)
            }
        }

        checkAuth()

        return () => {
            cancelled = true
            if (promptTimer) clearTimeout(promptTimer)
        }
    }, [navigate, authAttempt])

    const retryAuth = () => {
        setAuthError('')
        setShowPrompt(false)
        setLoading(true)
        setAuthAttempt(value => value + 1)
    }

    useEffect(() => {
        document.documentElement.classList.add('app-shell')
        document.body.classList.add('app-shell')

        return () => {
            document.documentElement.classList.remove('app-shell')
            document.body.classList.remove('app-shell')
            document.body.classList.remove('vision-open')
        }
    }, [])

    if (loading) {
        return (
            <main className='homeLoading' aria-busy='true'>
                <p role='status'>Загружаем раздел…</p>
            </main>
        )
    }
    if (authError) {
        return (
            <main className='homeAuthError'>
                <div className='homeAuthErrorContent' role='alert'>
                    <img className='homeAuthErrorLogo' src={LogoMark} alt='' />
                    <h1 className='homeAuthErrorTitle'>Не удалось загрузить раздел</h1>
                    <p className='homeAuthErrorText'>{authError}</p>
                    <button
                        type='button'
                        className='homeAuthErrorRetry'
                        onClick={retryAuth}
                    >
                        Повторить
                    </button>
                </div>
            </main>
        )
    }
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
            <div className='godOfBlocksChat'>
                <AppHeader user={user} onProfileClick={() => setActiveTab('profile')} />
                <HistoryChat
                    sessions={chat.sessions}
                    activeSessionId={chat.sessionId}
                    isLoading={chat.isLoadingSessions}
                    isOpen={chat.isHistoryOpen}
                    onSelect={chat.selectSession}
                    onNewChat={chat.startNewChat}
                    onDelete={chat.deleteSession}
                    onClose={chat.closeHistory}
                />
                <main className='chatMain'>
                    <div
                        className='chatTabPanel'
                        role='tabpanel'
                        id={TAB_PANEL_ID('chat')}
                        aria-labelledby={TAB_ELEMENT_ID('chat')}
                    >
                        <Chat
                            sessionId={chat.sessionId}
                            onOpenHistory={chat.openHistory}
                            onNewChat={chat.startNewChat}
                            onSessionsChanged={chat.refreshSessions}
                        />
                    </div>
                </main>
                <MobileNav onTabChange={handleTabChange} activeTab={activeTab} />
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
    return (
        <div className="gofOfMain">
            <AppHeader user={user} onProfileClick={() => setActiveTab('profile')} />
            <MobileNav onTabChange={handleTabChange} activeTab={activeTab} />
            {activeTab === 'home' && <AiTicker />}
            <main key={activeTab} className="screenTransition">
                {activeTab === 'home' && <PwaInstallHint />}
                {renderScreen()}
            </main>
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
