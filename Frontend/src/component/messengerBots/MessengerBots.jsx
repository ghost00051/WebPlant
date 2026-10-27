import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createMessengerLinkCode,
  getMessengerChannels,
  isApiUnavailable,
  unlinkMessenger,
  updateMessengerPreferences
} from '../../utils/api.js'
import { monthGenitive } from '../../utils/date.js'
import telegramIcon from '../../assets/messenger-telegram.svg'
import maxIcon from '../../assets/messenger-max.svg'
import './messengerBots.css'
import './dark-theme.css'

const CHECK_INTERVAL_MS = 4_000
const CHECK_TIMEOUT_MS = 120_000
const COPY_FEEDBACK_MS = 2_500

const CHANNEL_ICONS = {
  telegram: telegramIcon,
  max: maxIcon
}

const CHANNEL_HINTS = {
  telegram:
    'Напоминания о поливе, советы по уходу и итоги недели будут приходить в чат с ботом «Лейка».',
  max:
    'Напоминания о поливе, советы по уходу и итоги недели будут приходить в чат с ботом «Лейка» в MAX.'
}

const CHANNEL_TITLES = {
  telegram: 'Telegram',
  max: 'MAX'
}

function channelTitle (channel) {
  return channel?.title || CHANNEL_TITLES[channel?.channel] || 'Мессенджер'
}

