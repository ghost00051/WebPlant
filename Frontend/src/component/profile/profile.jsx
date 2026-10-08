import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './profile.css'
import Pencil from '../../assets/pencil.svg'
import {
    isPasskeySupported,
    listPasskeys,
    registerPasskey
} from '../../utils/passkey.js'
import {
    isIOS,
    isPushSupported,
    isStandalone,
    requestPermission,
    subscribeToPush,
    unsubscribeFromPush
} from '../../utils/pushNotifications.js'
import { API_URL } from '../../utils/api.js'
import { useTheme } from '../../context/useTheme.js'
import './dark-theme.css'

// Панель администратора подгружается отдельным чанком и только для роли ADMIN:
// обычные пользователи не скачивают её код и не видят разметку.
const AdminPushPanel = lazy(() => import('../adminPush/AdminPushPanel.jsx'))

function Profile() {
    const { theme, themeMode, setThemePreference } = useTheme()
    const [profile, setProfile] = useState(null)
    const [plant, setPlant] = useState()
    const [history, setHistory] = useState()
    const [completion, setCompletion] = useState(null)
    const [passkeyCount, setPasskeyCount] = useState(null)
    const [passkeySupported, setPasskeySupported] = useState(false)
    const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)
    const [passkeyMessage, setPasskeyMessage] = useState('')
    const [passkeyError, setPasskeyError] = useState('')
    const [pushEnabled, setPushEnabled] = useState(false)
    const [pushLoading, setPushLoading] = useState(true)
    const [pushChanging, setPushChanging] = useState(false)
    const [pushError, setPushError] = useState('')
    const [morningSummaryEnabled, setMorningSummaryEnabled] = useState(false)
    const [summaryLoading, setSummaryLoading] = useState(true)
    const [summaryChanging, setSummaryChanging] = useState(false)
    const [summaryError, setSummaryError] = useState('')
    const [themeError, setThemeError] = useState('')
    const [themeChanging, setThemeChanging] = useState(false)

    const getProfile = useCallback(async () => {
        try {
            const response = await fetch(
                `${API_URL}/users/me`,
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                setProfile(data)
            }
        } catch (error) {
            console.error('Ошибка получения профиля:', error)
        }
    }, [])

    const getAllPlant = useCallback(async () => {
        try {
            const response = await fetch(
                `${API_URL}/plants/`,
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                const arr = data.length
                setPlant(arr)
            }
        } catch (error) {
            console.error('Ошибка получения расписания:', error)
        }
    }, [])

    const getPlantHistory = useCallback(async () => {
        try {
            const response = await fetch(
                `${API_URL}/plants/history`,
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                if (!Number.isInteger(data.total) || data.total < 0) {
                    throw new Error('Сервер вернул некорректное количество поливов')
                }
                setHistory(data.total)
            }
        } catch (error) {
            console.error('Ошибка получения истории:', error)
        }
    }, [])

    const getCompletion = useCallback(async () => {
        try {
            const res = await fetch(
                `${API_URL}/plants/stats/completion`,
                { method: 'GET', credentials: 'include' }
            )
            if (res.ok) {
                const data = await res.json()
                setCompletion(data)
            }
        } catch (e) {
            console.error('Ошибка completion:', e)
        }
    }, [])

    useEffect(() => {
        const loadProfileData = async () => {
            await Promise.all([
                getProfile(),
                getAllPlant(),
                getPlantHistory(),
                getCompletion()
            ])
        }

        loadProfileData()
    }, [getProfile, getAllPlant, getPlantHistory, getCompletion])

    useEffect(() => {
        let isMounted = true

        listPasskeys()
            .then(registeredPasskeys => {
                if (isMounted) setPasskeyCount(registeredPasskeys.length)
            })
            .catch(error => {
                if (!isMounted) return
                console.error('Ошибка загрузки ключей доступа:', error)
                setPasskeyError('Не удалось загрузить ключи доступа. Обновите страницу и попробуйте ещё раз.')
            })

        isPasskeySupported().then(supported => {
            if (isMounted) setPasskeySupported(supported)
        })

        return () => {
            isMounted = false
        }
    }, [])

    useEffect(() => {
        let isMounted = true

        fetch(`${API_URL}/users/me/notification-preferences`, {
            method: 'GET',
            credentials: 'include'
        })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }
                return response.json()
            })
            .then(preferences => {
                if (isMounted) {
                    setMorningSummaryEnabled(preferences.morning_summary_enabled === true)
                }
            })
            .catch(error => {
                console.error('Ошибка загрузки настроек уведомлений:', error)
                if (isMounted) setSummaryError('Не удалось загрузить настройку сводки.')
            })
            .finally(() => {
                if (isMounted) setSummaryLoading(false)
            })

        return () => {
            isMounted = false
        }
    }, [])

    useEffect(() => {
        let isMounted = true

        const loadPushState = async () => {
            if (!isPushSupported() || Notification.permission !== 'granted') {
                if (isMounted) setPushLoading(false)
                return
            }

            try {
                const registration = await navigator.serviceWorker.ready
                const subscription = await registration.pushManager.getSubscription()
                if (subscription) {
                    await subscribeToPush()
                    if (isMounted) setPushEnabled(true)
                }
            } catch (error) {
                console.error('Ошибка проверки push-подписки:', error)
                if (isMounted) {
                    setPushError('Не удалось проверить push-подписку. Попробуйте включить её ещё раз.')
                }
            } finally {
                if (isMounted) setPushLoading(false)
            }
        }

        loadPushState()
        return () => {
            isMounted = false
        }
    }, [])

    const handlePushChange = async event => {
        const shouldEnable = event.target.checked
        if (pushChanging) return

        setPushChanging(true)
        setPushError('')
        try {
            if (shouldEnable) {
                if (!isPushSupported()) {
                    throw new Error('Push-уведомления не поддерживаются этим браузером')
                }
                if (isIOS() && !isStandalone()) {
                    throw new Error('На iPhone или iPad сначала добавьте приложение на экран «Домой» и откройте его оттуда')
                }

                const granted = await requestPermission()
                if (!granted) {
                    throw new Error('Разрешение на уведомления не получено')
                }

                await subscribeToPush()
                setPushEnabled(true)
                return
            }

            await unsubscribeFromPush()
            setPushEnabled(false)
        } catch (error) {
            console.error('Ошибка изменения push-подписки:', error)
            setPushError(error.message || 'Не удалось изменить настройку push-уведомлений')
        } finally {
            setPushChanging(false)
        }
    }

    const handleMorningSummaryChange = async event => {
        const enabled = event.target.checked
        if (summaryChanging) return
        if (enabled && !pushEnabled) {
            setSummaryError('Сначала включите push-уведомления на этом устройстве.')
            return
        }

        setSummaryChanging(true)
        setSummaryError('')
        try {
            const response = await fetch(
                `${API_URL}/users/me/notification-preferences`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ morning_summary_enabled: enabled })
                }
            )
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `HTTP ${response.status}`)
            }

            const preferences = await response.json()
            setMorningSummaryEnabled(preferences.morning_summary_enabled === true)
        } catch (error) {
            console.error('Ошибка изменения утренней сводки:', error)
            setSummaryError(error.message || 'Не удалось изменить настройку сводки.')
        } finally {
            setSummaryChanging(false)
        }
    }

    const handleThemeChange = async nextTheme => {
        if (themeChanging || themeMode === nextTheme) return
        setThemeChanging(true)
        setThemeError('')
        try {
            await setThemePreference(nextTheme)
        } catch (error) {
            setThemeError(error.message || 'Не удалось сохранить тему оформления.')
        } finally {
            setThemeChanging(false)
        }
    }

    const handleRegisterPasskey = async () => {
        if (isRegisteringPasskey) return

        setIsRegisteringPasskey(true)
        setPasskeyError('')
        setPasskeyMessage('')

        try {
            await registerPasskey('Ключ доступа')
            setPasskeyCount(count => (count ?? 0) + 1)
            setPasskeyMessage('Ключ доступа создан. Теперь с его помощью можно входить в аккаунт.')
        } catch (error) {
            console.error('Ошибка создания ключа доступа:', error)
            setPasskeyError(error.message || 'Не удалось создать ключ доступа. Попробуйте ещё раз.')
        } finally {
            setIsRegisteringPasskey(false)
        }
    }

    if (!profile) {
        return <p>Загрузка...</p>
    }

    const displayName = profile.name?.trim() || profile.username || profile.email || '?'
    const isAdmin = profile.role === 'ADMIN'

    return (
        <div className='profilePage'>
            <div className='headerBlocskProfils'>
                <p>Личный кабинет</p>
            </div>
            <div className='blocksDescriptionProfile'>
                <div className='nameBlocksDescriptionProfile'>
                    <div className='imgOfName'>
                        <p>{displayName[0]?.toUpperCase() ?? '?'}</p>
                    </div>
                    <div className='descritpionOfProfile'>
                        <p>{displayName}</p>
                        <p>{profile.email}</p>
                        {isAdmin && <p className='adminProfileBadge'>Администратор</p>}
                    </div>
                </div>
                <Link to="/edit-profile" className='buttonOfEdProfile'>
                    <img src={Pencil} alt="" />
                    <p>Редактировать профиль</p>
                </Link>
            </div>
            <section className='passkeySettings' aria-labelledby='passkeySettingsTitle'>
                <h2 id='passkeySettingsTitle'>Вход с ключом доступа</h2>
                {passkeyError && <p className='passkeyMessage passkeyError' role='alert'>{passkeyError}</p>}
                {passkeyMessage && <p className='passkeyMessage' role='status'>{passkeyMessage}</p>}
                {passkeyCount === null ? (
                    !passkeyError && <p className='passkeyStatus'>Проверяем сохранённые ключи доступа...</p>
                ) : passkeyCount > 0 ? (
                    <p className='passkeyStatus'>
                        Ключ доступа уже добавлен. При следующем входе можно подтвердить личность Face ID, отпечатком пальца или способом, который предлагает устройство.
                    </p>
                ) : !passkeySupported ? (
                    <p className='passkeyStatus'>
                        Создание ключа доступа доступно на поддерживаемом устройстве и через защищённое HTTPS-соединение.
                    </p>
                ) : (
                    <>
                        <p className='passkeyStatus'>
                            Ключ ещё не создан. Добавьте его на этом устройстве, чтобы использовать биометрию или другой доступный способ подтверждения при входе.
                        </p>
                        <button
                            type='button'
                            className='passkeyCreateButton'
                            disabled={isRegisteringPasskey}
                            onClick={handleRegisterPasskey}
                        >
                            {isRegisteringPasskey ? 'Создание ключа...' : 'Создать ключ доступа'}
                        </button>
                    </>
                )}
            </section>
            <div className='informationOfProfile'>
                <div className='plantQuantity'>
                    <p>{plant}</p>
                    <p>Растений</p>
                </div>
                <div className='historyWaterPlant'>
                    <p>{history}</p>
                    <p>Поливов в истории</p>
                </div>
                <div className='interestPlant'>
                    {completion && <p>{completion.percent}%</p>}
                    <p>Поливов вовремя</p>
                </div>
            </div>
            {isAdmin && (
                <Suspense fallback={<p className='adminPushLoading' role='status'>Загружаем панель администратора…</p>}>
                    <AdminPushPanel />
                </Suspense>
            )}
            <div>
                <div className='gofOfHeaderOfAllPlants'>
                    <p className='HeaderOfAllPlants'>Мои растения</p>
                    <Link to="/my-plants" className='buttonOfPlant'>
                        <p>Все</p>
                    </Link>
                </div>
                <div>
                </div>
            </div>
            <div className='settingsNotification'>
                <p className='headerOfsettingsNotification'>Настройки напоминаний</p>
                <div className='pushSettings'>
                    <div>
                        <p>Push-уведомления</p>
                        <p role={pushError ? 'alert' : 'status'}>
                            {pushLoading
                                ? 'Проверяем подписку...'
                                : pushError || (!isPushSupported()
                                    ? 'Push-уведомления не поддерживаются этим браузером'
                                    : Notification.permission === 'denied'
                                        ? 'Уведомления заблокированы в настройках браузера'
                                        : isIOS() && !isStandalone()
                                            ? 'На iPhone добавьте приложение на экран «Домой»'
                                            : 'Напомним, когда пора полить')}
                        </p>
                    </div>
                    <label className='appleSwitchSettings'>
                        <input
                            type="checkbox"
                            checked={pushEnabled}
                            disabled={pushLoading || pushChanging || !isPushSupported()}
                            onChange={handlePushChange}
                            aria-label='Push-уведомления'
                            aria-busy={pushLoading || pushChanging}
                        />
                        <span className="sliderSettings"></span>
                    </label>
                </div>
                <div className='pushSettings'>
                    <div>
                        <p>Утренняя сводка</p>
                        <p role={summaryError ? 'alert' : 'status'}>
                            {summaryLoading
                                ? 'Проверяем настройку...'
                                : summaryError ||
                                (morningSummaryEnabled && !pushEnabled
                                    ? 'Включите push на этом устройстве для получения сводки'
                                    : 'Каждый день в 9:00 по Москве: растения к поливу')}
                        </p>
                    </div>
                    <label className='appleSwitchSettings'>
                        <input
                            type="checkbox"
                            checked={morningSummaryEnabled}
                            disabled={summaryLoading || summaryChanging || (!morningSummaryEnabled && !pushEnabled)}
                            onChange={handleMorningSummaryChange}
                            aria-label='Утренняя сводка'
                            aria-busy={summaryLoading || summaryChanging}
                        />
                        <span className="sliderSettings"></span>
                    </label>
                </div>
            </div>
            <div className='visualTheme'>
                <p>Тема оформления</p>
                {themeError && <p className='themePreferenceError' role='alert'>{themeError}</p>}
                <div className='selectThemeColor'>
                    <button
                        type='button'
                        className={themeMode === 'light' ? 'is-active' : ''}
                        aria-pressed={themeMode === 'light'}
                        disabled={themeChanging}
                        onClick={() => handleThemeChange('light')}
                    >
                        Светлая
                    </button>
                    <button
                        type='button'
                        className={themeMode === 'dark' ? 'is-active' : ''}
                        aria-pressed={themeMode === 'dark'}
                        disabled={themeChanging}
                        onClick={() => handleThemeChange('dark')}
                    >
                        Тёмная
                    </button>
                    <button
                        type='button'
                        className={themeMode === 'system' ? 'is-active' : ''}
                        aria-pressed={themeMode === 'system'}
                        disabled={themeChanging}
                        onClick={() => handleThemeChange('system')}
                    >
                        Системная
                    </button>
                </div>
                <p className='themeModeDescription'>
                    {themeMode === 'system'
                        ? `Сейчас используется ${theme === 'dark' ? 'тёмная' : 'светлая'} тема устройства`
                        : `Тема задана вручную: ${theme === 'dark' ? 'тёмная' : 'светлая'}`}
                </p>
            </div>
            <footer className='profileAppVersion'>
                Версия приложения {import.meta.env.VITE_APP_VERSION}
            </footer>
        </div>
    )
}

export default Profile