import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../utils/api.js'
import './adminMail.css'
import './dark-theme.css'

const ADMIN_MAIL_BASE = `${API_URL}/admin/mail`
const SEARCH_DEBOUNCE_MS = 350
const PREVIEW_DEBOUNCE_MS = 700
const SEARCH_LIMIT = 50
const OVERVIEW_POLL_MS = 15000
const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_LENGTH = 5000
const MAX_CTA_LABEL_LENGTH = 80

const BROADCAST_STATUS_LABELS = {
    pending: 'Запланирована',
    sending: 'Отправляется',
    sent: 'Отправлена',
    failed: 'Не доставлена',
    canceled: 'Отменена'
}

const BROADCAST_STATUS_CLASSES = {
    pending: 'adminMailStatusPending',
    sending: 'adminMailStatusSending',
    sent: 'adminMailStatusSent',
    failed: 'adminMailStatusFailed',
    canceled: 'adminMailStatusCanceled'
}

const MAIL_STATUS_LABELS = {
    configured: 'настроена',
    disabled: 'выключена',
    'not-configured': 'не настроена'
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

function recipientName(user) {
    return user.name?.trim() || user.username || user.email || 'Без имени'
}

function AdminMailPanel() {
    const [roleState, setRoleState] = useState('checking')
    const [overview, setOverview] = useState(null)
    const [overviewLoading, setOverviewLoading] = useState(false)
    const [overviewError, setOverviewError] = useState('')
    const [targetMode, setTargetMode] = useState('all')
    const [search, setSearch] = useState('')
    const [recipients, setRecipients] = useState([])
    const [recipientsLoading, setRecipientsLoading] = useState(false)
    const [recipientsError, setRecipientsError] = useState('')
    const [selectedUsers, setSelectedUsers] = useState(() => new Map())
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [ctaLabel, setCtaLabel] = useState('')
    const [ctaUrl, setCtaUrl] = useState('')
    const [scheduledFor, setScheduledFor] = useState('')
    const [sending, setSending] = useState(false)
    const [formError, setFormError] = useState('')
    const [statusMessage, setStatusMessage] = useState('')
    const [cancelingId, setCancelingId] = useState(null)
    const [preview, setPreview] = useState(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState('')
    const [showPreviewText, setShowPreviewText] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testMessage, setTestMessage] = useState('')

    const previewSeq = useRef(0)

    const loadOverview = useCallback(async () => {
        setOverviewLoading(true)
        setOverviewError('')
        try {
            const response = await fetch(
                `${ADMIN_MAIL_BASE}/overview`,
                { method: 'GET', credentials: 'include' }
            )
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `HTTP ${response.status}`)
            }
            const data = await response.json()
            setOverview(data)
        } catch (error) {
            console.error('Ошибка загрузки статистики рассылок писем:', error)
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
        if (roleState !== 'admin' || !overview) return undefined
        const inProgress = Array.isArray(overview.recent)
            && overview.recent.some(item => item.status === 'sending'
                || (item.status === 'pending' && !item.scheduled_for))
        if (!inProgress) return undefined

        const timer = setInterval(loadOverview, OVERVIEW_POLL_MS)
        return () => clearInterval(timer)
    }, [roleState, overview, loadOverview])

    useEffect(() => {
        if (roleState !== 'admin' || targetMode !== 'users') return undefined

        let isMounted = true

        const loadRecipients = async () => {
            setRecipientsLoading(true)
            setRecipientsError('')
            try {
                const params = new URLSearchParams()
                if (search.trim()) params.set('search', search.trim())
                params.set('limit', String(SEARCH_LIMIT))
                params.set('offset', '0')

                const response = await fetch(
                    `${ADMIN_MAIL_BASE}/recipients?${params.toString()}`,
                    { method: 'GET', credentials: 'include' }
                )
                if (!isMounted) return
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}))
                    throw new Error(errorData.message || `HTTP ${response.status}`)
                }
                const data = await response.json()
                if (!isMounted) return
                setRecipients(Array.isArray(data.items) ? data.items : [])
            } catch (error) {
                if (!isMounted) return
                console.error('Ошибка поиска получателей писем:', error)
                setRecipientsError(error.message || 'Не удалось загрузить получателей.')
                setRecipients([])
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

    useEffect(() => {
        const trimmedSubject = subject.trim()
        const trimmedBody = body.trim()
        const controller = new AbortController()
        const seq = previewSeq.current + 1
        previewSeq.current = seq

        const timer = setTimeout(async () => {
            if (previewSeq.current !== seq) return

            if (!trimmedSubject || !trimmedBody) {
                setPreview(null)
                setPreviewError('')
                setPreviewLoading(false)
                return
            }

            setPreviewLoading(true)
            setPreviewError('')
            try {
                const response = await fetch(
                    `${ADMIN_MAIL_BASE}/preview`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        signal: controller.signal,
                        body: JSON.stringify({
                            subject: trimmedSubject,
                            body: trimmedBody,
                            ctaLabel: ctaLabel.trim(),
                            ctaUrl: ctaUrl.trim(),
                            targetMode,
                            userIds: targetMode === 'users' ? [...selectedUsers.keys()] : []
                        })
                    }
                )
                if (previewSeq.current !== seq) return
                const data = await response.json().catch(() => ({}))
                if (previewSeq.current !== seq) return
                if (!response.ok) {
                    throw new Error(data.message || `HTTP ${response.status}`)
                }
                setPreview(data)
            } catch (error) {
                if (error.name === 'AbortError' || previewSeq.current !== seq) return
                console.error('Ошибка предпросмотра письма:', error)
                setPreviewError(error.message || 'Не удалось построить предпросмотр.')
                setPreview(null)
            } finally {
                if (previewSeq.current === seq) setPreviewLoading(false)
            }
        }, PREVIEW_DEBOUNCE_MS)

        return () => {
            controller.abort()
            clearTimeout(timer)
        }
    }, [subject, body, ctaLabel, ctaUrl, targetMode, selectedUsers])

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
            recipients.forEach(user => {
                if (user.hasEmail !== false) next.set(user.id, user)
            })
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
                `${ADMIN_MAIL_BASE}/broadcasts/${broadcastId}/cancel`,
                { method: 'POST', credentials: 'include' }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }
            setStatusMessage('Рассылка отменена.')
            await loadOverview()
        } catch (error) {
            console.error('Ошибка отмены рассылки писем:', error)
            setFormError(error.message || 'Не удалось отменить рассылку.')
        } finally {
            setCancelingId(null)
        }
    }

    const handleTestSend = async () => {
        if (testing || sending) return

        const trimmedSubject = subject.trim()
        const trimmedBody = body.trim()
        if (!trimmedSubject || !trimmedBody) {
            setTestMessage('')
            setFormError('Заполните тему и текст письма.')
            return
        }

        setTesting(true)
        setFormError('')
        setStatusMessage('')
        setTestMessage('')
        try {
            const response = await fetch(
                `${ADMIN_MAIL_BASE}/test`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        subject: trimmedSubject,
                        body: trimmedBody,
                        ctaLabel: ctaLabel.trim(),
                        ctaUrl: ctaUrl.trim()
                    })
                }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }
            setTestMessage(`Тестовое письмо отправлено на ${data.to}.`)
        } catch (error) {
            console.error('Ошибка тестового письма:', error)
            setFormError(error.message || 'Не удалось отправить тестовое письмо.')
        } finally {
            setTesting(false)
        }
    }

    const handleSubmit = async event => {
        event.preventDefault()
        if (sending || testing) return

        const trimmedSubject = subject.trim()
        const trimmedBody = body.trim()

        if (!trimmedSubject || !trimmedBody) {
            setStatusMessage('')
            setFormError('Заполните тему и текст письма.')
            return
        }

        const selectedIds = [...selectedUsers.keys()]
        if (targetMode === 'users' && selectedIds.length === 0) {
            setStatusMessage('')
            setFormError('Выберите хотя бы одного получателя.')
            return
        }

        if ((ctaLabel.trim() && !ctaUrl.trim()) || (!ctaLabel.trim() && ctaUrl.trim())) {
            setStatusMessage('')
            setFormError('У кнопки нужны и подпись, и ссылка — либо оставьте оба поля пустыми.')
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
        setTestMessage('')

        const idempotencySource = JSON.stringify({
            subject: trimmedSubject,
            body: trimmedBody,
            ctaLabel: ctaLabel.trim(),
            ctaUrl: ctaUrl.trim(),
            targetMode,
            selectedIds: targetMode === 'users' ? selectedIds : []
        })
        let idempotencyHash = 2166136261
        for (let index = 0; index < idempotencySource.length; index++) {
            idempotencyHash ^= idempotencySource.charCodeAt(index)
            idempotencyHash = Math.imul(idempotencyHash, 16777619)
        }
        const idempotencyKey = `mail-${(idempotencyHash >>> 0).toString(16)}-${idempotencySource.length}`

        try {
            const response = await fetch(
                `${ADMIN_MAIL_BASE}/broadcasts`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': idempotencyKey
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        subject: trimmedSubject,
                        body: trimmedBody,
                        ctaLabel: ctaLabel.trim(),
                        ctaUrl: ctaUrl.trim(),
                        targetMode,
                        userIds: targetMode === 'users' ? selectedIds : [],
                        scheduledFor: scheduledIso
                    })
                }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }

            if (scheduledIso) {
                setStatusMessage(
                    `Рассылка запланирована на ${new Date(scheduledIso).toLocaleString('ru-RU')}.`
                )
            } else {
                setStatusMessage(describeSendResult(data))
            }

            setSubject('')
            setBody('')
            setCtaLabel('')
            setCtaUrl('')
            setScheduledFor('')
            setSelectedUsers(new Map())
            setPreview(null)
            await loadOverview()
        } catch (error) {
            console.error('Ошибка отправки рассылки писем:', error)
            const networkFailure = error instanceof TypeError
                || /network|fetch|abort|прерва/i.test(error?.message || '')
            if (networkFailure) {
                setFormError(
                    'Связь прервалась до ответа сервера. Рассылка могла уже создаться — ' +
                    'проверьте список последних рассылок ниже и не отправляйте повторно.'
                )
                await loadOverview()
            } else {
                setFormError(error.message || 'Не удалось отправить рассылку.')
            }
        } finally {
            setSending(false)
        }
    }

    if (roleState !== 'admin') {
        return null
    }

    const mailConfigured = overview ? overview.mailConfigured !== false : false
    const mailStatus = overview?.mailStatus || ''
    const stats = {
        users: overview?.users?.total ?? 0,
        withEmail: overview?.users?.withEmail ?? 0,
        withoutEmail: overview?.users?.withoutEmail ?? 0,
        sent: overview?.totals?.sent ?? 0
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
    const canBuildMessage = Boolean(subject.trim() && body.trim())

    return (
        <section className='adminMailPanel' aria-labelledby='adminMailTitle'>
            <h2 id='adminMailTitle'>Мастер-панель: рассылка писем на почту</h2>

            {overviewError && (
                <p className='adminMailMessage adminMailError' role='alert'>{overviewError}</p>
            )}

            {overviewLoading && !overview && (
                <p className='adminMailMessage' role='status'>Загружаем статистику рассылок...</p>
            )}

            {overview && !mailConfigured && (
                <p className='adminMailMessage adminMailWarning' role='alert'>
                    Почта не настроена на сервере, отправка недоступна.
                    Проверьте SMTP_HOST, SMTP_USER и SMTP_PASSWORD.
                </p>
            )}

            {overview && mailConfigured && Array.isArray(overview.mailProblems) && overview.mailProblems.length > 0 && (
                <ul className='adminMailProblems'>
                    {overview.mailProblems.map(problem => (
                        <li key={problem}>{problem}</li>
                    ))}
                </ul>
            )}

            <div className='adminMailStats'>
                <div className='adminMailStat'>
                    <p className='adminMailStatValue'>{MAIL_STATUS_LABELS[mailStatus] || '—'}</p>
                    <p className='adminMailStatLabel'>Почта на сервере</p>
                </div>
                <div className='adminMailStat'>
                    <p className='adminMailStatValue'>{stats.users}</p>
                    <p className='adminMailStatLabel'>Всего пользователей</p>
                </div>
                <div className='adminMailStat'>
                    <p className='adminMailStatValue'>{stats.withEmail}</p>
                    <p className='adminMailStatLabel'>Получат письмо</p>
                </div>
                <div className='adminMailStat'>
                    <p className='adminMailStatValue'>{stats.sent}</p>
                    <p className='adminMailStatLabel'>Писем отправлено</p>
                </div>
            </div>

            {overview?.from && (
                <p className='adminMailMessage adminMailFrom'>
                    Письма уходят от <strong>{overview.from}</strong>
                    {overview.totals?.failed > 0 && ` · ошибок доставки: ${overview.totals.failed}`}
                </p>
            )}

            {overview && stats.users === 0 && (
                <p className='adminMailMessage'>На сервере пока нет пользователей.</p>
            )}

            {overview && stats.users > 0 && stats.withEmail === 0 && (
                <p className='adminMailMessage'>
                    Ни у одного пользователя нет корректного адреса почты — рассылать некому.
                </p>
            )}

            <form className='adminMailForm' onSubmit={handleSubmit}>
                <fieldset className='adminMailFieldset'>
                    <legend>Режим получателей</legend>
                    <div className='adminMailModeSwitch'>
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

                {targetMode === 'users' && (
                    <div className='adminMailRecipients'>
                        <label className='adminMailField'>
                            <span className='adminMailFieldLabel'>Поиск получателей</span>
                            <input
                                type='search'
                                value={search}
                                placeholder='Поиск по email, имени или username'
                                aria-busy={recipientsLoading}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>

                        <div className='adminMailRecipientsToolbar'>
                            <p className='adminMailSelectedCount' role='status'>
                                Выбрано: {selectedUsers.size}
                            </p>
                            <div className='adminMailRecipientsActions'>
                                <button
                                    type='button'
                                    className='adminMailSecondaryButton'
                                    disabled={recipients.length === 0}
                                    onClick={handleSelectAllFound}
                                >
                                    Выбрать всех найденных
                                </button>
                                <button
                                    type='button'
                                    className='adminMailSecondaryButton'
                                    disabled={selectedUsers.size === 0}
                                    onClick={handleClearSelection}
                                >
                                    Снять выбор
                                </button>
                            </div>
                        </div>

                        {recipientsError && (
                            <p className='adminMailMessage adminMailError' role='alert'>{recipientsError}</p>
                        )}

                        {recipientsLoading && (
                            <p className='adminMailMessage' role='status'>Ищем получателей...</p>
                        )}

                        {!recipientsLoading && !recipientsError && recipients.length === 0 && (
                            <p className='adminMailMessage'>
                                {search.trim()
                                    ? 'Никого не найдено по запросу.'
                                    : 'На сервере пока нет пользователей.'}
                            </p>
                        )}

                        {recipients.length > 0 && (
                            <ul className='adminMailRecipientsList'>
                                {recipients.map(user => (
                                    <li key={user.id}>
                                        <label className='adminMailRecipient'>
                                            <input
                                                type='checkbox'
                                                checked={selectedUsers.has(user.id)}
                                                onChange={() => toggleRecipient(user)}
                                            />
                                            <span className='adminMailRecipientInfo'>
                                                <span className='adminMailRecipientName'>{recipientName(user)}</span>
                                                {user.email && (
                                                    <span className='adminMailRecipientMeta'>{user.email}</span>
                                                )}
                                                <span
                                                    className={user.hasEmail
                                                        ? 'adminMailRecipientMail'
                                                        : 'adminMailRecipientMail adminMailRecipientNoMail'}
                                                >
                                                    {user.hasEmail ? 'адрес пригоден' : 'адрес не подходит для рассылки'}
                                                </span>
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {selectedOutsideSearch.length > 0 && (
                            <div className='adminMailSelected'>
                                <p className='adminMailSelectedTitle'>Выбранные</p>
                                <ul className='adminMailRecipientsList'>
                                    {selectedOutsideSearch.map(user => (
                                        <li key={user.id}>
                                            <div className='adminMailRecipient adminMailRecipientStatic'>
                                                <span className='adminMailRecipientInfo'>
                                                    <span className='adminMailRecipientName'>{recipientName(user)}</span>
                                                    {user.email && (
                                                        <span className='adminMailRecipientMeta'>{user.email}</span>
                                                    )}
                                                </span>
                                                <button
                                                    type='button'
                                                    className='adminMailRemoveButton'
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

                <div className='adminMailFields'>
                    <label className='adminMailField'>
                        <span className='adminMailFieldLabel'>
                            Тема письма <span className='adminMailCounter'>{subject.length}/{MAX_SUBJECT_LENGTH}</span>
                        </span>
                        <input
                            type='text'
                            value={subject}
                            maxLength={MAX_SUBJECT_LENGTH}
                            placeholder='Например: Как поливать растения в отпуске'
                            onChange={event => setSubject(event.target.value)}
                        />
                    </label>

                    <label className='adminMailField'>
                        <span className='adminMailFieldLabel'>
                            Текст письма <span className='adminMailCounter'>{body.length}/{MAX_BODY_LENGTH}</span>
                        </span>
                        <textarea
                            value={body}
                            maxLength={MAX_BODY_LENGTH}
                            rows={8}
                            placeholder={'Коротко о том, что вы хотите рассказать.\n\nПустая строка начинает новый абзац.'}
                            onChange={event => setBody(event.target.value)}
                        />
                        <span className='adminMailHint'>
                            Обращение по имени и подпись добавит сервер: пишите текст без «Здравствуйте».
                        </span>
                    </label>

                    <div className='adminMailFieldsRow'>
                        <label className='adminMailField'>
                            <span className='adminMailFieldLabel'>
                                Подпись кнопки <span className='adminMailCounter'>{ctaLabel.length}/{MAX_CTA_LABEL_LENGTH}</span>
                            </span>
                            <input
                                type='text'
                                value={ctaLabel}
                                maxLength={MAX_CTA_LABEL_LENGTH}
                                placeholder='Открыть свой сад'
                                onChange={event => setCtaLabel(event.target.value)}
                            />
                        </label>

                        <label className='adminMailField'>
                            <span className='adminMailFieldLabel'>Ссылка кнопки</span>
                            <input
                                type='text'
                                value={ctaUrl}
                                placeholder='/home'
                                onChange={event => setCtaUrl(event.target.value)}
                            />
                        </label>
                    </div>

                    <span className='adminMailHint'>
                        Кнопка необязательна. Внутренний путь вроде /home сервер превратит в полный адрес сайта.
                    </span>

                    <div className='adminMailField'>
                        <label className='adminMailFieldLabel' htmlFor='adminMailScheduledFor'>
                            Отправить позже
                        </label>
                        <div className='adminMailScheduleRow'>
                            <input
                                id='adminMailScheduledFor'
                                type='datetime-local'
                                value={scheduledFor}
                                onChange={event => setScheduledFor(event.target.value)}
                            />
                            <button
                                type='button'
                                className='adminMailSecondaryButton'
                                disabled={!scheduledFor}
                                onClick={() => setScheduledFor('')}
                            >
                                Сбросить время
                            </button>
                        </div>
                    </div>
                </div>

                <div className='adminMailPreview'>
                    <div className='adminMailPreviewHead'>
                        <p className='adminMailPreviewHeading'>Предпросмотр письма</p>
                        {canBuildMessage && preview && (
                            <button
                                type='button'
                                className='adminMailSecondaryButton adminMailPreviewToggle'
                                aria-pressed={showPreviewText}
                                onClick={() => setShowPreviewText(value => !value)}
                            >
                                {showPreviewText ? 'Показать письмо' : 'Текстовая версия'}
                            </button>
                        )}
                    </div>

                    {!canBuildMessage && (
                        <p className='adminMailMessage'>
                            Заполните тему и текст — здесь появится настоящее письмо.
                        </p>
                    )}

                    {canBuildMessage && previewLoading && !preview && (
                        <p className='adminMailMessage' role='status'>Собираем предпросмотр...</p>
                    )}

                    {canBuildMessage && previewError && (
                        <p className='adminMailMessage adminMailError' role='alert'>{previewError}</p>
                    )}

                    {canBuildMessage && preview && showPreviewText && (
                        <pre className='adminMailPreviewText'>{preview.text}</pre>
                    )}

                    {canBuildMessage && preview && !showPreviewText && (
                        <iframe
                            className='adminMailPreviewFrame'
                            title='Предпросмотр письма'
                            sandbox=''
                            srcDoc={preview.html}
                        />
                    )}

                    {canBuildMessage && preview && (
                        <p className='adminMailPreviewMeta'>
                            Тема: <strong>{preview.subject}</strong>
                            {' · '}обращение: {preview.sampleName}
                        </p>
                    )}
                </div>

                {formError && (
                    <p className='adminMailMessage adminMailError' role='alert'>{formError}</p>
                )}

                {statusMessage && (
                    <p className='adminMailMessage adminMailSuccess' role='status'>{statusMessage}</p>
                )}

                {testMessage && (
                    <p className='adminMailMessage adminMailSuccess' role='status'>{testMessage}</p>
                )}

                <div className='adminMailActions'>
                    <button
                        type='submit'
                        className='adminMailSubmitButton'
                        disabled={sending || testing || overviewLoading || !mailConfigured}
                        aria-busy={sending}
                    >
                        {sending ? 'Отправляем...' : submitLabel}
                    </button>
                    <button
                        type='button'
                        className='adminMailSecondaryButton'
                        disabled={sending || testing || overviewLoading || !mailConfigured || !canBuildMessage}
                        aria-busy={testing}
                        onClick={handleTestSend}
                    >
                        {testing ? 'Отправляем тест...' : 'Отправить тест себе'}
                    </button>
                </div>
            </form>

            {recent.length > 0 && (
                <div className='adminMailRecent'>
                    <p className='adminMailPreviewHeading'>Последние рассылки</p>
                    <ul className='adminMailRecentList'>
                        {recent.map(item => (
                            <li key={item.id} className='adminMailRecentItem'>
                                <div className='adminMailRecentMain'>
                                    <p className='adminMailRecentTitle'>
                                        {item.subject || 'Без темы'}
                                    </p>
                                    <p className='adminMailRecentMeta'>
                                        <span className={BROADCAST_STATUS_CLASSES[item.status] || ''}>
                                            {BROADCAST_STATUS_LABELS[item.status] || item.status}
                                        </span>
                                        {item.target_mode === 'users' ? ' · выбранные' : ' · все пользователи'}
                                        {formatBroadcastTime(item) && ` · ${formatBroadcastTime(item)}`}
                                    </p>
                                    <p className='adminMailRecentCounts'>
                                        Отправлено: {item.sent_count ?? 0} из {item.total_recipients ?? 0}
                                        {' · '}ошибок: {item.failed_count ?? 0}
                                        {(item.skipped_count ?? 0) > 0 && ` · пропущено: ${item.skipped_count}`}
                                    </p>
                                </div>
                                {item.status === 'pending' && (
                                    <button
                                        type='button'
                                        className='adminMailCancelButton'
                                        disabled={cancelingId === item.id}
                                        aria-busy={cancelingId === item.id}
                                        onClick={() => handleCancelBroadcast(item.id)}
                                    >
                                        {cancelingId === item.id ? 'Отменяем...' : 'Отменить'}
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

function describeSendResult(data) {
    if (data?.deduplicated) {
        return 'Эта рассылка уже была создана ранее — повторно письма не отправляются. ' +
            'Прогресс виден в списке последних рассылок.'
    }

    const result = data?.sentResult
    if (!result) {
        return 'Рассылка создана: отправка начнётся в течение минуты. ' +
            'Прогресс виден в списке последних рассылок.' +
            describeConsent(data?.consent)
    }

    const parts = [`Отправлено ${result.sent} из ${result.total}`]
    if (result.failed) parts.push(`ошибок: ${result.failed}`)
    if (result.skipped) parts.push(`пропущено: ${result.skipped}`)
    if (result.remaining) {
        parts.push(`в очереди осталось ${result.remaining} — доотправим в течение пары минут`)
    }
    return `${parts.join(', ')}.${describeConsent({
        optedIn: result.sent,
        unsubscribed: result.unsubscribed,
        withoutConsent: result.withoutConsent,
        warning: result.consentWarning
    })}`
}

function describeConsent(consent) {
    if (!consent) return ''

    const parts = []
    if (Number.isFinite(consent.optedIn)) parts.push(`подписаны: ${consent.optedIn}`)
    if (Number.isFinite(consent.unsubscribed)) parts.push(`отписались: ${consent.unsubscribed}`)
    if (consent.withoutConsent) parts.push(`без согласия: ${consent.withoutConsent}`)

    const summary = parts.length ? ` Согласия: ${parts.join(', ')}.` : ''
    const warning = consent.warning ? ` ${consent.warning}` : ''
    return `${summary}${warning}`
}

export default AdminMailPanel