function formatUsername (value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function formatDate (value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getDate()} ${monthGenitive(date)}`
}

function formatClock (value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function expiresLabel (linkCode, ttlMinutes) {
  const clock = formatClock(linkCode?.expiresAt)
  if (clock) return `Код действует до ${clock}. Если не успели — получите новый.`
  const minutes = Math.max(1, Math.round(Number(ttlMinutes) || 15))
  return `Код действует ${minutes} минут. Если не успели — получите новый.`
}

function describeLoadError (error) {
  if (error?.status === 401) {
    return 'Нужно снова войти в аккаунт, чтобы настроить мессенджеры.'
  }
  if (error?.code === 'network' || error?.code === 'timeout') {
    return 'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.'
  }
  if (isApiUnavailable(error)) {
    return 'Подключение мессенджеров пока недоступно: сервер ещё не обновился. Напоминания продолжат приходить в приложение.'
  }
  return error?.message || 'Не удалось загрузить настройки мессенджеров. Попробуйте ещё раз.'
}

function describeActionError (error, fallback) {
  if (error?.status === 401) return 'Нужно снова войти в аккаунт.'
  if (error?.status === 429) {
    return 'Слишком много попыток. Подождите немного и попробуйте ещё раз.'
  }
  return error?.message || fallback
}

function MessengerBots ({ headingLevel = 'h2' }) {
  const HeadingTag = headingLevel === 'h3' ? 'h3' : 'h2'
  const [channels, setChannels] = useState([])
  const [linkCodeTtlMinutes, setLinkCodeTtlMinutes] = useState(15)
  const [linkCodes, setLinkCodes] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadId, setReloadId] = useState(0)
  const [busy, setBusy] = useState('')
  const [channelErrors, setChannelErrors] = useState({})
  const [channelStatuses, setChannelStatuses] = useState({})
  const [confirmUnlink, setConfirmUnlink] = useState('')
  const [pollingChannel, setPollingChannel] = useState('')
  const [copiedChannel, setCopiedChannel] = useState('')
  const copyTimerRef = useRef(null)

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    let active = true

    getMessengerChannels()
      .then(data => {
        if (!active) return
        setChannels(data.channels)
        setLinkCodeTtlMinutes(data.linkCodeTtlMinutes)
      })
      .catch(error => {
        if (!active) return
        console.warn('Не удалось загрузить настройки мессенджеров:', error)
        setLoadError(describeLoadError(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadId])

  const refreshChannels = useCallback(async () => {
    const data = await getMessengerChannels()
    setChannels(data.channels)
    setLinkCodeTtlMinutes(data.linkCodeTtlMinutes)
    return data.channels
  }, [])

  const clearChannelMessages = useCallback(channel => {
    setChannelErrors(current => {
      if (!(channel in current)) return current
      const next = { ...current }
      delete next[channel]
      return next
    })
    setChannelStatuses(current => {
      if (!(channel in current)) return current
      const next = { ...current }
      delete next[channel]
      return next
    })
  }, [])

  const showChannelError = useCallback((channel, message) => {
    setChannelErrors(current => ({ ...current, [channel]: message }))
  }, [])

  const showChannelStatus = useCallback((channel, message) => {
    setChannelStatuses(current => ({ ...current, [channel]: message }))
  }, [])

  useEffect(() => {
    if (!pollingChannel) return undefined

    const channel = pollingChannel
    const startedAt = Date.now()
    let cancelled = false
    let finished = false

    const finish = message => {
      if (finished) return
      finished = true
      if (message) showChannelStatus(channel, message)
      if (!cancelled) setPollingChannel('')
    }

    const tick = async () => {
      if (cancelled || finished) return

      try {
        const nextChannels = await refreshChannels()
        if (cancelled || finished) return

        const target = nextChannels.find(item => item.channel === channel)
        if (target?.linked) {
          setLinkCodes(current => {
            if (!(channel in current)) return current
            const next = { ...current }
            delete next[channel]
            return next
          })
          finish(`${channelTitle(target)} подключён. Напоминания будут приходить сюда.`)
          return
        }
      } catch (error) {
        console.warn('Не удалось проверить подключение мессенджера:', error)
      }

      if (Date.now() - startedAt >= CHECK_TIMEOUT_MS) {
        finish(
          'Пока не видим подключения. Отправьте боту код из сообщения выше и нажмите «Проверить подключение» ещё раз.'
        )
      }
    }

    void tick()
    const interval = window.setInterval(() => {
      void tick()
    }, CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [pollingChannel, refreshChannels, showChannelStatus])

  const handleReload = () => {
    if (loading) return
    setLoading(true)
    setLoadError('')
    setReloadId(value => value + 1)
  }

  const handleConnect = async channel => {
    if (!channel?.configured || busy) return

    setBusy(`link:${channel.channel}`)
    clearChannelMessages(channel.channel)

    try {
      const linkCode = await createMessengerLinkCode(channel.channel)
      setLinkCodes(current => ({ ...current, [channel.channel]: linkCode }))
      showChannelStatus(
        channel.channel,
        'Код готов. Откройте бота по ссылке или отправьте ему код — и нажмите «Проверить подключение».'
      )
    } catch (error) {
      console.warn('Не удалось получить код подключения:', error)
      showChannelError(
        channel.channel,
        describeActionError(
          error,
          'Не удалось получить код подключения. Попробуйте ещё раз.'
        )
      )
    } finally {
      setBusy('')
    }
  }

  const handleCheck = channel => {
    if (!channel || busy || pollingChannel) return
    clearChannelMessages(channel.channel)
    setPollingChannel(channel.channel)
  }

  const handleCopyCode = async (channel, code) => {
    if (!code) return

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API недоступен')
      }
      await navigator.clipboard.writeText(code)
      setCopiedChannel(channel)
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedChannel(current => (current === channel ? '' : current))
      }, COPY_FEEDBACK_MS)
    } catch (error) {
      console.warn('Не удалось скопировать код подключения:', error)
      showChannelError(
        channel,
        'Не удалось скопировать код. Выделите его и скопируйте вручную.'
      )
    }
  }

  const handleUnlink = async channel => {
    if (!channel || busy) return

    setBusy(`unlink:${channel.channel}`)
    clearChannelMessages(channel.channel)

    try {
      await unlinkMessenger(channel.channel)
      setConfirmUnlink('')
      setChannels(current =>
        current.map(item =>
          item.channel === channel.channel
            ? {
                ...item,
                linked: false,
                externalUsername: null,
                linkedAt: null,
                lastError: null
              }
            : item
        )
      )
      setLinkCodes(current => {
        if (!(channel.channel in current)) return current
        const next = { ...current }
        delete next[channel.channel]
        return next
      })
      showChannelStatus(
        channel.channel,
        `${channelTitle(channel)} отвязан. Подключить снова можно в любой момент.`
      )
      void refreshChannels().catch(() => {})
    } catch (error) {
      console.warn('Не удалось отвязать мессенджер:', error)
      showChannelError(
        channel.channel,
        describeActionError(error, 'Не удалось отвязать мессенджер. Попробуйте ещё раз.')
      )
    } finally {
      setBusy('')
    }
  }

  const handleNotificationsToggle = async (channel, enabled) => {
    if (!channel || busy) return

    setBusy(`prefs:${channel.channel}`)
    clearChannelMessages(channel.channel)

    try {
      const result = await updateMessengerPreferences(channel.channel, enabled)
      setChannels(current =>
        current.map(item =>
          item.channel === channel.channel
            ? { ...item, notificationsEnabled: result.notificationsEnabled }
            : item
        )
      )
      showChannelStatus(
        channel.channel,
        result.notificationsEnabled
          ? 'Напоминания снова будут приходить сюда.'
          : 'Напоминания в этот мессенджер приостановлены. Подключение сохранится.'
      )
    } catch (error) {
      console.warn('Не удалось изменить настройку напоминаний:', error)
      showChannelError(
        channel.channel,
        describeActionError(error, 'Не удалось сохранить настройку. Попробуйте ещё раз.')
      )
    } finally {
      setBusy('')
    }
  }

  const renderChannelCard = channel => {
    const name = channelTitle(channel)
    const icon = CHANNEL_ICONS[channel.channel]
    const linkCode = linkCodes[channel.channel]
    const isLinking = busy === `link:${channel.channel}`
    const isUnlinking = busy === `unlink:${channel.channel}`
    const isSaving = busy === `prefs:${channel.channel}`
    const isPolling = pollingChannel === channel.channel
    const isBusy = Boolean(busy)
    const username = formatUsername(channel.externalUsername)
    const linkedDate = formatDate(channel.linkedAt)
    const error = channelErrors[channel.channel]
    const status = channelStatuses[channel.channel]

    let stateLabel = 'Не подключён'
    if (!channel.configured) stateLabel = 'Канал пока недоступен'
    else if (channel.linked) stateLabel = 'Подключён'

    return (
      <article
        key={channel.channel}
        className={`messengerCard${channel.linked ? ' is-linked' : ''}${
          channel.configured ? '' : ' is-unavailable'
        }`}
        aria-labelledby={`messengerTitle-${channel.channel}`}
      >
        <header className='messengerCardHeader'>
          <span className='messengerCardIcon' aria-hidden='true'>
            <img src={icon} alt='' />
          </span>
          <div className='messengerCardHeading'>
            <h3 id={`messengerTitle-${channel.channel}`}>{name}</h3>
            <p
              className={`messengerState${channel.linked ? ' is-linked' : ''}${
                channel.configured ? '' : ' is-unavailable'
              }`}
            >
              {stateLabel}
              {channel.linked && username && (
                <span className='messengerStateUsername'> · {username}</span>
              )}
            </p>
          </div>
          {channel.linked && !channel.notificationsEnabled && (
            <span className='messengerBadge'>Напоминания выключены</span>
          )}
        </header>

        {!channel.configured ? (
          <p className='messengerCardText'>
            Подключение {name} пока не настроено на сервере. Как только канал
            станет доступен, здесь появится кнопка подключения.
          </p>
        ) : channel.linked ? (
          <>
            <p className='messengerCardText'>
              {CHANNEL_HINTS[channel.channel]}
              {linkedDate ? ` Подключён ${linkedDate}.` : ''}
            </p>

            <div className='messengerToggleRow'>
              <div className='messengerToggleText'>
                <p className='messengerToggleTitle'>Присылать напоминания сюда</p>
                <p className='messengerToggleHint'>
                  Полив, советы и итоги недели — в {name}
                </p>
              </div>
              <label className='messengerSwitch'>
                <input
                  type='checkbox'
                  checked={channel.notificationsEnabled}
                  disabled={isBusy}
                  aria-label={`Присылать напоминания в ${name}`}
                  aria-busy={isSaving}
                  onChange={event =>
                    handleNotificationsToggle(channel, event.target.checked)
                  }
                />
                <span className='messengerSwitchTrack' aria-hidden='true' />
              </label>
            </div>

            {channel.lastError && (
              <p className='messengerCardText messengerCardText--warning'>
                Последнее сообщение не доставлено. Проверьте, что бот не
                заблокирован в {name}.
              </p>
            )}

            {confirmUnlink === channel.channel ? (
              <div
                className='messengerConfirm'
                role='group'
                aria-labelledby={`messengerConfirmText-${channel.channel}`}
              >
                <p id={`messengerConfirmText-${channel.channel}`}>
                  Отвязать {name}? Напоминания сюда больше не придут, но
                  подключить его можно снова.
                </p>
                <div className='messengerActions'>
                  <button
                    type='button'
                    className='messengerButton messengerButton--danger'
                    onClick={() => handleUnlink(channel)}
                    disabled={isBusy}
                  >
                    {isUnlinking ? 'Отвязываем…' : 'Да, отвязать'}
                  </button>
                  <button
                    type='button'
                    className='messengerButton messengerButton--ghost'
                    onClick={() => setConfirmUnlink('')}
                    disabled={isBusy}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className='messengerActions'>
                <button
                  type='button'
                  className='messengerButton messengerButton--ghost'
                  onClick={() => setConfirmUnlink(channel.channel)}
                  disabled={isBusy || isPolling}
                >
                  Отвязать
                </button>
              </div>
            )}
          </>
        ) : linkCode ? (
          <>
            <p className='messengerCardText'>
              Откройте бота по кнопке ниже — привязка произойдёт автоматически.
              Если бот не открылся, отправьте ему код сообщением.
            </p>

            <p className='messengerCodeLabel'>Код подключения</p>
            <p className='messengerCode' aria-label={`Код подключения ${linkCode.code}`}>
              {linkCode.code}
            </p>
            <p className='messengerCardText messengerCardText--muted'>
              {expiresLabel(linkCode, linkCodeTtlMinutes)}
            </p>

            <div className='messengerActions'>
              <a
                className='messengerButton messengerButton--primary'
                href={linkCode.deepLink}
                target='_blank'
                rel='noopener noreferrer'
              >
                Открыть {name}
              </a>
              <button
                type='button'
                className='messengerButton messengerButton--secondary'
                onClick={() => handleCopyCode(channel.channel, linkCode.code)}
              >
                {copiedChannel === channel.channel ? 'Скопировано' : 'Скопировать код'}
              </button>
            </div>

            <div className='messengerActions'>
              <button
                type='button'
                className='messengerButton messengerButton--primary'
                onClick={() => handleCheck(channel)}
                disabled={isBusy || isPolling}
                aria-busy={isPolling}
              >
                {isPolling ? 'Проверяем подключение…' : 'Проверить подключение'}
              </button>
              <button
                type='button'
                className='messengerButton messengerButton--ghost'
                onClick={() => handleConnect(channel)}
                disabled={isBusy || isPolling}
              >
                {isLinking ? 'Получаем код…' : 'Новый код'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className='messengerCardText'>{CHANNEL_HINTS[channel.channel]}</p>
            <div className='messengerActions'>
              <button
                type='button'
                className='messengerButton messengerButton--primary'
                onClick={() => handleConnect(channel)}
                disabled={isBusy || isPolling}
                aria-busy={isLinking}
              >
                {isLinking ? 'Получаем код…' : 'Подключить'}
              </button>
            </div>
          </>
        )}

        {isPolling && (
          <p className='messengerCardMessage' role='status'>
            Ждём, пока бот получит код. Проверяем каждые несколько секунд, это
            может занять до двух минут.
          </p>
        )}
        {status && !isPolling && (
          <p className='messengerCardMessage' role='status'>
            {status}
          </p>
        )}
        {error && (
          <p className='messengerCardMessage messengerCardMessage--error' role='alert'>
            {error}
          </p>
        )}
      </article>
    )
  }

  return (
    <section
      className='messengerBots'
      aria-labelledby='messengerBotsTitle'
      aria-busy={loading}
    >
      <HeadingTag id='messengerBotsTitle'>Мессенджеры</HeadingTag>
      <p className='messengerBotsIntro'>
        Напоминания о поливе и итоги недели могут приходить в Telegram или MAX —
        даже если уведомления в браузере выключены. Подключение займёт меньше
        минуты.
      </p>

      {loading ? (
        <p className='messengerBotsStatus' role='status'>
          Проверяем подключение мессенджеров…
        </p>
      ) : loadError ? (
        <div className='messengerBotsNotice'>
          <p role='alert'>{loadError}</p>
          <button
            type='button'
            className='messengerButton messengerButton--secondary'
            onClick={handleReload}
          >
            Проверить снова
          </button>
        </div>
      ) : (
        <>
          <div className='messengerBotsList'>
            {channels.map(renderChannelCard)}
          </div>
          <p className='messengerBotsHint'>
            Код подключения одноразовый и действует недолго. Отвязать мессенджер
            можно в любой момент — напоминания останутся в приложении.
          </p>
        </>
      )}
    </section>
  )
}

export default MessengerBots
