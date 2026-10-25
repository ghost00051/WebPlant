import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './profile.css'
import Pencil from '../../assets/pencil.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import {
  isPasskeySupported,
  listPasskeys,
  registerPasskey
} from '../../utils/passkey.js'
import {
  getActivePushSubscription,
  isIOS,
  isPushSupported,
  isStandalone,
  requestPermission,
  setPushDisabledOnThisDevice,
  subscribeToPush,
  syncPushSubscription,
  unsubscribeFromPush
} from '../../utils/pushNotifications.js'
import { TAB_ELEMENT_ID, TAB_PANEL_ID } from '../tools/tabs.js'
import { API_URL } from '../../utils/api.js'
import { openCookieConsentSettings } from '../../utils/cookieConsentSettings.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { FEEDBACK_EMAIL, FEEDBACK_MAILTO } from '../../utils/feedback.js'
import { useTheme } from '../../context/useTheme.js'
import GardenShareCard from '../gardenShare/GardenShareCard.jsx'
import MessengerBots from '../messengerBots/MessengerBots.jsx'
import { clearOfflineApiCache } from '../../utils/offlineQueue.js'
import './dark-theme.css'

const AdminPushPanel = lazy(() => import('../adminPush/AdminPushPanel.jsx'))
const AdminMailPanel = lazy(() => import('../adminMail/AdminMailPanel.jsx'))

