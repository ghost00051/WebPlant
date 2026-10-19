import NewChatBtn from '../../assets/NewChatBtn.svg'
import ChevronLeft from '../../assets/chevron-left.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { dayOfMonth, monthGenitive } from '../../utils/date.js'
import './historyChat.css'

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
        className={`HistoryChat${isOpen ? ' is-open' : ''}`}
        aria-label='История чатов'
        onKeyDown={event => {
          if (event.key === 'Escape') onClose?.()
        }}
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
            <p className='historyChatTitle'>История чата</p>
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
