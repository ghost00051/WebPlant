import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import './chat.css'
import './dark-theme.css'
import './adaptiv.css'
import IconLeaf from '../../assets/IconLeaf.svg'
import IconMenu from '../../assets/IconMenu.svg'
import IconSend from '../../assets/IconSend.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import Paperclip from '../../assets/paperclip.svg'
import { API_URL } from '../../utils/api.js'

const CHAT_TIMEOUT_MS = 30000
const PHOTO_TIMEOUT_MS = 90000
const HISTORY_LIMIT = 50
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_MAX_SIDE = 1600
const MAX_INPUT_HEIGHT = 140
const NEAR_BOTTOM_PX = 120
const KEYBOARD_MIN_HEIGHT = 120

const CONFIDENCE_LABELS = { high: 'высокая', medium: 'средняя', low: 'низкая' }
const SEVERITY_LABELS = {
  none: 'признаков нет',
  mild: 'лёгкое',
  moderate: 'умеренное',
  severe: 'сильное',
  unknown: 'не определено'
}

const GREETING =
  'Привет! Я ИИ-помощник — помогу уследить за поливом и уходом за растениями. Напиши «Что полить?», «Покажи график» или «Сколько у меня растений?» — всё покажу. Можешь прикрепить фото растения — посмотрю, что с ним.'

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

