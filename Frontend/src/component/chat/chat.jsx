import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import './chat.css'
import './dark-theme.css'
import './adaptiv.css'
import IconLeaf from '../../assets/IconLeaf.svg'
import IconSend from '../../assets/IconSend.svg'
import NewChatBtn from '../../assets/NewChatBtn.svg'
import HistoryBtn from '../../assets/HistoryBtn.svg'
import CameraIcon from '../../assets/camera.svg'
import Paperclip from '../../assets/paperclip.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'
import { trackEvent } from '../../utils/productEvents.js'

const CHAT_TIMEOUT_MS = 30000
const PHOTO_TIMEOUT_MS = 150000
const HISTORY_LIMIT = 50
const MAX_PHOTOS = 5
const DIAGNOSIS_MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_MAX_SIDE = 1600
const MAX_INPUT_HEIGHT = 140
const NEAR_BOTTOM_PX = 120
const KEYBOARD_MIN_HEIGHT = 120
const KEYBOARD_SETTLE_DELAYS = [0, 60, 140, 260, 420, 650, 900]
const PLANTS_TIMEOUT_MS = 12000

const GENERIC_STARTERS = [
  'Что полить сегодня?',
  'Покажи график полива',
  'Сколько у меня растений?'
]

const QUICK_INTERVALS = [3, 5, 7, 10, 14]

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

function dayWord(count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня'
  return 'дней'
}

function photoWord(count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'фото'
  return 'фото'
}

function plantOptionLabel(plant) {
  const name = String(plant?.name || '').trim()
  const species = String(plant?.species || '').trim()
  if (name) return name
  return species || 'Растение'
}

