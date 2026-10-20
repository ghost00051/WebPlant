import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import './chat.css'
import './dark-theme.css'
import './adaptiv.css'
import IconLeaf from '../../assets/IconLeaf.svg'
import IconSend from '../../assets/IconSend.svg'
import NewChatBtn from '../../assets/NewChatBtn.svg'
import HistoryBtn from '../../assets/HistoryBtn.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import Paperclip from '../../assets/paperclip.svg'
import { API_URL } from '../../utils/api.js'

const CHAT_TIMEOUT_MS = 30000
const PHOTO_TIMEOUT_MS = 150000
const HISTORY_LIMIT = 50
const MAX_PHOTOS = 5
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_MAX_SIDE = 1600
const MAX_INPUT_HEIGHT = 140
const NEAR_BOTTOM_PX = 120
const KEYBOARD_MIN_HEIGHT = 120
const KEYBOARD_SETTLE_DELAYS = [0, 60, 140, 260, 420, 650, 900]

const CONFIDENCE_LABELS = { high: 'высокая', medium: 'средняя', low: 'низкая' }
const SEVERITY_LABELS = {
  none: 'признаков нет',
  mild: 'лёгкое',
  moderate: 'умеренное',
  severe: 'сильное',
  unknown: 'не определено'
}

const GREETING =
  'Привет! Я ИИ-помощник — помогу уследить за поливом и уходом за растениями. Напиши «Что полить?», «Покажи график» или «Сколько у меня растений?» — всё покажу. Можешь прикрепить до 5 фото растения — посмотрю, что с ним, и продолжу разговор по этому же растению.'

let localIdCounter = 0

function createLocalId(prefix) {
  localIdCounter += 1
  return `${prefix}-${Date.now()}-${localIdCounter}`
}

function createGreeting() {
  return {
    id: 'greeting',
    role: 'assistant',
    text: GREETING,
    createdAt: new Date().toISOString()
  }
}