function Chat () {
  const [messages, setMessages] = useState([
    {
      id: 'greeting',
      role: 'assistant',
      text: GREETING,
      createdAt: new Date().toISOString()
    }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [attachedFile, setAttachedFile] = useState(null)
  const [attachError, setAttachError] = useState('')
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const atBottomRef = useRef(true)

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
    // Highest visual-viewport height seen while the input is not focused:
    // the difference to the current height is the keyboard height.
    let restHeight = Math.max(vv.height, window.innerHeight)
    let restWidth = window.innerWidth
    let keyboardOpen = false

    const sync = () => {
      frame = 0
      const height = Math.max(1, vv.height)
      const layoutHeight = window.innerHeight
      const inputFocused = document.activeElement === inputRef.current

      if (window.innerWidth !== restWidth) {
        // Orientation change or a real window resize, not the keyboard.
        restWidth = window.innerWidth
        restHeight = Math.max(height, layoutHeight)
      }
      if (!inputFocused) restHeight = Math.max(restHeight, height)

      const isKeyboardOpen =
        inputFocused && restHeight - height > KEYBOARD_MIN_HEIGHT

      // On iOS the layout viewport does not shrink when the keyboard opens:
      // the visual viewport is panned instead. Re-anchor the whole app to the
      // visible area and clamp the offset, because iOS sometimes leaves
      // visualViewport.offsetTop stuck after the keyboard is dismissed.
      const maxTop = Math.max(0, layoutHeight - height)
      const top = isKeyboardOpen
        ? Math.min(Math.max(0, vv.offsetTop), maxTop)
        : 0

      root.style.setProperty('--visual-viewport-top', `${Math.round(top)}px`)
      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`)
      document.body.classList.toggle('keyboard-open', isKeyboardOpen)

      if (isKeyboardOpen !== keyboardOpen) {
        keyboardOpen = isKeyboardOpen
        window.requestAnimationFrame(() => {
          if (isKeyboardOpen || atBottomRef.current) scrollToBottom()
        })
      }
    }

    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(sync)
    }

    sync()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)
    window.addEventListener('pageshow', schedule)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
      window.removeEventListener('pageshow', schedule)
      root.style.removeProperty('--visual-viewport-top')
      root.style.removeProperty('--visual-viewport-height')
      document.body.classList.remove('keyboard-open')
    }
  }, [])

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

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)

    const loadHistory = async () => {
      try {
        const res = await fetch(
          `${API_URL}/chat/history?limit=${HISTORY_LIMIT}`,
          {
            credentials: 'include',
            signal: controller.signal
          }
        )
        if (!res.ok) return

        const data = await res.json()
        if (cancelled) return

        if (data?.sessionId) setSessionId(data.sessionId)

        const items = Array.isArray(data?.items) ? data.items : []
        if (!items.length) return

        setMessages([
          {
            id: 'greeting',
            role: 'assistant',
            text: GREETING,
            createdAt: new Date().toISOString()
          },
          ...items.map(item => ({
            id: `h-${item.id}`,
            role: item.role === 'user' ? 'user' : 'assistant',
            text: item.text,
            createdAt: item.createdAt,
            photoUrl: item.photoUrl || null,
            diagnosis: item.diagnosis || null
          }))
        ])
      } catch (error) {
        if (error?.name !== 'AbortError')
          console.error('Chat history error:', error)
      } finally {
        window.clearTimeout(timer)
      }
    }

    loadHistory()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const sendMessage = async rawText => {
    const text = (rawText ?? input).trim()
    if (!text || isTyping) return

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    const controller = new AbortController()
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
      if (data?.sessionId) setSessionId(data.sessionId)

      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.text,
          createdAt: new Date().toISOString()
        }
      ])
    } catch (e) {
      const timedOut = e?.name === 'AbortError'
      console.error('Chat error:', e)
      setMessages(prev => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: timedOut
            ? '⏳ Алиса не успела ответить. Попробуйте ещё раз — я на связи.'
            : e?.message && e.message !== 'Failed to fetch'
            ? `⚠️ ${e.message}`
            : '⚠️ Что-то пошло не так. Попробуй ещё раз.',
          createdAt: new Date().toISOString()
        }
      ])
    } finally {
      window.clearTimeout(timer)
      setIsTyping(false)
    }
  }

  const sendPhoto = async () => {
    const file = attachedFile
    if (!file || isTyping) return

    if (file.size > MAX_PHOTO_BYTES) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      return
    }

    const text = input.trim()
    const localPhotoUrl = URL.createObjectURL(file)

    setMessages(prev => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text: text || 'Проверьте, пожалуйста, фото растения',
        photoUrl: localPhotoUrl,
        createdAt: new Date().toISOString()
      }
    ])
    setInput('')
    setAttachedFile(null)
    setAttachError('')
    setIsTyping(true)
    setIsAnalyzingPhoto(true)

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS)

    try {
      const uploadFile = await preparePhotoForUpload(file)
      const formData = new FormData()
      formData.append('photo', uploadFile, uploadFile.name || 'photo.jpg')
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
      if (data?.sessionId) setSessionId(data.sessionId)

      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.text,
          diagnosis: data.diagnosis || null,
          createdAt: new Date().toISOString()
        }
      ])

      if (data.photoUrl) {
        setMessages(prev => prev.map(message => (
          message.photoUrl === localPhotoUrl
            ? { ...message, photoUrl: data.photoUrl }
            : message
        )))
        URL.revokeObjectURL(localPhotoUrl)
      }
    } catch (e) {
      const timedOut = e?.name === 'AbortError'
      console.error('Photo chat error:', e)
      setMessages(prev => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: timedOut
            ? '⏳ Разбор фото занял слишком много времени. Попробуйте ещё раз — модель иногда думает долго.'
            : e?.message && e.message !== 'Failed to fetch'
              ? `⚠️ ${e.message}`
              : '⚠️ Не удалось разобрать фото. Попробуйте другое фото.',
          createdAt: new Date().toISOString()
        }
      ])
    } finally {
      window.clearTimeout(timer)
      setIsTyping(false)
      setIsAnalyzingPhoto(false)
    }
  }

  const handleSend = () => {
    if (attachedFile) return sendPhoto()
    return sendMessage()
  }

  const clearHistory = async () => {
    if (isTyping) return

    if (!sessionId) {
      setMessages(prev => prev.filter(message => message.id === 'greeting'))
      return
    }
    if (!window.confirm('Очистить историю чата?')) return

    try {
      const res = await fetch(`${API_URL}/chat/history`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }

      setSessionId(null)
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          text: GREETING,
          createdAt: new Date().toISOString()
        }
      ])
    } catch (error) {
      console.error('Clear chat error:', error)
    }
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = e => {
    const file = e.target.files?.[0] || null
    if (file && file.size > MAX_PHOTO_BYTES) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      setAttachedFile(null)
    } else {
      setAttachError('')
      setAttachedFile(file)
    }
    e.target.value = ''
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
              Онлайн • помогу с поливом и уходом
            </p>
          </div>
        </div>
        <button
          className='chatMenuBtn'
          type='button'
          aria-label='Очистить историю'
          title='Очистить историю'
          onClick={clearHistory}
        >
          <ThemedIcon src={IconMenu} alt='' />
        </button>
      </div>
      <div className='chatMessages' ref={listRef} onScroll={handleMessagesScroll}>
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
              {m.photoUrl && m.role === 'user' && (
                <img
                  className='chatPhoto'
                  src={m.photoUrl}
                  alt='Фото растения'
                  loading='lazy'
                  onLoad={() => {
                    if (atBottomRef.current) scrollToBottom()
                  }}
                />
              )}
              {m.diagnosis ? (
                <DiagnosisCard diagnosis={m.diagnosis} />
              ) : (
                <p className='chatBubbleText'>{m.text}</p>
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

        {isTyping && (
          <div className='chatRow'>
            <div className='chatBubble chatBubbleAi chatBubbleTyping'>
              <span className='chatDot' />
              <span className='chatDot' />
              <span className='chatDot' />
              {isAnalyzingPhoto && (
                <span className='chatTypingLabel'>Изучаю фото…</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className='chatInputArea'>
        {attachError && (
          <p className='chatAttachError'>{attachError}</p>
        )}
        {attachedFile && (
          <div className='chatAttachmentChip'>
            <img src={Paperclip} alt='' aria-hidden='true' />
            <span className='chatAttachmentName' title={attachedFile.name}>
              {attachedFile.name}
            </span>
            <button
              type='button'
              className='chatAttachmentRemove'
              onClick={() => setAttachedFile(null)}
              aria-label='Убрать выбранный файл'
            >
              ×
            </button>
          </div>
        )}
        <div className='chatInputWrapper'>
          <label className='fileLabelForAlice'>
            <input
              type='file'
              className='fileForAlice'
              accept='image/jpeg,image/png,image/webp,image/heic'
              onChange={handleFileChange}
              aria-label='Прикрепить фото растения'
              disabled={isTyping}
            />
            <img src={Paperclip} alt='' aria-hidden='true' />
          </label>
          <textarea
            ref={inputRef}
            className='chatInputField'
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
            disabled={isTyping || (!input.trim() && !attachedFile)}
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