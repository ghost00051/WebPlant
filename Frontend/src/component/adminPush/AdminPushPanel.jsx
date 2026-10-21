import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../utils/api.js'
import appIcon from '../../assets/IconLeaf.svg'
import './adminPush.css'
import './dark-theme.css'

const ADMIN_PUSH_BASE = `${API_URL}/admin/push`
const SEARCH_DEBOUNCE_MS = 350
const RECIPIENTS_PAGE_SIZE = 50

const BROADCAST_STATUS_LABELS = {
    pending: 'Запланирована',
    sending: 'Отправляется',
    sent: 'Отправлена',
    failed: 'Не доставлена',
    canceled: 'Отменена'
}

const BROADCAST_STATUS_CLASSES = {
    pending: 'adminPushStatusPending',
    sending: 'adminPushStatusSending',
    sent: 'adminPushStatusSent',
    failed: 'adminPushStatusFailed',
    canceled: 'adminPushStatusCanceled'
}

function formatDateTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('ru-RU')
}

function formatBroadcastTime(broadcast) {
    if (broadcast.status === 'pending') {
        const scheduled = formatDateTime(broadcast.scheduled_for)
        if (scheduled) return `на ${scheduled}`
    }
    const sent = formatDateTime(broadcast.sent_at)
    if (sent) return sent
    const created = formatDateTime(broadcast.created_at)
    return created ? `создана ${created}` : ''
}

function buildPreviewTarget(url) {
    const value = (url || '').trim() || '/'
    if (/^https?:\/\//i.test(value)) {
        try {
            return new URL(value).hostname
        } catch {
            return value
        }
    }
    if (typeof window === 'undefined') return value
    return `${window.location.host}${value.startsWith('/') ? value : `/${value}`}`
}

function recipientName(user) {
    return user.name?.trim() || user.username || user.email || 'Без имени'
}

function createIdempotencyKey() {
    const fallback = `push-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `push-${crypto.randomUUID()}`
        }
    } catch {
        return fallback
    }
    return fallback
}

async function fetchRecipientsPage({ search, offset, limit }) {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    params.set('limit', String(limit))
    params.set('offset', String(offset))

    const response = await fetch(
        `${ADMIN_PUSH_BASE}/recipients?${params.toString()}`,
        { method: 'GET', credentials: 'include' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`)
    }

    return {
        items: Array.isArray(data.items) ? data.items : [],
        total: Number.isInteger(data.total) ? data.total : null
    }
}