function findSuggestedPlantId(plants, text) {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return null
  const found = plants.find(plant => {
    const name = String(plant?.name || '').trim().toLowerCase()
    return name.length >= 3 && haystack.includes(name)
  })
  return found ? found.id : null
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

async function preparePhotoForUpload(file) {
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

function DiagnosisCard({ diagnosis }) {
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

function ApplyAdvicePanel({ plants, suggestedPlantId, onSaved, onAddPlant }) {
  const initialPlant = plants.find(plant => plant.id === suggestedPlantId) || plants[0] || null
  const [plantId, setPlantId] = useState(initialPlant ? String(initialPlant.id) : '')
  const [days, setDays] = useState(String(initialPlant?.watering_interval_days || 7))
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)

  const selectedPlant = plants.find(plant => String(plant.id) === plantId) || null

  const save = async () => {
    if (!selectedPlant || saving) return
    const interval = Number.parseInt(days, 10)
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
      setStatus({ tone: 'error', text: 'Интервал — целое число от 1 до 365 дней.' })
      return
    }

    setSaving(true)
    setStatus(null)
    try {
      const response = await fetch(`${API_URL}/plants/${selectedPlant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ watering_interval_days: interval })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Не удалось сохранить график (HTTP ${response.status})`)
      }
      const updated = data && typeof data === 'object' && data.id
        ? { ...selectedPlant, ...data, watering_interval_days: interval }
        : { ...selectedPlant, watering_interval_days: interval }
      onSaved?.(updated)
      setStatus({
        tone: 'success',
        text: `График «${selectedPlant.name}» обновлён: полив каждые ${interval} ${dayWord(interval)}.`
      })
    } catch (error) {
      console.warn('Не удалось применить совет по поливу:', error)
      setStatus({
        tone: 'error',
        text: error?.message || 'Не удалось сохранить график. Проверьте подключение и попробуйте ещё раз.'
      })
    } finally {
      setSaving(false)
    }
  }

  if (!plants.length) {
    return (
      <div className='chatAdvicePanel'>
        <p className='chatAdviceText'>
          Чтобы применить совет, нужно растение в вашем саду. Добавим его?
        </p>
        <div className='chatAdviceActions'>
          <button type='button' className='chatAdvicePrimary' onClick={onAddPlant}>
            Добавить в растения
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='chatAdvicePanel'>
      <p className='chatAdviceText'>
        Поправлю график полива по совету. Выберите растение и интервал — сохраню сразу.
      </p>
      <div className='chatAdviceRows'>
        <label className='chatAdviceField'>
          <span className='chatAdviceLabel'>Растение</span>
          <select
            className='chatAdviceSelect'
            value={plantId}
            onChange={event => {
              const nextId = event.target.value
              const nextPlant = plants.find(plant => String(plant.id) === nextId)
              setPlantId(nextId)
              if (nextPlant) setDays(String(nextPlant.watering_interval_days || 7))
              setStatus(null)
            }}
            disabled={saving}
          >
            {plants.map(plant => (
              <option key={plant.id} value={plant.id}>
                {plantOptionLabel(plant)}
              </option>
            ))}
          </select>
        </label>
        <label className='chatAdviceField chatAdviceField--days'>
          <span className='chatAdviceLabel'>Полив, дней</span>
          <input
            className='chatAdviceInput'
            type='number'
            inputMode='numeric'
            min='1'
            max='365'
            value={days}
            onChange={event => {
              setDays(event.target.value)
              setStatus(null)
            }}
            disabled={saving}
          />
        </label>
      </div>
      <div className='chatAdviceChips' role='group' aria-label='Быстрый выбор интервала'>
        {QUICK_INTERVALS.map(value => (
          <button
            key={value}
            type='button'
            className={`chatAdviceChip${String(value) === String(days) ? ' is-active' : ''}`}
            onClick={() => {
              setDays(String(value))
              setStatus(null)
            }}
            disabled={saving}
          >
            {value} {dayWord(value)}
          </button>
        ))}
      </div>
      {selectedPlant && (
        <p className='chatAdviceCurrent'>
          Сейчас: полив каждые {selectedPlant.watering_interval_days || 7} {dayWord(selectedPlant.watering_interval_days || 7)}
        </p>
      )}
      {status && (
        <p
          className={`chatAdviceStatus chatAdviceStatus--${status.tone}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      )}
      <div className='chatAdviceActions'>
        <button
          type='button'
          className='chatAdvicePrimary'
          onClick={save}
          disabled={saving || !selectedPlant}
        >
          {saving ? 'Сохраняю…' : 'Применить к графику'}
        </button>
        <button type='button' className='chatAdviceSecondary' onClick={onAddPlant}>
          Добавить в растения
        </button>
      </div>
    </div>
  )
}

function AddToPlantDialog({ plants, message, busy, error, onSelect, onClose, onAddPlant }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector('button')?.focus?.()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      previouslyFocused?.focus?.()
    }
  }, [])

  const diagnosisName = String(message?.diagnosis?.plantName || '').toLowerCase()
  const sorted = useMemo(() => {
    if (!diagnosisName) return plants
    return [...plants].sort((left, right) => {
      const leftMatch = String(left.name || '').toLowerCase()
      const rightMatch = String(right.name || '').toLowerCase()
      const leftScore = diagnosisName.includes(leftMatch) && leftMatch ? 1 : 0
      const rightScore = diagnosisName.includes(rightMatch) && rightMatch ? 1 : 0
      return rightScore - leftScore
    })
  }, [plants, diagnosisName])

  return (
    <div
      className='chatDialogOverlay'
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className='chatDialog'
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='chatAddToPlantTitle'
      >
        <header className='chatDialogHeader'>
          <h2 id='chatAddToPlantTitle'>Добавить в растение</h2>
          <button
            type='button'
            className='chatDialogClose'
            onClick={onClose}
            aria-label='Закрыть'
          >
            ×
          </button>
        </header>

        <p className='chatDialogText'>
          Фото и разбор сохранятся в галерее растения — потом пригодятся для истории роста.
        </p>

        {error && <p className='chatDialogError' role='alert'>{error}</p>}

        {sorted.length === 0 ? (
          <div className='chatDialogEmpty'>
            <p>В саду пока нет растений. Добавим первое — и диагноз сохранится в его карточке.</p>
            <button type='button' className='chatAdvicePrimary' onClick={onAddPlant}>
              Добавить растение
            </button>
          </div>
        ) : (
          <ul className='chatDialogList'>
            {sorted.map(plant => (
              <li key={plant.id}>
                <button
                  type='button'
                  className='chatDialogPlant'
                  onClick={() => onSelect(plant)}
                  disabled={busy}
                >
                  <span className='chatDialogPlantName'>{plant.name}</span>
                  {plant.species && (
                    <span className='chatDialogPlantSpecies'>{plant.species}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {busy && <p className='chatDialogStatus' role='status'>Сохраняю фото в растение…</p>}
        <div className='chatDialogActions'>
          <button type='button' className='chatAdviceSecondary' onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </section>
    </div>
  )
}

function ChatSession({ sessionId, onOpenHistory, onNewChat, onSessionsChanged, isGuest = false }) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState([createGreeting()])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(Boolean(sessionId))
  const [attachedFiles, setAttachedFiles] = useState([])
  const [attachError, setAttachError] = useState('')
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)
  const [plants, setPlants] = useState([])
  const [diagnosisFiles, setDiagnosisFiles] = useState([])
  const [addToPlantMessage, setAddToPlantMessage] = useState(null)
  const [plantAttachBusy, setPlantAttachBusy] = useState(false)
  const [plantAttachError, setPlantAttachError] = useState('')
  const [adviceOpenId, setAdviceOpenId] = useState(null)

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const diagnosisInputRef = useRef(null)
  const atBottomRef = useRef(true)
  const sessionRef = useRef(sessionId)
  const activeRequestRef = useRef(null)
  const cancelledRef = useRef(false)
  const sendingRef = useRef(false)

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

  const attachmentPreviews = useMemo(
    () => attachedFiles.map(file => ({ file, url: URL.createObjectURL(file) })),
    [attachedFiles]
  )

  const diagnosisPreviews = useMemo(
    () => diagnosisFiles.map(file => ({ file, url: URL.createObjectURL(file) })),
    [diagnosisFiles]
  )

  useEffect(() => () => {
    attachmentPreviews.forEach(preview => URL.revokeObjectURL(preview.url))
  }, [attachmentPreviews])

  useEffect(() => () => {
    diagnosisPreviews.forEach(preview => URL.revokeObjectURL(preview.url))
  }, [diagnosisPreviews])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), PLANTS_TIMEOUT_MS)

    const loadPlants = async () => {
      try {
        const response = await fetch(`${API_URL}/plants`, {
          credentials: 'include',
          signal: controller.signal
        })
        if (!response.ok) return
        const data = await response.json().catch(() => null)
        if (cancelled || !Array.isArray(data)) return
        setPlants(data.filter(plant => plant && plant.is_active !== false))
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('Не удалось загрузить растения для подсказок чата:', error)
        }
      } finally {
        window.clearTimeout(timer)
      }
    }

    loadPlants()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const starterPrompts = useMemo(() => {
    const prompts = []
    plants.slice(0, 2).forEach(plant => {
      const name = String(plant.name || '').trim().replace(/[«»"]/g, '')
      if (!name) return
      prompts.push(`«${name}»: почему желтеют листья?`)
      prompts.push(`«${name}»: как часто поливать?`)
    })
    return [...prompts, ...GENERIC_STARTERS].slice(0, 5)
  }, [plants])

  const showStarters =
    messages.length === 1 && !isTyping && !isLoadingHistory && diagnosisFiles.length === 0

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

  useEffect(() => () => {
    cancelledRef.current = true
    activeRequestRef.current?.controller?.abort()
    activeRequestRef.current = null
    sendingRef.current = false
  }, [])

  useEffect(() => {
    if (!diagnosisFiles.length && !addToPlantMessage) return undefined

    const handleKeyDown = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (addToPlantMessage) {
        setAddToPlantMessage(null)
        setPlantAttachError('')
      } else {
        setDiagnosisFiles([])
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [diagnosisFiles.length, addToPlantMessage])

  useEffect(() => {
    if (!sessionId) return undefined

    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)

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

  const beginSending = () => {
    if (sendingRef.current) return false
    sendingRef.current = true
    return true
  }

  const addErrorMessage = (requestSession, error, { cancelled, timedOut, fallback, retry, kind }) => {
    if (sessionRef.current !== requestSession) return
    setMessages(prev => [
      ...prev,
      {
        id: createLocalId('e'),
        role: 'assistant',
        text: cancelled
          ? kind === 'photo'
            ? 'Разбор фото отменён. Можно отправить фото ещё раз.'
            : 'Ответ отменён. Можно спросить ещё раз.'
          : timedOut
            ? kind === 'photo'
              ? '⏳ Разбор фото занял слишком много времени. Попробуйте ещё раз — модель иногда думает долго.'
              : '⏳ ИИ-помощник не успел ответить. Попробуйте ещё раз — я на связи.'
            : error?.message && error.message !== 'Failed to fetch'
              ? `⚠️ ${error.message}`
              : fallback,
        createdAt: new Date().toISOString(),
        error: true,
        fromPhoto: kind === 'photo',
        retry
      }
    ])
  }

  const sendMessage = async (rawText, options = {}) => {
    const text = String(rawText ?? input).trim()
    const appendUser = options.appendUser !== false
    if (!text || isTyping) return
    if (!beginSending()) return

    const requestSession = sessionId
    const userMsg = {
      id: createLocalId('u'),
      role: 'user',
      text,
      createdAt: new Date().toISOString()
    }

    if (appendUser) setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)
    setIsAnalyzingPhoto(false)
    setAdviceOpenId(null)
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
      const answerText = typeof data?.text === 'string' ? data.text.trim() : ''

      trackEvent('chat_message', { hasPhoto: false, isGuest: Boolean(isGuest) })

      if (!answerText) {
        throw new Error('ИИ вернул пустой ответ. Повторите запрос.')
      }

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
      addErrorMessage(requestSession, e, {
        cancelled,
        timedOut,
        kind: 'message',
        fallback: '⚠️ Что-то пошло не так. Попробуй ещё раз.',
        retry: { kind: 'message', text }
      })
    } finally {
      window.clearTimeout(timer)
      if (activeRequestRef.current?.controller === controller) {
        activeRequestRef.current = null
      }
      sendingRef.current = false
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

  const sendPhotos = async (files, options = {}) => {
    const diagnosis = options.diagnosis === true
    const appendUser = options.appendUser !== false
    const rawText = options.text !== undefined ? options.text : input
    const text = String(rawText || '').trim()

    if (!files.length || isTyping) return

    if (files.length > MAX_PHOTOS) {
      setAttachError(`Можно прикрепить не больше ${MAX_PHOTOS} фото`)
      return
    }
    if (diagnosis && files.length > DIAGNOSIS_MAX_PHOTOS) {
      setAttachError(`Для диагностики — не больше ${DIAGNOSIS_MAX_PHOTOS} фото за раз`)
      return
    }
    if (files.some(file => file.size > MAX_PHOTO_BYTES)) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      return
    }
    if (!beginSending()) return

    const requestSession = sessionId
    const messageId = createLocalId('u')
    const localPhotoUrls = files.map(file => URL.createObjectURL(file))
    const userText = text || (diagnosis ? 'Диагностика по фото' : 'Проверьте, пожалуйста, фото растения')

    if (appendUser) {
      setMessages(prev => [
        ...prev,
        {
          id: messageId,
          role: 'user',
          text: userText,
          photoUrls: localPhotoUrls,
          createdAt: new Date().toISOString()
        }
      ])
    }
    setInput('')
    setAttachedFiles([])
    setDiagnosisFiles([])
    setAttachError('')
    setIsTyping(true)
    setIsAnalyzingPhoto(true)
    setAdviceOpenId(null)
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
      else if (diagnosis) formData.append('message', 'Диагностика по фото')
      if (sessionId) formData.append('sessionId', sessionId)

      const res = await fetch(`${API_URL}/chat/photo`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        body: formData
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`)
      if (!data?.text || !String(data.text).trim()) {
        throw new Error('Не удалось получить разбор фото. Попробуйте ещё раз.')
      }

      trackEvent('chat_message', { hasPhoto: true, isGuest: Boolean(isGuest) })
      trackEvent('photo_added')

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
            fromPhoto: true,
            photos: files,
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
      addErrorMessage(requestSession, e, {
        cancelled,
        timedOut,
        kind: 'photo',
        fallback: '⚠️ Не удалось разобрать фото. Попробуйте другое фото.',
        retry: { kind: 'photo', files, text, diagnosis }
      })
    } finally {
      window.clearTimeout(timer)
      if (activeRequestRef.current?.controller === controller) {
        activeRequestRef.current = null
      }
      sendingRef.current = false
      if (sessionRef.current === requestSession) {
        setIsTyping(false)
        setIsAnalyzingPhoto(false)
      }
    }
  }

  const retryFailed = errorMessage => {
    if (!errorMessage?.retry || isTyping) return
    setMessages(prev => prev.filter(message => message.id !== errorMessage.id))
    const retry = errorMessage.retry
    if (retry.kind === 'photo') {
      void sendPhotos(retry.files || [], {
        diagnosis: retry.diagnosis,
        text: retry.text,
        appendUser: false
      })
      return
    }
    void sendMessage(retry.text, { appendUser: false })
  }

  const handleSend = () => {
    if (attachedFiles.length) return sendPhotos(attachedFiles)
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

  const openDiagnosisPicker = () => {
    if (isTyping) return
    diagnosisInputRef.current?.click()
  }

  const handleDiagnosisFiles = e => {
    const selected = Array.from(e.target.files || [])
    e.target.value = ''
    if (!selected.length) return

    if (selected.length > DIAGNOSIS_MAX_PHOTOS) {
      setAttachError(`Для диагностики — не больше ${DIAGNOSIS_MAX_PHOTOS} фото за раз`)
      return
    }
    if (selected.some(file => file.size > MAX_PHOTO_BYTES)) {
      setAttachError('Фото больше 5 МБ. Пожалуйста, выберите файл поменьше.')
      return
    }

    setAttachError('')
    setDiagnosisFiles(selected)
  }

  const startDiagnosis = () => {
    const files = diagnosisFiles
    if (!files.length) return
    setDiagnosisFiles([])
    void sendPhotos(files, { diagnosis: true })
  }

  const closeAddToPlant = () => {
    if (plantAttachBusy) return
    setAddToPlantMessage(null)
    setPlantAttachError('')
  }

  const attachToPlant = async (message, plant) => {
    if (!message || !plant || plantAttachBusy) return
    const files = Array.isArray(message.photos) ? message.photos : []
    if (!files.length) {
      setPlantAttachError('Фото уже не под рукой — пришлите его ещё раз и попробуйте снова.')
      return
    }

    setPlantAttachBusy(true)
    setPlantAttachError('')

    try {
      const urls = []
      for (let index = 0; index < files.length; index += 2) {
        const chunk = files.slice(index, index + 2)
        const formData = new FormData()
        chunk.forEach(file => formData.append('photos', file))
        const uploadResponse = await fetch(`${API_URL}/upload`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        })
        const uploadData = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok) {
          throw new Error(uploadData.message || `Не удалось загрузить фото (HTTP ${uploadResponse.status})`)
        }
        if (!Array.isArray(uploadData.urls) || !uploadData.urls.length) {
          throw new Error('Сервер не вернул ссылки на фото. Попробуйте ещё раз.')
        }
        urls.push(...uploadData.urls)
      }

      const response = await fetch(`${API_URL}/plants/${plant.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photos: urls.map(url => ({ url })) })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Не удалось добавить фото к растению (HTTP ${response.status})`)
      }

      setMessages(prev => prev.map(entry => (
        entry.id === message.id
          ? { ...entry, addedToPlant: { id: plant.id, name: plant.name } }
          : entry
      )))
      setAddToPlantMessage(null)
      setPlantAttachError('')
    } catch (error) {
      console.warn('Не удалось добавить диагноз в растение:', error)
      setPlantAttachError(
        error?.message || 'Не удалось добавить фото в растение. Проверьте подключение и попробуйте ещё раз.'
      )
    } finally {
      setPlantAttachBusy(false)
    }
  }

  const handlePlantUpdated = updatedPlant => {
    if (!updatedPlant?.id) return
    setPlants(prev => prev.map(plant => (plant.id === updatedPlant.id ? updatedPlant : plant)))
  }

  const suggestedPlantIdFor = text => findSuggestedPlantId(plants, text)

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
              }${m.error ? ' chatBubbleError' : ''}`}
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
              {m.role === 'assistant' && (m.diagnosis || m.fromPhoto) && (
                <div className='chatDiagnosisActions'>
                  {m.addedToPlant ? (
                    <>
                      <span className='chatDiagnosisAdded'>
                        Фото добавлено в «{m.addedToPlant.name}»
                      </span>
                      <button
                        type='button'
                        className='chatDiagnosisSecondary'
                        onClick={() => navigate(`/my-plants?plant=${m.addedToPlant.id}`)}
                      >
                        К растению
                      </button>
                    </>
                  ) : (
                    <button
                      type='button'
                      className='chatDiagnosisAddBtn'
                      onClick={() => {
                        setPlantAttachError('')
                        setAddToPlantMessage(m)
                      }}
                    >
                      Добавить в растение
                    </button>
                  )}
                </div>
              )}
              {m.error && (
                <div className='chatErrorActions'>
                  {m.retry && (
                    <button
                      type='button'
                      className='chatErrorRetry'
                      onClick={() => retryFailed(m)}
                      disabled={isTyping}
                    >
                      Повторить
                    </button>
                  )}
                  <button
                    type='button'
                    className='chatErrorLink'
                    onClick={() => navigate('/my-plants')}
                  >
                    Проверить в карточке растения
                  </button>
                </div>
              )}
              {m.role === 'assistant' && m.id !== 'greeting' && !m.error && m.text && (
                <div className='chatAiActions'>
                  <button
                    type='button'
                    className={`chatAdviceToggle${adviceOpenId === m.id ? ' is-open' : ''}`}
                    aria-expanded={adviceOpenId === m.id}
                    onClick={() => {
                      setAdviceOpenId(current => (current === m.id ? null : m.id))
                    }}
                  >
                    Применить совет
                  </button>
                  {adviceOpenId === m.id && (
                    <ApplyAdvicePanel
                      plants={plants}
                      suggestedPlantId={suggestedPlantIdFor(m.text)}
                      onSaved={handlePlantUpdated}
                      onAddPlant={() => navigate('/add-plant')}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {showStarters && (
          <div className='chatStarters' aria-label='Стартовые вопросы'>
            <p className='chatStartersTitle'>
              {plants.length ? 'Спросите про свои растения' : 'С чего начать'}
            </p>
            <div className='chatStartersList'>
              {starterPrompts.map(prompt => (
                <button
                  key={prompt}
                  type='button'
                  className='chatStarter'
                  onClick={() => sendMessage(prompt)}
                  disabled={isTyping}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

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
          : plantAttachBusy
            ? 'Сохраняю фото в растение…'
            : ''}
      </span>

      <div className='chatInputArea'>
        {attachError && (
          <p className='chatAttachError' role='alert'>{attachError}</p>
        )}
        {diagnosisFiles.length > 0 && (
          <div
            className='chatDiagnosisPreview'
            role='group'
            aria-label='Фото для диагностики'
          >
            <div className='chatDiagnosisPreviewList'>
              {diagnosisPreviews.map((preview, index) => (
                <img
                  key={`${preview.file.name}-${index}`}
                  className='chatDiagnosisPreviewPhoto'
                  src={preview.url}
                  alt={`Фото для диагностики ${index + 1}`}
                />
              ))}
            </div>
            <div className='chatDiagnosisPreviewBody'>
              <p className='chatDiagnosisPreviewText'>
                {diagnosisFiles.length} {photoWord(diagnosisFiles.length)} — посмотрю, что с растением.
                Чем больше ракурсов, тем точнее разбор.
              </p>
              <div className='chatDiagnosisPreviewButtons'>
                <button
                  type='button'
                  className='chatDiagnosisSend'
                  onClick={startDiagnosis}
                  disabled={isTyping}
                >
                  Проверить по фото
                </button>
                <button
                  type='button'
                  className='chatDiagnosisCancel'
                  onClick={() => setDiagnosisFiles([])}
                  disabled={isTyping}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}
        {attachedFiles.length > 0 && (
          <div className='chatAttachments'>
            <div className='chatAttachmentsList'>
              {attachedFiles.map((file, index) => (
                <div className='chatAttachmentChip' key={`${file.name}-${file.lastModified}-${index}`}>
                  <img
                    className='chatAttachmentThumb'
                    src={attachmentPreviews[index]?.url || Paperclip}
                    alt=''
                    aria-hidden='true'
                  />
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
        <div className='chatComposerTools'>
          <button
            type='button'
            className='chatDiagnosisBtn'
            onClick={openDiagnosisPicker}
            disabled={isTyping}
            title='Диагностика по фото: 1–3 фото'
          >
            <img src={CameraIcon} alt='' aria-hidden='true' />
            <span>Диагностика по фото</span>
          </button>
          <span className='chatComposerHint'>1–3 фото</span>
          <input
            ref={diagnosisInputRef}
            type='file'
            className='fileForAlice'
            accept='image/jpeg,image/png,image/webp,image/heic'
            multiple
            onChange={handleDiagnosisFiles}
            aria-label='Фото для диагностики, от 1 до 3'
            tabIndex={-1}
            disabled={isTyping}
          />
        </div>
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

      {addToPlantMessage && (
        <AddToPlantDialog
          plants={plants}
          message={addToPlantMessage}
          busy={plantAttachBusy}
          error={plantAttachError}
          onSelect={plant => attachToPlant(addToPlantMessage, plant)}
          onClose={closeAddToPlant}
          onAddPlant={() => {
            setAddToPlantMessage(null)
            navigate('/add-plant')
          }}
        />
      )}
    </div>
  )
}

function Chat(props) {
  return <ChatSession key={props.sessionId || 'new'} {...props} />
}

export default Chat
