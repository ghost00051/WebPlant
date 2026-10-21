import { useEffect, useRef, useState } from 'react'
import NewChatBtn from '../../assets/NewChatBtn.svg'
import ChevronLeft from '../../assets/chevron-left.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { dayOfMonth, monthGenitive } from '../../utils/date.js'
import './historyChat.css'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusableElements(container) {
  if (!container) return []
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    element => element.getClientRects().length > 0 && !element.hasAttribute('inert')
  )
}

function isSameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}

function sessionDateLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  if (isSameLocalDay(date, now)) return 'Сегодня'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameLocalDay(date, yesterday)) return 'Вчера'

  return `${dayOfMonth(date)} ${monthGenitive(date)}`
}

function pluralMessages(count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'сообщение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сообщения'
  return 'сообщений'
}

function sessionMeta(session) {
  const parts = []
  const date = sessionDateLabel(session.updatedAt)
  if (date) parts.push(date)
  const count = Number(session.messageCount) || 0
  if (count > 0) parts.push(`${count} ${pluralMessages(count)}`)
  return parts.join(' · ')
}

function HistoryChat({
  sessions = [],
  activeSessionId = null,
  isLoading = false,
  isOpen = false,
  onSelect,
  onNewChat,
  onDelete,
  onClose
}) {
  const drawerRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [isDrawerMode, setIsDrawerMode] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsDrawerMode(query.matches)
    update()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }
    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  const drawerOpen = isDrawerMode && isOpen

  useEffect(() => {
    if (!drawerOpen) {
      const previous = previousFocusRef.current
      previousFocusRef.current = null
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus()
      }
      return
    }

    previousFocusRef.current = document.activeElement
    const drawer = drawerRef.current
    const [first] = getFocusableElements(drawer)
    if (first) {
      first.focus()
    } else {
      drawer?.focus?.()
    }
  }, [drawerOpen])

  const handleKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose?.()
      return
    }
    if (event.key !== 'Tab' || !drawerOpen) return

    const focusable = getFocusableElements(drawerRef.current)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      {isOpen && (
        <button
          type='button'
          className='historyChatBackdrop'
          aria-label='Закрыть историю чатов'
          onClick={onClose}
        />
      )}
      <aside
        ref={drawerRef}
        className={`HistoryChat${isOpen ? ' is-open' : ''}`}
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? 'true' : undefined}
        aria-labelledby={drawerOpen ? 'historyChatTitle' : undefined}
        aria-label={drawerOpen ? undefined : 'История чатов'}
        aria-hidden={isDrawerMode && !isOpen ? 'true' : undefined}
        inert={isDrawerMode && !isOpen ? '' : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className='historyChatHeader'>
          <div className='historyChatHeaderLeft'>
            <button
              type='button'
              className='historyChatIconBtn historyChatClose'
              aria-label='Закрыть историю чатов'
              title='Закрыть'
              onClick={onClose}
            >
              <ThemedIcon src={ChevronLeft} alt='' />
            </button>
            <p className='historyChatTitle' id='historyChatTitle'>История чата</p>
          </div>
          <button
            type='button'
            className='historyChatIconBtn historyChatNewBtn'
            aria-label='Новый чат'
            title='Новый чат'
            onClick={onNewChat}
          >
            <ThemedIcon src={NewChatBtn} alt='' />
          </button>
        </div>

        <div className='historyChatList'>
          {isLoading && sessions.length === 0 && (
            <p className='historyChatEmpty'>Загружаю историю…</p>
          )}

          {!isLoading && sessions.length === 0 && (
            <p className='historyChatEmpty'>
              Пока здесь пусто. Задайте первый вопрос — чат сохранится и появится в этом списке.
            </p>
          )}

          {sessions.map(session => {
            const active = session.id === activeSessionId
            return (
              <div
                key={session.id}
                className={`historyChatItem${active ? ' is-active' : ''}`}
              >
                <button
                  type='button'
                  className='historyChatItemBtn'
                  onClick={() => onSelect?.(session.id)}
                  aria-current={active ? 'true' : undefined}
                  title={session.title}
                >
                  <span className='historyChatItemTitle'>{session.title}</span>
                  <span className='historyChatItemMeta'>{sessionMeta(session)}</span>
                </button>
                <button
                  type='button'
                  className='historyChatItemDelete'
                  aria-label={`Удалить чат «${session.title}»`}
                  title='Удалить чат'
                  onClick={() => onDelete?.(session.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>

        <p className='historyChatFooter'>
          При каждом запуске приложения открывается новый чат, а прошлые остаются здесь.
        </p>
      </aside>
    </>
  )
}

export default HistoryChat