function AdminPushPanel() {
    const [roleState, setRoleState] = useState('checking')
    const [overview, setOverview] = useState(null)
    const [overviewLoading, setOverviewLoading] = useState(false)
    const [overviewError, setOverviewError] = useState('')
    const [targetMode, setTargetMode] = useState('all')
    const [includeGuests, setIncludeGuests] = useState(false)
    const [search, setSearch] = useState('')
    const [recipients, setRecipients] = useState([])
    const [recipientsLoading, setRecipientsLoading] = useState(false)
    const [recipientsError, setRecipientsError] = useState('')
    const [selectedUsers, setSelectedUsers] = useState(() => new Map())
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [url, setUrl] = useState('/')
    const [scheduledFor, setScheduledFor] = useState('')
    const [sending, setSending] = useState(false)
    const [formError, setFormError] = useState('')
    const [statusMessage, setStatusMessage] = useState('')
    const [cancelingId, setCancelingId] = useState(null)
    const [recipientsTotal, setRecipientsTotal] = useState(0)
    const [recipientsLoadingMore, setRecipientsLoadingMore] = useState(false)
    const [retryAvailable, setRetryAvailable] = useState(true)
    const [retryingId, setRetryingId] = useState(null)
    const attemptRef = useRef({ source: null, key: null })

    const loadOverview = useCallback(async () => {
        setOverviewLoading(true)
        setOverviewError('')
        try {
            const response = await fetch(
                `${ADMIN_PUSH_BASE}/overview`,
                { method: 'GET', credentials: 'include' }
            )
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `HTTP ${response.status}`)
            }
            const data = await response.json()
            setOverview(data)
        } catch (error) {
            console.error('Ошибка загрузки статистики рассылок:', error)
            setOverviewError(error.message || 'Не удалось загрузить статистику рассылок.')
        } finally {
            setOverviewLoading(false)
        }
    }, [])

    useEffect(() => {
        let isMounted = true

        const init = async () => {
            try {
                const response = await fetch(
                    `${API_URL}/users/me`,
                    { method: 'GET', credentials: 'include' }
                )
                if (!isMounted) return
                if (!response.ok) {
                    setRoleState('denied')
                    return
                }
                const data = await response.json()
                if (!isMounted) return
                if (data?.role !== 'ADMIN') {
                    setRoleState('denied')
                    return
                }
                setRoleState('admin')
                await loadOverview()
            } catch (error) {
                console.error('Ошибка проверки прав администратора:', error)
                if (isMounted) setRoleState('denied')
            }
        }

        init()

        return () => {
            isMounted = false
        }
    }, [loadOverview])

    useEffect(() => {
        if (roleState !== 'admin' || targetMode !== 'users') return undefined

        let isMounted = true

        const loadRecipients = async () => {
            setRecipientsLoading(true)
            setRecipientsError('')
            setRecipientsLoadingMore(false)
            try {
                const page = await fetchRecipientsPage({
                    search,
                    offset: 0,
                    limit: RECIPIENTS_PAGE_SIZE
                })
                if (!isMounted) return
                setRecipients(page.items)
                setRecipientsTotal(page.total ?? page.items.length)
            } catch (error) {
                if (!isMounted) return
                console.error('Ошибка поиска получателей:', error)
                setRecipientsError(error.message || 'Не удалось загрузить получателей.')
                setRecipients([])
                setRecipientsTotal(0)
            } finally {
                if (isMounted) setRecipientsLoading(false)
            }
        }

        const timer = setTimeout(loadRecipients, SEARCH_DEBOUNCE_MS)

        return () => {
            isMounted = false
            clearTimeout(timer)
        }
    }, [roleState, targetMode, search])

    const loadMoreRecipients = async () => {
        if (recipientsLoading || recipientsLoadingMore || recipients.length >= recipientsTotal) {
            return
        }

        setRecipientsLoadingMore(true)
        setRecipientsError('')
        try {
            const page = await fetchRecipientsPage({
                search,
                offset: recipients.length,
                limit: RECIPIENTS_PAGE_SIZE
            })
            setRecipients(current => {
                const knownIds = new Set(current.map(user => user.id))
                return [...current, ...page.items.filter(user => !knownIds.has(user.id))]
            })
            setRecipientsTotal(currentTotal =>
                Math.max(currentTotal, page.total ?? recipients.length + page.items.length)
            )
        } catch (error) {
            console.error('Ошибка догрузки получателей:', error)
            setRecipientsError(error.message || 'Не удалось загрузить получателей.')
        } finally {
            setRecipientsLoadingMore(false)
        }
    }

    const toggleRecipient = user => {
        setSelectedUsers(previous => {
            const next = new Map(previous)
            if (next.has(user.id)) {
                next.delete(user.id)
            } else {
                next.set(user.id, user)
            }
            return next
        })
    }

    const handleSelectAllFound = () => {
        setSelectedUsers(previous => {
            const next = new Map(previous)
            recipients.forEach(user => next.set(user.id, user))
            return next
        })
    }

    const handleClearSelection = () => {
        setSelectedUsers(new Map())
    }

    const handleCancelBroadcast = async broadcastId => {
        if (cancelingId !== null) return
        setCancelingId(broadcastId)
        setFormError('')
        setStatusMessage('')
        try {
            const response = await fetch(
                `${ADMIN_PUSH_BASE}/broadcasts/${broadcastId}/cancel`,
                { method: 'POST', credentials: 'include' }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }
            setStatusMessage('Рассылка отменена.')
            await loadOverview()
        } catch (error) {
            console.error('Ошибка отмены рассылки:', error)
            setFormError(error.message || 'Не удалось отменить рассылку.')
        } finally {
            setCancelingId(null)
        }
    }

    const handleRetryBroadcast = async broadcastId => {
        if (retryingId !== null) return

        setRetryingId(broadcastId)
        setFormError('')
        setStatusMessage('')
        try {
            const response = await fetch(
                `${ADMIN_PUSH_BASE}/broadcasts/${broadcastId}/retry`,
                { method: 'POST', credentials: 'include' }
            )
            if (response.status === 404 || response.status === 501) {

                setRetryAvailable(false)
                setStatusMessage('Повторная отправка недоступна на сервере. Создайте новую рассылку.')
                return
            }
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }
            setStatusMessage('Повторная отправка запущена. Прогресс виден в списке последних рассылок.')
            await loadOverview()
        } catch (error) {
            console.error('Ошибка повторной отправки рассылки:', error)
            setFormError(error.message || 'Не удалось повторно отправить рассылку.')
        } finally {
            setRetryingId(null)
        }
    }

    const handleSubmit = async event => {
        event.preventDefault()
        if (sending) return

        const trimmedTitle = title.trim()
        const trimmedBody = body.trim()

        if (!trimmedTitle || !trimmedBody) {
            setStatusMessage('')
            setFormError('Заполните заголовок и текст уведомления.')
            return
        }

        const selectedIds = [...selectedUsers.keys()]
        if (targetMode === 'users' && selectedIds.length === 0) {
            setStatusMessage('')
            setFormError('Выберите хотя бы одного получателя.')
            return
        }

        let scheduledIso = null
        if (scheduledFor) {
            const scheduledDate = new Date(scheduledFor)
            if (Number.isNaN(scheduledDate.getTime())) {
                setStatusMessage('')
                setFormError('Укажите корректные дату и время отправки.')
                return
            }
            scheduledIso = scheduledDate.toISOString()
        }

        setSending(true)
        setFormError('')
        setStatusMessage('')

        const attemptSource = JSON.stringify({
            title: trimmedTitle,
            body: trimmedBody,
            url: url.trim() || '/',
            targetMode,
            selectedIds: targetMode === 'users' ? selectedIds : [],
            includeGuests: targetMode === 'all' ? includeGuests : false,
            scheduledFor: scheduledIso
        })
        const previousAttempt = attemptRef.current
        const idempotencyKey = previousAttempt.source === attemptSource && previousAttempt.key
            ? previousAttempt.key
            : createIdempotencyKey()
        attemptRef.current = { source: attemptSource, key: idempotencyKey }

        try {
            const response = await fetch(
                `${ADMIN_PUSH_BASE}/broadcasts`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': idempotencyKey
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        title: trimmedTitle,
                        body: trimmedBody,
                        url: url.trim() || '/',
                        icon: '',
                        targetMode,
                        userIds: targetMode === 'users' ? selectedIds : [],
                        includeGuests: targetMode === 'all' ? includeGuests : false,
                        scheduledFor: scheduledIso
                    })
                }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                const requestError = new Error(data.message || `HTTP ${response.status}`)
                requestError.status = response.status
                throw requestError
            }

            if (scheduledIso) {
                setStatusMessage(
                    `Рассылка запланирована на ${new Date(scheduledIso).toLocaleString('ru-RU')}.`
                )
            } else if (data.deduplicated) {
                setStatusMessage(
                    'Такая рассылка уже была создана ранее — повторно уведомления не отправляются.'
                )
            } else if (!data.sentResult) {
                const total = data.broadcast?.total_subscriptions
                    ?? data.recipientsCount
                    ?? 0
                setStatusMessage(
                    `Рассылка создана: отправка начнётся в течение минуты. Подписок всего: ${total}. ` +
                    'Прогресс виден в списке последних рассылок.'
                )
            } else {
                const sentResult = data.sentResult || {}
                const total = sentResult.total
                    ?? data.broadcast?.total_subscriptions
                    ?? data.recipientsCount
                    ?? 0
                const sent = sentResult.sent ?? 0
                const failed = sentResult.failed ?? 0
                const removed = sentResult.removed ?? 0
                const quarantined = sentResult.quarantined
                    ?? sentResult.quarantinedCount
                    ?? data.broadcast?.quarantined_count
                    ?? 0
                const partial = sentResult.partial === true
                    ? ' Отправка частичная.'
                    : ''
                setStatusMessage(
                    `Рассылка отправлена. Подписок всего: ${total}, отправлено: ${sent}, ошибок: ${failed}, удалено: ${removed}` +
                    `${quarantined ? `, в карантине: ${quarantined}` : ''}.${partial}`
                )
            }

            attemptRef.current = { source: null, key: null }
            setTitle('')
            setBody('')
            setUrl('/')
            setScheduledFor('')
            setSelectedUsers(new Map())
            await loadOverview()
        } catch (error) {
            console.error('Ошибка отправки рассылки:', error)
            const networkFailure = error instanceof TypeError
                || /network|fetch|abort|прерва/i.test(error?.message || '')
            if (networkFailure) {

                setFormError(
                    'Связь прервалась до ответа сервера. Рассылка могла уже создаться — ' +
                    'проверьте список последних рассылок ниже; повторная отправка не создаст дубль.'
                )
                await loadOverview()
            } else if (error.status === 409) {
                attemptRef.current = { source: null, key: null }
                setStatusMessage(
                    error.message || 'Такая рассылка уже создана недавно — повторная отправка заблокирована.'
                )
            } else {
                attemptRef.current = { source: null, key: null }
                setFormError(error.message || 'Не удалось отправить рассылку.')
            }
        } finally {
            setSending(false)
        }
    }

    if (roleState !== 'admin') {
        return null
    }

    const pushConfigured = overview ? overview.pushConfigured !== false : true
    const stats = {
        total: overview?.subscriptions?.total ?? 0,
        users: overview?.subscriptions?.users ?? 0,
        guests: overview?.subscriptions?.guests ?? 0,
        usersTotal: overview?.users?.total ?? 0
    }
    const recent = Array.isArray(overview?.recent) ? overview.recent : []
    const selectedList = [...selectedUsers.values()]
    const selectedOutsideSearch = selectedList.filter(
        user => !recipients.some(item => item.id === user.id)
    )
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null
    const scheduledLabel = scheduledDate && !Number.isNaN(scheduledDate.getTime())
        ? scheduledDate.toLocaleString('ru-RU')
        : ''
    const submitLabel = scheduledFor
        ? (scheduledLabel ? `Запланировать на ${scheduledLabel}` : 'Запланировать отправку')
        : 'Отправить сейчас'

    return (
        <section className='adminPushPanel' aria-labelledby='adminPushTitle'>
            <h2 id='adminPushTitle'>Мастер-панель: рассылка уведомлений</h2>

            {overviewError && (
                <div className='adminPushMessage adminPushError' role='alert'>
                    <p>{overviewError}</p>
                    <button
                        type='button'
                        className='adminPushSecondaryButton'
                        disabled={overviewLoading}
                        aria-busy={overviewLoading}
                        onClick={loadOverview}
                    >
                        {overviewLoading ? 'Загружаем...' : 'Повторить загрузку'}
                    </button>
                </div>
            )}

            {overviewLoading && !overview && (
                <p className='adminPushMessage' role='status'>Загружаем статистику рассылок...</p>
            )}

            {overview && !pushConfigured && (
                <p className='adminPushMessage adminPushWarning' role='alert'>
                    Push-уведомления не настроены на сервере, отправка недоступна.
                    Обратитесь к администратору сервера.
                </p>
            )}

            <div className='adminPushStats'>
                <div className='adminPushStat'>
                    <p className='adminPushStatValue'>{stats.total}</p>
                    <p className='adminPushStatLabel'>Всего подписок</p>
                </div>
                <div className='adminPushStat'>
                    <p className='adminPushStatValue'>{stats.users}</p>
                    <p className='adminPushStatLabel'>Пользователей с push</p>
                </div>
                <div className='adminPushStat'>
                    <p className='adminPushStatValue'>{stats.guests}</p>
                    <p className='adminPushStatLabel'>Гостевых подписок</p>
                </div>
                <div className='adminPushStat'>
                    <p className='adminPushStatValue'>{stats.usersTotal}</p>
                    <p className='adminPushStatLabel'>Всего пользователей</p>
                </div>
            </div>

            {overview && stats.total === 0 && (
                <p className='adminPushMessage'>
                    Push-подписок пока нет: пользователям нужно включить уведомления в профиле.
                </p>
            )}

            {overview && stats.usersTotal === 0 && (
                <p className='adminPushMessage'>На сервере пока нет пользователей.</p>
            )}

            <form className='adminPushForm' onSubmit={handleSubmit}>
                <fieldset className='adminPushFieldset'>
                    <legend>Режим получателей</legend>
                    <div className='adminPushModeSwitch'>
                        <button
                            type='button'
                            className={targetMode === 'all' ? 'is-active' : ''}
                            aria-pressed={targetMode === 'all'}
                            onClick={() => setTargetMode('all')}
                        >
                            Всем пользователям
                        </button>
                        <button
                            type='button'
                            className={targetMode === 'users' ? 'is-active' : ''}
                            aria-pressed={targetMode === 'users'}
                            onClick={() => setTargetMode('users')}
                        >
                            Выбрать получателей
                        </button>
                    </div>
                </fieldset>

                {targetMode === 'all' ? (
                    <label className='adminPushCheckbox'>
                        <input
                            type='checkbox'
                            checked={includeGuests}
                            onChange={event => setIncludeGuests(event.target.checked)}
                        />
                        <span>Включить гостевые подписки (без аккаунта)</span>
                    </label>
                ) : (
                    <div className='adminPushRecipients'>
                        <label className='adminPushField'>
                            <span className='adminPushFieldLabel'>Поиск получателей</span>
                            <input
                                type='search'
                                value={search}
                                placeholder='Поиск по email, имени или username'
                                aria-busy={recipientsLoading}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>

                        <div className='adminPushRecipientsToolbar'>
                            <p className='adminPushSelectedCount' role='status'>
                                Выбрано: {selectedUsers.size}
                                {recipientsTotal > recipients.length
                                    ? ` · загружено ${recipients.length} из ${recipientsTotal}`
                                    : ''}
                            </p>
                            <div className='adminPushRecipientsActions'>
                                <button
                                    type='button'
                                    className='adminPushSecondaryButton'
                                    disabled={recipients.length === 0}
                                    onClick={handleSelectAllFound}
                                >
                                    Выбрать всех найденных
                                </button>
                                <button
                                    type='button'
                                    className='adminPushSecondaryButton'
                                    disabled={selectedUsers.size === 0}
                                    onClick={handleClearSelection}
                                >
                                    Снять выбор
                                </button>
                            </div>
                        </div>

                        {recipientsError && (
                            <p className='adminPushMessage adminPushError' role='alert'>{recipientsError}</p>
                        )}

                        {recipientsLoading && (
                            <p className='adminPushMessage' role='status'>Ищем получателей...</p>
                        )}

                        {!recipientsLoading && !recipientsError && recipients.length === 0 && (
                            <p className='adminPushMessage'>
                                {search.trim()
                                    ? 'Никого не найдено по запросу.'
                                    : 'На сервере пока нет пользователей.'}
                            </p>
                        )}

                        {recipients.length > 0 && (
                            <ul className='adminPushRecipientsList'>
                                {recipients.map(user => (
                                    <li key={user.id}>
                                        <label className='adminPushRecipient'>
                                            <input
                                                type='checkbox'
                                                checked={selectedUsers.has(user.id)}
                                                onChange={() => toggleRecipient(user)}
                                            />
                                            <span className='adminPushRecipientInfo'>
                                                <span className='adminPushRecipientName'>{recipientName(user)}</span>
                                                {user.email && (
                                                    <span className='adminPushRecipientMeta'>{user.email}</span>
                                                )}
                                                <span
                                                    className={user.hasPush
                                                        ? 'adminPushRecipientSubs'
                                                        : 'adminPushRecipientSubs adminPushRecipientNoPush'}
                                                >
                                                    {user.hasPush
                                                        ? `Подписок: ${user.subscriptions ?? 0}`
                                                        : 'нет push-подписки'}
                                                </span>
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {recipients.length < recipientsTotal && (
                            <button
                                type='button'
                                className='adminPushSecondaryButton'
                                disabled={recipientsLoadingMore}
                                aria-busy={recipientsLoadingMore}
                                onClick={loadMoreRecipients}
                            >
                                {recipientsLoadingMore
                                    ? 'Загружаем...'
                                    : `Показать ещё (${Math.max(0, recipientsTotal - recipients.length)})`}
                            </button>
                        )}

                        {selectedOutsideSearch.length > 0 && (
                            <div className='adminPushSelected'>
                                <p className='adminPushSelectedTitle'>Выбранные</p>
                                <ul className='adminPushRecipientsList'>
                                    {selectedOutsideSearch.map(user => (
                                        <li key={user.id}>
                                            <div className='adminPushRecipient adminPushRecipientStatic'>
                                                <span className='adminPushRecipientInfo'>
                                                    <span className='adminPushRecipientName'>{recipientName(user)}</span>
                                                    {user.email && (
                                                        <span className='adminPushRecipientMeta'>{user.email}</span>
                                                    )}
                                                </span>
                                                <button
                                                    type='button'
                                                    className='adminPushRemoveButton'
                                                    aria-label={`Убрать ${recipientName(user)} из выбранных`}
                                                    onClick={() => toggleRecipient(user)}
                                                >
                                                    Убрать
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <div className='adminPushFields'>
                    <label className='adminPushField'>
                        <span className='adminPushFieldLabel'>
                            Заголовок <span className='adminPushCounter'>{title.length}/120</span>
                        </span>
                        <input
                            type='text'
                            value={title}
                            maxLength={120}
                            placeholder='Например: Не забудьте полить растения'
                            onChange={event => setTitle(event.target.value)}
                        />
                    </label>

                    <label className='adminPushField'>
                        <span className='adminPushFieldLabel'>
                            Текст уведомления <span className='adminPushCounter'>{body.length}/1000</span>
                        </span>
                        <textarea
                            value={body}
                            maxLength={1000}
                            rows={4}
                            placeholder='Короткое сообщение для пользователей'
                            onChange={event => setBody(event.target.value)}
                        />
                    </label>

                    <label className='adminPushField'>
                        <span className='adminPushFieldLabel'>Ссылка перехода</span>
                        <input
                            type='text'
                            value={url}
                            placeholder='/'
                            onChange={event => setUrl(event.target.value)}
                        />
                        <span className='adminPushHint'>
                            Внутренний путь, например /home или /my-plants
                        </span>
                    </label>

                    <div className='adminPushField'>
                        <label className='adminPushFieldLabel' htmlFor='adminPushScheduledFor'>
                            Отправить позже
                        </label>
                        <div className='adminPushScheduleRow'>
                            <input
                                id='adminPushScheduledFor'
                                type='datetime-local'
                                value={scheduledFor}
                                onChange={event => setScheduledFor(event.target.value)}
                            />
                            <button
                                type='button'
                                className='adminPushSecondaryButton'
                                disabled={!scheduledFor}
                                onClick={() => setScheduledFor('')}
                            >
                                Сбросить время
                            </button>
                        </div>
                    </div>
                </div>

                <div className='adminPushPreview'>
                    <p className='adminPushPreviewHeading'>Предпросмотр уведомления</p>
                    <div className='adminPushPreviewCard'>
                        <img className='adminPushPreviewIcon' src={appIcon} alt='' />
                        <div className='adminPushPreviewBody'>
                            <p className='adminPushPreviewTitle'>
                                {title.trim() || 'Заголовок уведомления'}
                            </p>
                            <p className='adminPushPreviewText'>
                                {body.trim() || 'Здесь появится текст уведомления.'}
                            </p>
                            <p className='adminPushPreviewUrl'>{buildPreviewTarget(url)}</p>
                        </div>
                    </div>
                </div>

                {formError && (
                    <p className='adminPushMessage adminPushError' role='alert'>{formError}</p>
                )}

                {statusMessage && (
                    <p className='adminPushMessage adminPushSuccess' role='status'>{statusMessage}</p>
                )}

                <button
                    type='submit'
                    className='adminPushSubmitButton'
                    disabled={sending || !pushConfigured}
                    aria-busy={sending}
                >
                    {sending ? 'Отправляем...' : submitLabel}
                </button>
            </form>

            {recent.length > 0 && (
                <div className='adminPushRecent'>
                    <p className='adminPushPreviewHeading'>Последние рассылки</p>
                    <ul className='adminPushRecentList'>
                        {recent.map(item => (
                            <li key={item.id} className='adminPushRecentItem'>
                                <div className='adminPushRecentMain'>
                                    <p className='adminPushRecentTitle'>
                                        {item.title || 'Без заголовка'}
                                    </p>
                                    <p className='adminPushRecentMeta'>
                                        <span className={BROADCAST_STATUS_CLASSES[item.status] || ''}>
                                            {BROADCAST_STATUS_LABELS[item.status] || item.status}
                                        </span>
                                        {formatBroadcastTime(item) && ` · ${formatBroadcastTime(item)}`}
                                    </p>
                                    {(Number.isFinite(item.sent_count) || Number.isFinite(item.failed_count)) && (
                                        <p className='adminPushRecentCounts'>
                                            Отправлено: {item.sent_count ?? 0} · Ошибок: {item.failed_count ?? 0}
                                            {Number.isFinite(item.removed_count) ? ` · Удалено: ${item.removed_count}` : ''}
                                            {Number.isFinite(item.quarantined_count) ? ` · Карантин: ${item.quarantined_count}` : ''}
                                        </p>
                                    )}
                                </div>
                                {item.status === 'pending' && (
                                    <button
                                        type='button'
                                        className='adminPushCancelButton'
                                        disabled={cancelingId === item.id}
                                        aria-busy={cancelingId === item.id}
                                        onClick={() => handleCancelBroadcast(item.id)}
                                    >
                                        {cancelingId === item.id ? 'Отменяем...' : 'Отменить'}
                                    </button>
                                )}
                                {item.status === 'failed' && retryAvailable && (
                                    <button
                                        type='button'
                                        className='adminPushSecondaryButton'
                                        disabled={retryingId === item.id}
                                        aria-busy={retryingId === item.id}
                                        onClick={() => handleRetryBroadcast(item.id)}
                                    >
                                        {retryingId === item.id ? 'Повторяем...' : 'Повторить'}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    )
}

export default AdminPushPanel
