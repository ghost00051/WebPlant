import { useEffect, useRef, useState } from 'react'
import telegramIcon from '../../assets/messenger-telegram.svg'
import maxIcon from '../../assets/messenger-max.svg'
import mailIcon from '../../assets/mail.svg'
import {
  API_URL,
  createMessengerLinkCode,
  getMessengerChannels,
  isApiUnavailable,
  unlinkMessenger,
  updateMessengerPreferences
} from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'

const CHANNEL_ICONS = {
  telegram: telegramIcon,
  max: maxIcon
}

const CHANNEL_TITLES = {
  telegram: 'Telegram',
  max: 'MAX'
}

const USER_TIMEOUT_MS = 12000

function channelTitle(channel) {
  return channel?.title || CHANNEL_TITLES[channel?.channel] || 'Мессенджер'
}

function describeLoadError(error) {
  if (error?.status === 401) {
    return 'Нужно снова войти в аккаунт, чтобы настроить каналы.'
  }
  if (isApiUnavailable(error)) {
    return 'Настройка каналов пока недоступна: сервер ещё не обновился. Напоминания продолжат приходить в приложение.'
  }
  return error?.message || 'Не удалось загрузить каналы. Попробуйте ещё раз.'
}

function NotificationChannelsDialog({ onClose }) {
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadId, setReloadId] = useState(0)
  const [busy, setBusy] = useState('')
  const [channelErrors, setChannelErrors] = useState({})
  const [channelStatuses, setChannelStatuses] = useState({})
  const [linkCodes, setLinkCodes] = useState({})
  const [user, setUser] = useState(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMessage, setEmailMessage] = useState(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector('button')?.focus?.()
    })
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  useEffect(() => {
    let active = true

    getMessengerChannels()
      .then(data => {
        if (!active) return
        setChannels(data.channels)
      })
      .catch(error => {
        if (!active) return
        console.warn('Не удалось загрузить каналы уведомлений:', error)
        setLoadError(describeLoadError(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadId])

  const handleReload = () => {
    setLoading(true)
    setLoadError('')
    setReloadId(value => value + 1)
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), USER_TIMEOUT_MS)

    const loadUser = async () => {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/users/me`,
          { method: 'GET', credentials: 'include', signal: controller.signal },
          USER_TIMEOUT_MS
        )
        if (!response.ok) return
        const data = await response.json().catch(() => null)
        if (!cancelled && data && typeof data === 'object') setUser(data)
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('Не удалось загрузить почтовые настройки:', error)
        }
      } finally {
        window.clearTimeout(timer)
      }
    }

    loadUser()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const setChannelMessage = (channel, { error = '', status = '' } = {}) => {
    setChannelErrors(current => {
      const next = { ...current }
      if (error) next[channel] = error
      else delete next[channel]
      return next
    })
    setChannelStatuses(current => {
      const next = { ...current }
      if (status) next[channel] = status
      else delete next[channel]
      return next
    })
  }

  const refreshChannels = async () => {
    const data = await getMessengerChannels()
    setChannels(data.channels)
    return data.channels
  }

  const handleConnect = async channel => {
    if (busy) return
    setBusy(`link:${channel.channel}`)
    setChannelMessage(channel.channel)
    try {
      const code = await createMessengerLinkCode(channel.channel)
      setLinkCodes(current => ({ ...current, [channel.channel]: code }))
      setChannelMessage(channel.channel, {
        status: 'Код готов. Откройте бота по ссылке или отправьте ему код из сообщения.'
      })
    } catch (error) {
      setChannelMessage(channel.channel, {
        error: error?.message || 'Не удалось получить код подключения. Попробуйте ещё раз.'
      })
    } finally {
      setBusy('')
    }
  }

  const handleCheck = async channel => {
    if (busy) return
    setBusy(`check:${channel.channel}`)
    setChannelMessage(channel.channel)
    try {
      const nextChannels = await refreshChannels()
      const target = nextChannels.find(item => item.channel === channel.channel)
      if (target?.linked) {
        setLinkCodes(current => {
          const next = { ...current }
          delete next[channel.channel]
          return next
        })
        setChannelMessage(channel.channel, {
          status: `${channelTitle(target)} подключён. Напоминания будут приходить сюда.`
        })
      } else {
        setChannelMessage(channel.channel, {
          error: 'Пока не видим подключения. Отправьте боту код и нажмите «Проверить подключение» ещё раз.'
        })
      }
    } catch (error) {
      setChannelMessage(channel.channel, {
        error: error?.message || 'Не удалось проверить подключение. Попробуйте ещё раз.'
      })
    } finally {
      setBusy('')
    }
  }

  const handleUnlink = async channel => {
    if (busy) return
    setBusy(`unlink:${channel.channel}`)
    setChannelMessage(channel.channel)
    try {
      await unlinkMessenger(channel.channel)
      setChannels(current => current.map(item => (
        item.channel === channel.channel
          ? { ...item, linked: false, externalUsername: null, linkedAt: null, lastError: null }
          : item
      )))
      setLinkCodes(current => {
        const next = { ...current }
        delete next[channel.channel]
        return next
      })
      setChannelMessage(channel.channel, {
        status: `${channelTitle(channel)} отвязан. Подключить снова можно в любой момент.`
      })
    } catch (error) {
      setChannelMessage(channel.channel, {
        error: error?.message || 'Не удалось отвязать канал. Попробуйте ещё раз.'
      })
    } finally {
      setBusy('')
    }
  }

  const handleToggleChannel = async (channel, enabled) => {
    if (busy) return
    setBusy(`prefs:${channel.channel}`)
    setChannelMessage(channel.channel)
    try {
      const result = await updateMessengerPreferences(channel.channel, enabled)
      setChannels(current => current.map(item => (
        item.channel === channel.channel
          ? { ...item, notificationsEnabled: result.notificationsEnabled }
          : item
      )))
      setChannelMessage(channel.channel, {
        status: result.notificationsEnabled
          ? 'Напоминания снова будут приходить сюда.'
          : 'Напоминания в этот канал приостановлены. Подключение сохранится.'
      })
    } catch (error) {
      setChannelMessage(channel.channel, {
        error: error?.message || 'Не удалось сохранить настройку. Попробуйте ещё раз.'
      })
    } finally {
      setBusy('')
    }
  }

  const handleEmailToggle = async enabled => {
    if (emailBusy) return
    setEmailBusy(true)
    setEmailMessage(null)
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/users/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ marketing_email_opt_in: enabled })
        },
        USER_TIMEOUT_MS
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if ([400, 404, 405, 501, 503].includes(response.status)) {
          setEmailMessage({
            tone: 'warning',
            text: 'Сервер пока не поддерживает переключение писем. Отписаться можно из любого письма.'
          })
          return
        }
        throw new Error(data.message || `Не удалось сохранить настройку (HTTP ${response.status})`)
      }
      const nextValue = data?.user?.marketing_email_opt_in ?? data?.marketing_email_opt_in
      if (typeof nextValue !== 'boolean' || nextValue !== enabled) {
        setUser(current => (current ? { ...current, marketing_email_opt_in: enabled } : current))
        setEmailMessage({
          tone: 'warning',
          text: 'Сервер пока не поддерживает переключение писем. Напишите в поддержку или отпишитесь из любого письма.'
        })
        return
      }
      setUser(current => (current ? { ...current, marketing_email_opt_in: nextValue } : current))
      setEmailMessage({
        tone: 'success',
        text: nextValue
          ? 'Письма о растениях включены. Отписаться можно в любом письме.'
          : 'Письма о растениях отключены.'
      })
    } catch (error) {
      setEmailMessage({
        tone: 'error',
        text: error?.message || 'Не удалось сохранить почтовую настройку. Попробуйте ещё раз.'
      })
    } finally {
      setEmailBusy(false)
    }
  }

  const emailEnabled = user?.marketing_email_opt_in === true
  const emailKnown = Boolean(user)

  return (
    <div
      className='notificationsSheetOverlay'
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className='notificationsSheet'
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='notificationChannelsTitle'
      >
        <header className='notificationsSheetHeader'>
          <h2 id='notificationChannelsTitle'>Каналы уведомлений</h2>
          <button
            type='button'
            className='notificationsSheetClose'
            onClick={onClose}
            aria-label='Закрыть настройки каналов'
          >
            ×
          </button>
        </header>

        <p className='notificationsSheetText'>
          Напоминания приходят в приложение. Дополнительно можно получать их в
          мессенджере или на почту — выберите удобные каналы.
        </p>

        {loading ? (
          <p className='notificationsSheetStatus' role='status'>Загружаем каналы…</p>
        ) : loadError ? (
          <div className='notificationsSheetError' role='alert'>
            <p>{loadError}</p>
            <button
              type='button'
              className='notificationsSheetRetry'
              onClick={handleReload}
            >
              Проверить снова
            </button>
          </div>
        ) : (
          <ul className='notificationsChannelList'>
            {channels.map(channel => {
              const title = channelTitle(channel)
              const icon = CHANNEL_ICONS[channel.channel]
              const linkCode = linkCodes[channel.channel]
              const isBusy = busy.endsWith(`:${channel.channel}`)
              const error = channelErrors[channel.channel]
              const status = channelStatuses[channel.channel]

              return (
                <li
                  key={channel.channel}
                  className={`notificationsChannel${channel.linked ? ' is-linked' : ''}`}
                >
                  <div className='notificationsChannelHead'>
                    <span className='notificationsChannelIcon' aria-hidden='true'>
                      <img src={icon} alt='' />
                    </span>
                    <div className='notificationsChannelHeading'>
                      <h3>{title}</h3>
                      <p className='notificationsChannelState'>
                        {!channel.configured
                          ? 'Канал пока не настроен на сервере'
                          : channel.linked
                            ? `Подключён${channel.externalUsername ? ` · @${String(channel.externalUsername).replace(/^@/, '')}` : ''}`
                            : 'Не подключён'}
                      </p>
                    </div>
                  </div>

                  {!channel.configured ? (
                    <p className='notificationsChannelText'>
                      Как только канал включат на сервере, здесь появится кнопка подключения.
                    </p>
                  ) : channel.linked ? (
                    <>
                      <div className='notificationsChannelToggleRow'>
                        <span className='notificationsChannelToggleText'>
                          Присылать напоминания сюда
                        </span>
                        <label className='notificationsSwitch'>
                          <input
                            type='checkbox'
                            checked={channel.notificationsEnabled}
                            disabled={Boolean(busy)}
                            aria-label={`Присылать напоминания в ${title}`}
                            onChange={event => handleToggleChannel(channel, event.target.checked)}
                          />
                          <span className='notificationsSwitchTrack' aria-hidden='true' />
                        </label>
                      </div>
                      <div className='notificationsChannelActions'>
                        <button
                          type='button'
                          className='notificationsChannelButton notificationsChannelButton--ghost'
                          onClick={() => handleUnlink(channel)}
                          disabled={Boolean(busy)}
                        >
                          {isBusy && busy.startsWith('unlink:') ? 'Отвязываем…' : 'Отвязать'}
                        </button>
                      </div>
                    </>
                  ) : linkCode ? (
                    <>
                      <p className='notificationsChannelText'>
                        Откройте бота по ссылке — подключение произойдёт автоматически.
                        Если бот не открылся, отправьте ему код.
                      </p>
                      <p className='notificationsChannelCode' aria-label={`Код подключения ${linkCode.code}`}>
                        {linkCode.code}
                      </p>
                      <div className='notificationsChannelActions'>
                        <a
                          className='notificationsChannelButton notificationsChannelButton--primary'
                          href={linkCode.deepLink}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          Открыть {title}
                        </a>
                        <button
                          type='button'
                          className='notificationsChannelButton notificationsChannelButton--secondary'
                          onClick={() => handleCheck(channel)}
                          disabled={Boolean(busy)}
                        >
                          {isBusy && busy.startsWith('check:') ? 'Проверяем…' : 'Проверить подключение'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className='notificationsChannelActions'>
                      <button
                        type='button'
                        className='notificationsChannelButton notificationsChannelButton--primary'
                        onClick={() => handleConnect(channel)}
                        disabled={Boolean(busy)}
                      >
                        {isBusy && busy.startsWith('link:') ? 'Получаем код…' : 'Подключить'}
                      </button>
                    </div>
                  )}

                  {status && (
                    <p className='notificationsChannelMessage' role='status'>{status}</p>
                  )}
                  {error && (
                    <p className='notificationsChannelMessage notificationsChannelMessage--error' role='alert'>
                      {error}
                    </p>
                  )}
                </li>
              )
            })}

            <li className={`notificationsChannel${emailEnabled ? ' is-linked' : ''}`}>
              <div className='notificationsChannelHead'>
                <span className='notificationsChannelIcon' aria-hidden='true'>
                  <img src={mailIcon} alt='' />
                </span>
                <div className='notificationsChannelHeading'>
                  <h3>Почта</h3>
                  <p className='notificationsChannelState'>
                    {emailKnown
                      ? emailEnabled
                        ? `Письма включены${user.email ? ` · ${user.email}` : ''}`
                        : 'Письма о растениях отключены'
                      : 'Проверяем настройки почты…'}
                  </p>
                </div>
              </div>
              <p className='notificationsChannelText'>
                Редкие письма о растениях и новостях «Лейки». Отписаться можно в один клик в любом письме.
              </p>
              <div className='notificationsChannelToggleRow'>
                <span className='notificationsChannelToggleText'>Получать письма</span>
                <label className='notificationsSwitch'>
                  <input
                    type='checkbox'
                    checked={emailEnabled}
                    disabled={!emailKnown || emailBusy}
                    aria-label='Получать письма о растениях'
                    onChange={event => handleEmailToggle(event.target.checked)}
                  />
                  <span className='notificationsSwitchTrack' aria-hidden='true' />
                </label>
              </div>
              {emailMessage && (
                <p
                  className={`notificationsChannelMessage notificationsChannelMessage--${emailMessage.tone}`}
                  role={emailMessage.tone === 'error' ? 'alert' : 'status'}
                >
                  {emailMessage.text}
                </p>
              )}
            </li>
          </ul>
        )}

        <div className='notificationsSheetActions'>
          <button
            type='button'
            className='notificationsSheetDone'
            onClick={onClose}
          >
            Готово
          </button>
        </div>
      </section>
    </div>
  )
}

export default NotificationChannelsDialog