function Profile () {
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
  const [careAdviceEnabled, setCareAdviceEnabled] = useState(true)
  const [careAdviceLoading, setCareAdviceLoading] = useState(true)
  const [careAdviceChanging, setCareAdviceChanging] = useState(false)
  const [careAdviceError, setCareAdviceError] = useState('')
  const [themeError, setThemeError] = useState('')
  const [themeChanging, setThemeChanging] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [exportError, setExportError] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteTriggerRef = useRef(null)
  const deleteDialogRef = useRef(null)
  const deleteInputRef = useRef(null)
  const navigate = useNavigate()

  const getProfile = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/users/me`, {
        method: 'GET',
        credentials: 'include'
      })
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
      const response = await fetch(`${API_URL}/plants/`, {
        method: 'GET',
        credentials: 'include'
      })
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
      const response = await fetch(`${API_URL}/plants/history`, {
        method: 'GET',
        credentials: 'include'
      })
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
      const res = await fetch(`${API_URL}/plants/stats/completion`, {
        method: 'GET',
        credentials: 'include'
      })
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
        setPasskeyError(
          'Не удалось загрузить ключи доступа. Обновите страницу и попробуйте ещё раз.'
        )
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
          setCareAdviceEnabled(preferences.care_advice_enabled !== false)
        }
      })
      .catch(error => {
        console.error('Ошибка загрузки настроек уведомлений:', error)
        if (isMounted) setSummaryError('Не удалось загрузить настройку сводки.')
      })
      .finally(() => {
        if (isMounted) {
          setSummaryLoading(false)
          setCareAdviceLoading(false)
        }
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
        const subscription = await getActivePushSubscription()
        if (!isMounted) return

        if (!subscription) {
          setPushEnabled(false)
          return
        }

        setPushEnabled(true)


        await syncPushSubscription({
          onError: error => {
            if (isMounted) {
              setPushError(
                error?.message ||
                  'Не удалось синхронизировать push-подписку с сервером. Включите уведомления ещё раз.'
              )
            }
          }
        })
      } catch (error) {
        console.error('Ошибка проверки push-подписки:', error)
        if (isMounted) {
          setPushError(
            'Не удалось проверить push-подписку. Попробуйте включить её ещё раз.'
          )
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
          throw new Error(
            'На iPhone или iPad сначала добавьте приложение на экран «Домой» и откройте его оттуда'
          )
        }

        const granted = await requestPermission()
        if (!granted) {
          throw new Error(
            'Разрешение на уведомления не получено. Разрешите уведомления в настройках браузера и попробуйте включить ещё раз.'
          )
        }

        await subscribeToPush()
        setPushDisabledOnThisDevice(false)
        setPushEnabled(true)
        return
      }

      let unsubscribeError = null
      try {
        await unsubscribeFromPush()
      } catch (error) {
        unsubscribeError = error
      }



      setPushDisabledOnThisDevice(true)
      setPushEnabled(false)
      if (unsubscribeError) {
        setPushError(
          unsubscribeError.message ||
            'Локально уведомления отключены, но не удалось сообщить серверу. Позже подписка будет удалена автоматически.'
        )
      }
    } catch (error) {
      console.error('Ошибка изменения push-подписки:', error)
      setPushError(
        error.message || 'Не удалось изменить настройку push-уведомлений'
      )
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

  const handleCareAdviceChange = async event => {
    const enabled = event.target.checked
    if (careAdviceChanging) return

    setCareAdviceChanging(true)
    setCareAdviceError('')
    try {
      const response = await fetch(
        `${API_URL}/users/me/notification-preferences`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ care_advice_enabled: enabled })
        }
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      const preferences = await response.json()
      setCareAdviceEnabled(preferences.care_advice_enabled !== false)
    } catch (error) {
      console.error('Ошибка изменения советов по уходу:', error)
      setCareAdviceError(error.message || 'Не удалось изменить настройку советов.')
    } finally {
      setCareAdviceChanging(false)
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
      setPasskeyMessage(
        'Ключ доступа создан. Теперь с его помощью можно входить в аккаунт.'
      )
    } catch (error) {
      console.error('Ошибка создания ключа доступа:', error)
      setPasskeyError(
        error.message || 'Не удалось создать ключ доступа. Попробуйте ещё раз.'
      )
    } finally {
      setIsRegisteringPasskey(false)
    }
  }
  const exitOfProduct = async () => {
    setLogoutError('')

    await Promise.race([
      unsubscribeFromPush().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]).catch(() => {})
    try {
      const response = await fetchWithTimeout(`${API_URL}/users/logout`, {
        method: 'POST',
        credentials: 'include'
      })
      if (!response.ok) {
        throw new Error(`Не удалось выйти из аккаунта: HTTP ${response.status}`)
      }
    } catch (error) {
      console.error('Ошибка выхода:', error)
      setLogoutError(
        error.message || 'Не удалось выйти из аккаунта. Попробуйте ещё раз.'
      )
      return
    }
    void clearOfflineApiCache()
    navigate('/login')
  }

  const exportData = async () => {
    if (exportBusy) return

    setExportBusy(true)
    setExportStatus('')
    setExportError('')
    try {
      const response = await fetchWithTimeout(`${API_URL}/users/me/export`, {
        method: 'GET',
        credentials: 'include'
      })
      if (response.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          throw new Error(
            'Экспорт данных пока недоступен. Функция появится после обновления сервера.'
          )
        }
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data.message || `Не удалось подготовить экспорт: HTTP ${response.status}`
        )
      }
      const data = await response.json().catch(() => null)
      if (!data || typeof data !== 'object') {
        throw new Error('Сервер вернул некорректные данные для экспорта.')
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      })
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `leyka-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)

      setExportStatus('Файл с вашими данными скачивается.')
    } catch (error) {
      console.error('Ошибка экспорта данных:', error)
      setExportError(error.message || 'Не удалось экспортировать данные. Попробуйте ещё раз.')
    } finally {
      setExportBusy(false)
    }
  }

  const openDeleteDialog = () => {
    if (deleteBusy) return
    setDeleteConfirmText('')
    setDeleteError('')
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (deleteBusy) return
    setDeleteDialogOpen(false)
    setDeleteError('')
    deleteTriggerRef.current?.focus?.()
  }

  const confirmDeleteAccount = async () => {
    if (deleteBusy) return
    if (deleteConfirmText.trim().toUpperCase() !== 'УДАЛИТЬ') {
      setDeleteError('Введите слово УДАЛИТЬ, чтобы подтвердить удаление.')
      return
    }

    setDeleteBusy(true)
    setDeleteError('')
    try {
      const response = await fetchWithTimeout(`${API_URL}/users/me`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          throw new Error(
            'Удаление аккаунта пока недоступно. Функция появится после обновления сервера.'
          )
        }
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data.message || `Не удалось удалить аккаунт: HTTP ${response.status}`
        )
      }

      setDeleteDialogOpen(false)
      await fetchWithTimeout(`${API_URL}/users/logout`, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => {})
      void clearOfflineApiCache()
      navigate('/', { replace: true })
    } catch (error) {
      console.error('Ошибка удаления аккаунта:', error)
      setDeleteError(error.message || 'Не удалось удалить аккаунт. Попробуйте ещё раз.')
    } finally {
      setDeleteBusy(false)
    }
  }

  useEffect(() => {
    if (!deleteDialogOpen) return undefined

    const dialog = deleteDialogRef.current
    const previouslyFocused = deleteTriggerRef.current
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const getFocusable = () =>
      Array.from(dialog?.querySelectorAll(focusableSelector) ?? [])
        .filter(element => element.offsetParent !== null)

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!deleteBusy) {
          setDeleteDialogOpen(false)
          setDeleteError('')
          deleteTriggerRef.current?.focus?.()
        }
        return
      }
      if (event.key !== 'Tab') return

      const items = getFocusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const frame = window.requestAnimationFrame(() => deleteInputRef.current?.focus?.())

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [deleteDialogOpen, deleteBusy])


  if (!profile) {
    return (
      <div
        className='profilePage'
        role='tabpanel'
        id={TAB_PANEL_ID('profile')}
        aria-labelledby={TAB_ELEMENT_ID('profile')}
      >
        <p>Загрузка...</p>
      </div>
    )
  }

  const displayName =
    profile.name?.trim() || profile.username || profile.email || '?'
  const isAdmin = profile.role === 'ADMIN'

  return (
    <div
      className='profilePage'
      role='tabpanel'
      id={TAB_PANEL_ID('profile')}
      aria-labelledby={TAB_ELEMENT_ID('profile')}
    >
      <div className='headerBlocskProfils'>
        <h1>Личный кабинет</h1>
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
        <Link to='/edit-profile' className='buttonOfEdProfile'>
          <ThemedIcon src={Pencil} alt='' />
          <p>Редактировать профиль</p>
        </Link>
      </div>
      <section
        className='passkeySettings'
        aria-labelledby='passkeySettingsTitle'
      >
        <h2 id='passkeySettingsTitle'>Вход с ключом доступа</h2>
        {passkeyError && (
          <p className='passkeyMessage passkeyError' role='alert'>
            {passkeyError}
          </p>
        )}
        {passkeyMessage && (
          <p className='passkeyMessage' role='status'>
            {passkeyMessage}
          </p>
        )}
        {passkeyCount === null ? (
          !passkeyError && (
            <p className='passkeyStatus'>
              Проверяем сохранённые ключи доступа...
            </p>
          )
        ) : passkeyCount > 0 ? (
          <p className='passkeyStatus'>
            Ключ доступа уже добавлен. При следующем входе можно подтвердить
            личность Face ID, отпечатком пальца или способом, который предлагает
            устройство.
          </p>
        ) : !passkeySupported ? (
          <p className='passkeyStatus'>
            Создание ключа доступа доступно на поддерживаемом устройстве и через
            защищённое HTTPS-соединение.
          </p>
        ) : (
          <>
            <p className='passkeyStatus'>
              Ключ ещё не создан. Добавьте его на этом устройстве, чтобы
              использовать биометрию или другой доступный способ подтверждения
              при входе.
            </p>
            <button
              type='button'
              className='passkeyCreateButton'
              disabled={isRegisteringPasskey}
              onClick={handleRegisterPasskey}
            >
              {isRegisteringPasskey
                ? 'Создание ключа...'
                : 'Создать ключ доступа'}
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
          <p className='interestPlantValue'>
            {Number.isFinite(completion?.percent) ? `${completion.percent}%` : '—'}
          </p>
          <p>Поливов вовремя</p>
          {!Number.isFinite(completion?.percent) && (
            <p className='interestPlantHint'>
              {completion
                ? 'Появится после первого полива.'
                : 'Считаем статистику…'}
            </p>
          )}
        </div>
      </div>
      <div className='gofOfHeaderOfAllPlants'>
        <p className='HeaderOfAllPlants'>Мои растения</p>
        <Link to='/my-plants' className='buttonOfPlant'>
          Все растения
          {Number.isInteger(plant) ? ` (${plant})` : ''}
        </Link>
      </div>
      {isAdmin && (
        <Suspense
          fallback={
            <p className='adminPushLoading' role='status'>
              Загружаем панель администратора…
            </p>
          }
        >
          <AdminPushPanel />
          <AdminMailPanel />
        </Suspense>
      )}
      <div className='settingsNotification'>
        <p className='headerOfsettingsNotification'>Настройки напоминаний</p>
        <div className='pushSettings'>
          <div>
            <p>Push-уведомления</p>
            <p role={pushError ? 'alert' : 'status'}>
              {pushLoading
                ? 'Проверяем подписку...'
                : pushError ||
                  (!isPushSupported()
                    ? 'Push-уведомления не поддерживаются этим браузером'
                    : Notification.permission === 'denied'
                    ? isIOS()
                      ? 'Уведомления отключены. Откройте «Настройки» → «Уведомления» → «Лейка», разрешите их и вернитесь в приложение.'
                      : 'Уведомления отключены. Нажмите на значок замка/«Настройки сайта» в адресной строке, разрешите уведомления и обновите страницу.'
                    : isIOS() && !isStandalone()
                    ? 'На iPhone добавьте приложение на экран «Домой»'
                    : 'Напомним, когда пора полить')}
            </p>
          </div>
          <label className='appleSwitchSettings'>
            <input
              type='checkbox'
              checked={pushEnabled}
              disabled={pushLoading || pushChanging || !isPushSupported() || Notification.permission === 'denied'}
              onChange={handlePushChange}
              aria-label='Push-уведомления'
              aria-busy={pushLoading || pushChanging}
            />
            <span className='sliderSettings'></span>
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
                    : 'Каждый день в 9:00 по вашему часовому поясу: растения к поливу')}
            </p>
          </div>
          <label className='appleSwitchSettings'>
            <input
              type='checkbox'
              checked={morningSummaryEnabled}
              disabled={
                summaryLoading ||
                summaryChanging ||
                (!morningSummaryEnabled && !pushEnabled)
              }
              onChange={handleMorningSummaryChange}
              aria-label='Утренняя сводка'
              aria-busy={summaryLoading || summaryChanging}
            />
            <span className='sliderSettings'></span>
          </label>
        </div>
        <div className='pushSettings'>
          <div>
            <p>Советы по уходу</p>
            <p role={careAdviceError ? 'alert' : 'status'}>
              {careAdviceLoading
                ? 'Проверяем настройку...'
                : careAdviceError ||
                  (careAdviceEnabled
                    ? 'Когда пора подкормить, увлажнить или осмотреть растение — с учётом сезона и лимитов'
                    : 'Советы по уходу отключены')}
            </p>
          </div>
          <label className='appleSwitchSettings'>
            <input
              type='checkbox'
              checked={careAdviceEnabled}
              disabled={careAdviceLoading || careAdviceChanging}
              onChange={handleCareAdviceChange}
              aria-label='Советы по уходу'
              aria-busy={careAdviceLoading || careAdviceChanging}
            />
            <span className='sliderSettings'></span>
          </label>
        </div>
      </div>
      <MessengerBots />
      <div className='visualTheme'>
        <p>Тема оформления</p>
        {themeError && (
          <p className='themePreferenceError' role='alert'>
            {themeError}
          </p>
        )}
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
            ? `Сейчас используется ${
                theme === 'dark' ? 'тёмная' : 'светлая'
              } тема устройства`
            : `Тема задана вручную: ${theme === 'dark' ? 'тёмная' : 'светлая'}`}
        </p>
      </div>
      <GardenShareCard />
      <section className='accountData' aria-labelledby='cookieSettingsTitle'>
        <h2 id='cookieSettingsTitle'>Cookie и аналитика</h2>
        <p className='accountDataText'>
          Обязательные файлы cookie нужны для работы приложения, аналитика
          включается только с вашего согласия. Здесь можно включить аналитику
          или отозвать согласие в любой момент — выбор применяется сразу.
        </p>
        <div className='accountDataActions'>
          <button
            type='button'
            className='accountDataExport'
            aria-haspopup='dialog'
            onClick={openCookieConsentSettings}
          >
            Настройки cookie
          </button>
        </div>
      </section>
      <section className='accountData' aria-labelledby='accountDataTitle'>
        <h2 id='accountDataTitle'>Данные и аккаунт</h2>
        <p className='accountDataText'>
          Скачайте копию своих данных в формате JSON или удалите аккаунт вместе
          со всеми растениями и историей полива.
        </p>
        <div className='accountDataActions'>
          <button
            type='button'
            className='accountDataExport'
            onClick={exportData}
            disabled={exportBusy}
            aria-busy={exportBusy}
          >
            {exportBusy ? 'Готовим файл…' : 'Экспорт данных'}
          </button>
          <button
            type='button'
            className='accountDataDelete'
            ref={deleteTriggerRef}
            onClick={openDeleteDialog}
            disabled={deleteBusy}
          >
            Удалить аккаунт
          </button>
        </div>
        {exportStatus && (
          <p className='accountDataStatus' role='status'>
            {exportStatus}
          </p>
        )}
        {exportError && (
          <p className='accountDataError' role='alert'>
            {exportError}
          </p>
        )}
      </section>
      <div className='exitButton'>
        {logoutError && (
          <p className='themePreferenceError' role='alert'>
            {logoutError}
          </p>
        )}
        <button onClick={() => exitOfProduct()}>Выйти</button>
      </div>
      {deleteDialogOpen && (
        <div
          className='accountDialogOverlay'
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeDeleteDialog()
          }}
        >
          <section
            className='accountDialog'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='deleteAccountTitle'
            aria-describedby='deleteAccountDescription'
            ref={deleteDialogRef}
          >
            <h2 id='deleteAccountTitle'>Удалить аккаунт безвозвратно?</h2>
            <p id='deleteAccountDescription'>
              Будут удалены профиль, растения, история полива и настройки.
              Отменить это действие нельзя. Копию данных можно сохранить заранее
              кнопкой «Экспорт данных».
            </p>
            <label className='accountDialogLabel' htmlFor='deleteAccountConfirm'>
              Введите слово УДАЛИТЬ, чтобы подтвердить
            </label>
            <input
              id='deleteAccountConfirm'
              ref={deleteInputRef}
              className='accountDialogInput'
              type='text'
              autoComplete='off'
              spellCheck={false}
              value={deleteConfirmText}
              onChange={event => {
                setDeleteConfirmText(event.target.value)
                if (deleteError) setDeleteError('')
              }}
              aria-invalid={deleteError ? 'true' : undefined}
              aria-describedby={deleteError ? 'deleteAccountError' : undefined}
            />
            {deleteError && (
              <p className='accountDialogError' id='deleteAccountError' role='alert'>
                {deleteError}
              </p>
            )}
            <div className='accountDialogActions'>
              <button type='button' onClick={closeDeleteDialog} disabled={deleteBusy}>
                Отмена
              </button>
              <button
                type='button'
                className='accountDialogConfirm'
                onClick={confirmDeleteAccount}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'Удаляем…' : 'Удалить аккаунт'}
              </button>
            </div>
          </section>
        </div>
      )}
      <footer className='profileAppVersion'>
        <p>Версия приложения {import.meta.env.VITE_APP_VERSION}</p>
        <p className='profileFeedback'>
          Нашли баг или хотите предложить что-то своё? Напишите на{' '}
          <a href={FEEDBACK_MAILTO}>{FEEDBACK_EMAIL}</a>
          <small>С уважением, разработчик Иван</small>
        </p>
      </footer>
    </div>
  )
}

export default Profile