function renderInlineMarkdown(text, keyPrefix) {
  const nodes = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g
  let lastIndex = 0
  let match = pattern.exec(text)
  let index = 0

  while (match) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index}`
    index += 1
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    lastIndex = match.index + token.length
    match = pattern.exec(text)
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function MarkdownText({ text }) {
  const source = String(text || '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return null

  const blocks = []
  let list = null

  const flushList = () => {
    if (!list) return
    blocks.push(list)
    list = null
  }

  source.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      return
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)

    if (bullet || ordered) {
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(ordered ? ordered[2] : bullet[1])
      return
    }

    flushList()
    blocks.push({ type: 'p', text: trimmed })
  })
  flushList()

  return (
    <>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'p') {
          return (
            <p key={`md-p-${blockIndex}`}>
              {renderInlineMarkdown(block.text, `md-p-${blockIndex}`)}
            </p>
          )
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={`md-li-${blockIndex}-${itemIndex}`}>
            {renderInlineMarkdown(item, `md-li-${blockIndex}-${itemIndex}`)}
          </li>
        ))
        return block.ordered ? (
          <ol key={`md-list-${blockIndex}`}>{items}</ol>
        ) : (
          <ul key={`md-list-${blockIndex}`}>{items}</ul>
        )
      })}
    </>
  )
}

function historyItemToMessage(item) {
  const photoUrls = Array.isArray(item.photoUrls) && item.photoUrls.length
    ? item.photoUrls
    : (item.photoUrl ? [item.photoUrl] : [])

  return {
    id: `h-${item.id}`,
    role: item.role === 'user' ? 'user' : 'assistant',
    text: item.text,
    createdAt: item.createdAt,
    photoUrls,
    diagnosis: item.diagnosis || null
  }
}

async function preparePhotoForUpload (file) {
  try {
    if (typeof createImageBitmap !== 'function') return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return file
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function DiagnosisCard ({ diagnosis }) {
  if (!diagnosis) return null

  const problems = Array.isArray(diagnosis.likelyProblems) ? diagnosis.likelyProblems : []
  const symptoms = Array.isArray(diagnosis.visibleSymptoms) ? diagnosis.visibleSymptoms : []
  const advice = Array.isArray(diagnosis.careAdvice) ? diagnosis.careAdvice : []

  return (
    <div className='chatDiagnosis'>
      <span className='chatDiagnosisLabel'>Предварительный разбор</span>
      {diagnosis.plantName && (
        <p className='chatDiagnosisPlant'>{diagnosis.plantName}</p>
      )}
      {symptoms.length > 0 && (
        <div className='chatDiagnosisSection'>
          <span className='chatDiagnosisSectionTitle'>Что видно</span>
          <ul className='chatDiagnosisList'>
            {symptoms.map((item, index) => (
              <li key={`s-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {problems.length > 0 && (
        <div className='chatDiagnosisSection'>
          <span className='chatDiagnosisSectionTitle'>Вероятные причины</span>
          <ul className='chatDiagnosisList'>
            {problems.map((problem, index) => (
              <li key={`p-${index}`}>
                <span className='chatDiagnosisProblem'>
                  {problem.name}
                  <span className={`chatDiagnosisConfidence chatDiagnosisConfidence--${problem.confidence || 'medium'}`}>
                    {CONFIDENCE_LABELS[problem.confidence] || CONFIDENCE_LABELS.medium}
                  </span>
                </span>
                {problem.why && (
                  <span className='chatDiagnosisWhy'>{problem.why}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diagnosis.severity && diagnosis.severity !== 'unknown' && (
        <p className='chatDiagnosisSeverity'>
          Состояние: {SEVERITY_LABELS[diagnosis.severity] || diagnosis.severity}
        </p>
      )}
      {advice.length > 0 && (
        <div className='chatDiagnosisSection'>
          <span className='chatDiagnosisSectionTitle'>Что сделать</span>
          <ul className='chatDiagnosisList'>
            {advice.map((item, index) => (
              <li key={`a-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {diagnosis.needsAnotherPhoto && (
        <p className='chatDiagnosisHint'>
          Для уточнения лучше сделать ещё одно фото — крупным планом листьев с двух сторон.
        </p>
      )}
      <p className='chatDiagnosisDisclaimer'>
        Это предварительная оценка, а не диагноз. При сомнениях покажите растение специалисту.
      </p>
    </div>
  )
}

function Chat ({ sessionId, onOpenHistory, onNewChat, onSessionsChanged }) {
  const [messages, setMessages] = useState([createGreeting()])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(Boolean(sessionId))
  const [attachedFiles, setAttachedFiles] = useState([])
  const [attachError, setAttachError] = useState('')
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const atBottomRef = useRef(true)
  const sessionRef = useRef(sessionId)
  const activeRequestRef = useRef(null)
  const cancelledRef = useRef(false)

  const scrollToBottom = () => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }

  const handleMessagesScroll = () => {
    const list = listRef.current
    if (!list) return
    atBottomRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX
  }

  useLayoutEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    if (!vv) return undefined

    let frame = 0
    let settleTimers = []
    let keyboardOpen = false
    let restHeight = Math.max(vv.height, window.innerHeight)
    let restWidth = window.innerWidth

    const clearSettleTimers = () => {
      settleTimers.forEach(timer => window.clearTimeout(timer))
      settleTimers = []
    }

    const resetPageScroll = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
      if (root.scrollTop) root.scrollTop = 0
      if (document.body.scrollTop) document.body.scrollTop = 0
    }

    const sync = () => {
      frame = 0
      const height = Math.max(1, Math.round(vv.height))
      const layoutHeight = window.innerHeight
      const inputFocused = document.activeElement === inputRef.current

      if (window.innerWidth !== restWidth) {
        restWidth = window.innerWidth
        restHeight = Math.max(height, layoutHeight)
      }
      if (!inputFocused) restHeight = Math.max(restHeight, height)

      const isKeyboardOpen =
        inputFocused && restHeight - height > KEYBOARD_MIN_HEIGHT

      const maxTop = Math.max(0, layoutHeight - height)
      const shouldAnchor = inputFocused && (isKeyboardOpen || vv.offsetTop > 0)
      const top = shouldAnchor
        ? Math.min(Math.max(0, Math.round(vv.offsetTop)), maxTop)
        : 0

      root.style.setProperty('--visual-viewport-top', `${top}px`)
      root.style.setProperty('--visual-viewport-height', `${height}px`)
      document.body.classList.toggle('keyboard-open', isKeyboardOpen)

      if (isKeyboardOpen !== keyboardOpen) {
        keyboardOpen = isKeyboardOpen
        window.requestAnimationFrame(() => {
          if (isKeyboardOpen || atBottomRef.current) scrollToBottom()
        })
      }
    }

    const settle = () => {
      clearSettleTimers()
      settleTimers = KEYBOARD_SETTLE_DELAYS.map(delay => window.setTimeout(() => {
        resetPageScroll()
        sync()
        if (atBottomRef.current) scrollToBottom()
      }, delay))
    }

    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(sync)
    }

    const handleViewportChange = () => {
      schedule()
      settle()
    }

    const handleFocusChange = () => {
      schedule()
      settle()
    }

    sync()
    vv.addEventListener('resize', handleViewportChange)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)
    window.addEventListener('focusin', handleFocusChange)
    window.addEventListener('focusout', handleFocusChange)
    window.addEventListener('pageshow', handleViewportChange)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      clearSettleTimers()
      vv.removeEventListener('resize', handleViewportChange)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
      window.removeEventListener('focusin', handleFocusChange)
      window.removeEventListener('focusout', handleFocusChange)
      window.removeEventListener('pageshow', handleViewportChange)
      root.style.removeProperty('--visual-viewport-top')
      root.style.removeProperty('--visual-viewport-height')
      document.body.classList.remove('keyboard-open')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)

    sessionRef.current = sessionId
    setMessages([createGreeting()])
    setInput('')
    setAttachedFiles([])
    setAttachError('')
    setIsTyping(false)
    setIsAnalyzingPhoto(false)
    atBottomRef.current = true

    if (!sessionId) {
      setIsLoadingHistory(false)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
        controller.abort()
      }
    }

    setIsLoadingHistory(true)

    const loadHistory = async () => {
      try {
        const res = await fetch(
          `${API_URL}/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=${HISTORY_LIMIT}`,
          {
            credentials: 'include',
            signal: controller.signal
          }
        )
        if (!res.ok) return

        const data = await res.json()
        if (cancelled) return

        const items = Array.isArray(data?.items) ? data.items : []
        if (!items.length) return

        setMessages([createGreeting(), ...items.map(historyItemToMessage)])
      } catch (error) {
        if (error?.name !== 'AbortError')
          console.error('Chat history error:', error)
      } finally {
        window.clearTimeout(timer)
        if (!cancelled) setIsLoadingHistory(false)
      }
    }

    loadHistory()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId])

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return undefined
    if (last.role !== 'user' && !atBottomRef.current) return undefined

    atBottomRef.current = true
    const frame = window.requestAnimationFrame(scrollToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [messages, isTyping])

  useLayoutEffect(() => {
    const field = inputRef.current
    if (!field) return

    const previousHeight = field.offsetHeight
    field.style.height = 'auto'
    const nextHeight = Math.min(field.scrollHeight, MAX_INPUT_HEIGHT)
    field.style.height = `${nextHeight}px`
    field.style.overflowY =
      field.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'

    if (nextHeight > previousHeight && atBottomRef.current) {
      window.requestAnimationFrame(scrollToBottom)
    }
  }, [input])

  const notifySessionsChanged = () => {
    onSessionsChanged?.()
  }

  const sendMessage = async rawText => {
    const text = (rawText ?? input).trim()
    if (!text || isTyping) return

    const requestSession = sessionId
    const userMsg = {
      id: createLocalId('u'),
      role: 'user',
      text,
      createdAt: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)
    setIsAnalyzingPhoto(false)
    cancelledRef.current = false

    const controller = new AbortController()
    activeRequestRef.current = { controller, kind: 'message' }
    const timer = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)

    try {
      const res = await fetch(`${API_URL}/chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          sessionId: sessionId || undefined
        })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }

      const data = await res.json()

      if (sessionRef.current === requestSession) {
        setMessages(prev => [
          ...prev,
          {
            id: createLocalId('a'),
            role: 'assistant',
            text: data.text,
            createdAt: new Date().toISOString()
          }
        ])
      }
      notifySessionsChanged()
    } catch (e) {
      const cancelled = cancelledRef.current
      const timedOut = e?.name === 'AbortError' && !cancelled
      if (!cancelled) console.error('Chat error:', e)
      if (sessionRef.current === requestSession) {
        setMessages(prev => [
          ...prev,
          {
            id: createLocalId('e'),
            role: 'assistant',
            text: cancelled
              ? 'Ответ отменён. Можно спросить ещё раз.'
              : timedOut
              ? '⏳ ИИ-помощник не успел ответить. Попробуйте ещё раз — я на связи.'
              : e?.message && e.message !== 'Failed to fetch'
              ? `⚠️ ${e.message}`
              : '⚠️ Что-то пошло не так. Попробуй ещё раз.',
            createdAt: new Date().toISOString()
          }
        ])
      }
    } finally {
      window.clearTimeout(timer)
      if (activeRequestRef.current?.controller === controller) {
        activeRequestRef.current = null
      }
      if (sessionRef.current === requestSession) setIsTyping(false)
    }
  }

  const cancelAiResponse = () => {
    const active = activeRequestRef.current
    if (!active) return
    cancelledRef.current = true
    active.controller.abort()
    setIsTyping(false)
  }

  const sendPhoto = async () => {
    const files = attachedFiles
    if (!files.length || isTyping) return

    if (files.length > MAX_PHOTOS) {
      setAttachError(`Можно прикрепить не больше ${MAX_PHOTOS} фото`)
      return
    }
    if (files.some(file => file.size > MAX_PHOTO_BYTES)) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      return
    }

    const text = input.trim()
    const requestSession = sessionId
    const messageId = createLocalId('u')
    const localPhotoUrls = files.map(file => URL.createObjectURL(file))

    setMessages(prev => [
      ...prev,
      {
        id: messageId,
        role: 'user',
        text: text || 'Проверьте, пожалуйста, фото растения',
        photoUrls: localPhotoUrls,
        createdAt: new Date().toISOString()
      }
    ])
    setInput('')
    setAttachedFiles([])
    setAttachError('')
    setIsTyping(true)
    setIsAnalyzingPhoto(true)
    cancelledRef.current = false

    const controller = new AbortController()
    activeRequestRef.current = { controller, kind: 'photo' }
    const timer = window.setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS)

    try {
      const uploadFiles = await Promise.all(files.map(preparePhotoForUpload))
      const formData = new FormData()
      uploadFiles.forEach((file, index) => {
        formData.append('photo', file, file.name || `photo-${index + 1}.jpg`)
      })
      if (text) formData.append('message', text)
      if (sessionId) formData.append('sessionId', sessionId)

      const res = await fetch(`${API_URL}/chat/photo`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        body: formData
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`)

      const uploadedPhotoUrls = Array.isArray(data.photoUrls) && data.photoUrls.length
        ? data.photoUrls
        : (data.photoUrl ? [data.photoUrl] : [])

      if (sessionRef.current === requestSession) {
        setMessages(prev => [
          ...prev,
          {
            id: createLocalId('a'),
            role: 'assistant',
            text: data.text,
            diagnosis: data.diagnosis || null,
            createdAt: new Date().toISOString()
          }
        ])

        if (uploadedPhotoUrls.length) {
          setMessages(prev => prev.map(message => (
            message.id === messageId
              ? { ...message, photoUrls: uploadedPhotoUrls }
              : message
          )))
        }
      }

      if (uploadedPhotoUrls.length) {
        localPhotoUrls.forEach(url => URL.revokeObjectURL(url))
      }

      notifySessionsChanged()
    } catch (e) {
      const cancelled = cancelledRef.current
      const timedOut = e?.name === 'AbortError' && !cancelled
      if (!cancelled) console.error('Photo chat error:', e)
      if (sessionRef.current === requestSession) {
        setMessages(prev => [
          ...prev,
          {
            id: createLocalId('e'),
            role: 'assistant',
            text: cancelled
              ? 'Разбор фото отменён.'
              : timedOut
                ? '⏳ Разбор фото занял слишком много времени. Попробуйте ещё раз — модель иногда думает долго.'
                : e?.message && e.message !== 'Failed to fetch'
                  ? `⚠️ ${e.message}`
                  : '⚠️ Не удалось разобрать фото. Попробуйте другое фото.',
            createdAt: new Date().toISOString()
          }
        ])
      }
    } finally {
      window.clearTimeout(timer)
      if (activeRequestRef.current?.controller === controller) {
        activeRequestRef.current = null
      }
      if (sessionRef.current === requestSession) {
        setIsTyping(false)
        setIsAnalyzingPhoto(false)
      }
    }
  }

  const handleSend = () => {
    if (attachedFiles.length) return sendPhoto()
    return sendMessage()
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const removeAttachedFile = index => {
    setAttachedFiles(prev => prev.filter((_, fileIndex) => fileIndex !== index))
    setAttachError('')
  }

  const handleFileChange = e => {
    const selected = Array.from(e.target.files || [])
    e.target.value = ''
    if (!selected.length) return

    if (selected.some(file => file.size > MAX_PHOTO_BYTES)) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      return
    }

    const next = [...attachedFiles, ...selected]
    if (next.length > MAX_PHOTOS) {
      setAttachError(`Можно прикрепить не больше ${MAX_PHOTOS} фото — лишние не добавлены.`)
      setAttachedFiles(next.slice(0, MAX_PHOTOS))
      return
    }

    setAttachError('')
    setAttachedFiles(next)
  }

  return (
    <div className='chatWindow'>
      <div className='chatHeader'>
        <div className='chatHeaderLeft'>
          <div className='chatAvatar'>
            <img src={IconLeaf} alt='' />
          </div>
          <div>
            <p className='chatHeaderTitle'>ИИ-помощник Лейка</p>
            <p className='chatHeaderSubtitle'>
              Онлайн • помню контекст разговора
            </p>
          </div>
        </div>
        <div className='chatHeaderActions'>
          <button
            className='chatMenuBtn chatNewChatBtn'
            type='button'
            aria-label='Новый чат'
            title='Новый чат'
            onClick={onNewChat}
          >
            <ThemedIcon src={NewChatBtn} alt='' />
          </button>
          <button
            className='chatMenuBtn chatHistoryBtn'
            type='button'
            aria-label='История чатов'
            title='История чатов'
            onClick={onOpenHistory}
          >
            <ThemedIcon src={HistoryBtn} alt='' />
          </button>
        </div>
      </div>
      <div
        className='chatMessages'
        ref={listRef}
        onScroll={handleMessagesScroll}
        role='log'
        aria-live='polite'
        aria-relevant='additions'
        aria-label='Сообщения чата'
      >
        {messages.map(m => (
          <div
            key={m.id}
            className={`chatRow ${m.role === 'user' ? 'chatRowUser' : ''}`}
          >
            <div
              className={`chatBubble ${
                m.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAi'
              }`}
            >
              {m.role === 'user' && m.photoUrls?.length > 0 && (
                <div
                  className={`chatPhotoGrid ${
                    m.photoUrls.length > 1 ? 'chatPhotoGrid--multiple' : 'chatPhotoGrid--single'
                  }`}
                >
                  {m.photoUrls.map((url, index) => (
                    <img
                      key={`${m.id}-photo-${index}`}
                      className='chatPhoto'
                      src={url}
                      alt={`Фото растения ${index + 1}`}
                      loading='lazy'
                      onLoad={() => {
                        if (atBottomRef.current) scrollToBottom()
                      }}
                    />
                  ))}
                </div>
              )}
              {m.diagnosis ? (
                <DiagnosisCard diagnosis={m.diagnosis} />
              ) : m.role === 'user' ? (
                <p className='chatBubbleText'>{m.text}</p>
              ) : (
                <div className='chatBubbleText chatBubbleMarkdown'>
                  <MarkdownText text={m.text} />
                </div>
              )}
              {m.advice && (
                <div className='chatAiAdviceBox'>
                  <span className='chatAiAdviceLabel'>Совет ИИ</span>
                  <p className='chatAiAdviceText'>{m.advice}</p>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoadingHistory && !isTyping && (
          <div className='chatRow'>
            <div className='chatBubble chatBubbleAi chatBubbleTyping'>
              <span className='chatDot' />
              <span className='chatDot' />
              <span className='chatDot' />
              <span className='chatTypingLabel'>Загружаю историю…</span>
            </div>
          </div>
        )}

        {isTyping && (
          <div className='chatRow chatRowTyping'>
            <div className='chatBubble chatBubbleAi chatBubbleTyping' aria-hidden='true'>
              <span className='chatDot' />
              <span className='chatDot' />
              <span className='chatDot' />
              <span className='chatTypingLabel'>
                {isAnalyzingPhoto ? 'Изучаю фото…' : 'Печатает…'}
              </span>
            </div>
            <button
              type='button'
              className='chatCancelBtn'
              onClick={cancelAiResponse}
            >
              Отмена
            </button>
          </div>
        )}
      </div>

      <span className='visuallyHidden' role='status' aria-live='polite'>
        {isTyping
          ? (isAnalyzingPhoto ? 'Изучаю фото растения…' : 'ИИ-помощник печатает ответ…')
          : ''}
      </span>

      <div className='chatInputArea'>
        {attachError && (
          <p className='chatAttachError'>{attachError}</p>
        )}
        {attachedFiles.length > 0 && (
          <div className='chatAttachments'>
            <div className='chatAttachmentsList'>
              {attachedFiles.map((file, index) => (
                <div className='chatAttachmentChip' key={`${file.name}-${file.lastModified}-${index}`}>
                  <img src={Paperclip} alt='' aria-hidden='true' />
                  <span className='chatAttachmentName' title={file.name}>
                    {file.name}
                  </span>
                  <button
                    type='button'
                    className='chatAttachmentRemove'
                    onClick={() => removeAttachedFile(index)}
                    aria-label={`Убрать ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <span className='chatAttachmentsCount'>
              {attachedFiles.length} из {MAX_PHOTOS}
            </span>
          </div>
        )}
        <div className='chatInputWrapper'>
          <label className='fileLabelForAlice'>
            <input
              type='file'
              className='fileForAlice'
              accept='image/jpeg,image/png,image/webp,image/heic'
              multiple
              onChange={handleFileChange}
              aria-label={`Прикрепить фото растения, до ${MAX_PHOTOS}`}
              disabled={isTyping}
            />
            <img src={Paperclip} alt='' aria-hidden='true' />
          </label>
          <textarea
            ref={inputRef}
            className='chatInputField'
            aria-label='Сообщение ИИ-помощнику'
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Спросите про полив или фото'
            rows={1}
            disabled={isTyping}
          />
          <button
            type='button'
            className='chatActionBtn'
            onClick={handleSend}
            disabled={isTyping || (!input.trim() && !attachedFiles.length)}
            aria-label='Отправить'
          >
            <img src={IconSend} alt='' />
          </button>
        </div>
      </div>
    </div>
  )
}

export default Chat
