import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './addPlants.css'
import './dark-theme.css'
import camera from '../../assets/camera.svg'
import leaf from '../../assets/leaf.svg'
import sparkles from '../../assets/sparkles.svg'
import plus from '../../assets/plus.svg'
import minus from '../../assets/minus.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'
import {
    reminderWeekdaysForInterval,
    upcomingWateringDays,
    weekdayRestrictionApplies
} from '../../utils/date.js'

const MAX_PHOTOS = 2
const DRAFT_STORAGE_KEY = 'webplant-add-plant-draft'
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000

function getSessionStorage() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage
    } catch {
        return null
    }
}

function readDraft() {
    const storage = getSessionStorage()
    if (!storage) return null
    try {
        const raw = storage.getItem(DRAFT_STORAGE_KEY)
        if (!raw) return null
        const draft = JSON.parse(raw)
        if (!draft || typeof draft !== 'object') return null
        if (Number.isFinite(draft.savedAt) && Date.now() - draft.savedAt > DRAFT_TTL_MS) {
            storage.removeItem(DRAFT_STORAGE_KEY)
            return null
        }
        return draft
    } catch {
        return null
    }
}

function writeDraft(draft) {
    const storage = getSessionStorage()
    if (!storage) return
    try {
        storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }))
    } catch {
        return
    }
}

function clearDraft() {
    const storage = getSessionStorage()
    if (!storage) return
    try {
        storage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
        return
    }
}

const AI_REQUEST_TIMEOUT_MS = 35000

async function fetchWithTimeout(url, options = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        window.clearTimeout(timer)
    }
}

function describeAiRequestError(error, fallbackMessage) {
    if (error?.name === 'AbortError') {
        return 'Сервис не ответил вовремя. Попробуйте ещё раз — данные не потеряны.'
    }
    return error?.message || fallbackMessage
}

const PRESETS = [
    { id: 'daily', label: 'Каждый день', days: 1 },
    { id: '3days', label: 'Раз в 3 дня', days: 3 },
    { id: 'week', label: 'Раз в неделю', days: 7 },
    { id: '2weeks', label: 'Раз в 2 недели', days: 14 },
]

const WATERING = [
    { id: 'morning', label: 'Утро' },
    { id: 'day', label: 'День' },
    { id: 'evening', label: 'Вечер' },
]

const WEEKDAY = [
    { id: 1, label: 'Пн' },
    { id: 2, label: 'Вт' },
    { id: 3, label: 'Ср' },
    { id: 4, label: 'Чт' },
    { id: 5, label: 'Пт' },
    { id: 6, label: 'Сб' },
    { id: 0, label: 'Вс' },
]

const getReminderWeekdays = (intervalDays, startDate = new Date()) =>
    reminderWeekdaysForInterval(intervalDays, startDate)

const WEEKDAY_LABELS = new Map(WEEKDAY.map(day => [day.id, day.label]))

const formatPreviewDate = date =>
    `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`

function pluralDays(count) {
    const value = Math.abs(Number(count))
    if (!Number.isFinite(value)) return 'дней'
    const mod10 = value % 10
    const mod100 = value % 100
    if (mod10 === 1 && mod100 !== 11) return 'день'
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
    return 'дней'
}

function everyDaysLabel(intervalDays) {
    const value = Number(intervalDays)
    if (!Number.isInteger(value) || value < 1) return 'каждый день'
    if (value === 1) return 'каждый день'
    return `каждые ${value} ${pluralDays(value)}`
}

function AddPlants() {
    const navigate = useNavigate()
    const [initialDraft] = useState(readDraft)
    const [previews, setPreviews] = useState([])
    const filesRef = useRef([])
    const urlsRef = useRef([])
    const timeoutRef = useRef(null)
    const nameInputRef = useRef(null)
    const [saveCompleted, setSaveCompleted] = useState(false)

    const [step, setStep] = useState(1)
    const [leaving, setLeaving] = useState(null)
    const [days, setDays] = useState(() => {
        const restored = Number(initialDraft?.days)
        return Number.isInteger(restored) && restored >= 1 && restored <= 365 ? restored : 7
    })
    const [selectedPreset, setSelectedPreset] = useState(() =>
        PRESETS.some(preset => preset.id === initialDraft?.selectedPreset)
            ? initialDraft.selectedPreset
            : 'custom'
    )
    const [selectedWatering, setSelectedWatering] = useState(() =>
        WATERING.some(option => option.id === initialDraft?.selectedWatering)
            ? initialDraft.selectedWatering
            : 'morning'
    )
    const [selectedDays, setSelectedDays] = useState(() => {
        if (Array.isArray(initialDraft?.selectedDays)) {
            return initialDraft.selectedDays.filter(id => Number.isInteger(id) && id >= 0 && id <= 6)
        }
        const restored = Number(initialDraft?.days)
        return getReminderWeekdays(Number.isInteger(restored) && restored >= 1 ? restored : 7)
    })
    const [notifyMorning, setNotifyMorning] = useState(() =>
        typeof initialDraft?.notifyMorning === 'boolean' ? initialDraft.notifyMorning : true
    )
    const [notifyDayBefore, setNotifyDayBefore] = useState(() =>
        typeof initialDraft?.notifyDayBefore === 'boolean' ? initialDraft.notifyDayBefore : false
    )
    const [name, setName] = useState(() =>
        typeof initialDraft?.name === 'string' ? initialDraft.name : ''
    )
    const [species, setSpecies] = useState(() =>
        typeof initialDraft?.species === 'string' ? initialDraft.species : ''
    )
    const [draftRestored, setDraftRestored] = useState(Boolean(initialDraft))
    const [nameError, setNameError] = useState('')
    const [isSuggestingSpecies, setIsSuggestingSpecies] = useState(false)
    const [speciesSuggestionError, setSpeciesSuggestionError] = useState('')
    const [isWateringDialogOpen, setIsWateringDialogOpen] = useState(false)
    const [wateringAnswers, setWateringAnswers] = useState([])
    const [wateringMessages, setWateringMessages] = useState([])
    const [wateringAnswer, setWateringAnswer] = useState('')
    const [wateringRecommendation, setWateringRecommendation] = useState(null)
    const [wateringMaxQuestions, setWateringMaxQuestions] = useState(6)
    const [isAskingWateringTime, setIsAskingWateringTime] = useState(false)
    const [isWateringTimeDialogOpen, setIsWateringTimeDialogOpen] = useState(false)
    const [wateringTimeAdvice, setWateringTimeAdvice] = useState(null)
    const [wateringTimeAdviceError, setWateringTimeAdviceError] = useState('')
    const [isAskingWateringAdvice, setIsAskingWateringAdvice] = useState(false)
    const [wateringAdviceError, setWateringAdviceError] = useState('')
    const wateringDialogSessionRef = useRef(0)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState('')

    const [toast, setToast] = useState(null)
    const [toastLeaving, setToastLeaving] = useState(false)
    const toastTimerRef = useRef(null)
    const navigateTimerRef = useRef(null)
    const wateringMessagesEndRef = useRef(null)

    const closeToast = () => {
        if (toastLeaving) return
        setToastLeaving(true)
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => {
            setToast(null)
            setToastLeaving(false)
        }, 250)
    }

    const toggleDay = (id) => {
        setSelectedDays(prev =>
            prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
        )
    }

    const setWateringInterval = intervalDays => {
        setDays(intervalDays)
        setSelectedDays(getReminderWeekdays(intervalDays))
    }

    const dec = () => {
        setSelectedPreset('custom')
        setWateringInterval(Math.max(1, days - 1))
    }

    const inc = () => {
        setSelectedPreset('custom')
        setWateringInterval(Math.min(365, days + 1))
    }

    const canRestrictWeekdays = weekdayRestrictionApplies(days)
    const weekdayPreview = canRestrictWeekdays ? [] : upcomingWateringDays(days, new Date(), 4)
    const previewWeekdays = new Set(weekdayPreview.map(item => item.weekday))

    const draftHasContent =
        Boolean(name.trim()) ||
        Boolean(species.trim()) ||
        days !== 7 ||
        selectedPreset !== 'custom' ||
        selectedWatering !== 'morning' ||
        !notifyMorning ||
        notifyDayBefore ||
        selectedDays.join(',') !== getReminderWeekdays(days).join(',')

    const goToStep = (next) => {
        setLeaving(step)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
            setStep(next)
            setLeaving(null)
            window.scrollTo({ top: 0, behavior: 'smooth' })
        }, 350)
    }

    const validateName = () => {
        if (!name.trim()) return 'Введите название растения'
        if (name.trim().length > 255) return 'Название должно содержать не более 255 символов'
        return ''
    }

    const focusNameInput = () => {
        setStep(1)
        window.setTimeout(() => {
            const input = nameInputRef.current
            if (!input) return
            input.focus()
            input.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        }, 80)
    }

    const goNextFromStep1 = () => {
        const message = validateName()
        if (message) {
            setNameError(message)
            setSubmitError('')
            focusNameInput()
            return
        }
        setNameError('')
        setSubmitError('')
        goToStep(2)
    }

    const handleSuggestSpecies = async () => {
        const plantName = name.trim()
        if (!plantName || isSuggestingSpecies) return

        setIsSuggestingSpecies(true)
        setSpeciesSuggestionError('')
        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/suggest-species`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: plantName })
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || 'Не удалось определить вид растения')
            }
            if (typeof data.species !== 'string' || !data.species.trim()) {
                throw new Error('Не удалось получить название вида. Попробуйте ещё раз.')
            }
            setSpecies(data.species.trim())
        } catch (error) {
            console.error('Ошибка подсказки вида растения:', error)
            setSpeciesSuggestionError(describeAiRequestError(error, 'Не удалось определить вид растения'))
        } finally {
            setIsSuggestingSpecies(false)
        }
    }

    const requestWateringAdvice = async (answers, sessionId, mode = 'auto') => {
        setIsAskingWateringAdvice(true)
        setWateringAdviceError('')
        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/watering-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: name.trim(),
                    species: species.trim(),
                    answers,
                    mode
                })
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || 'Не удалось получить рекомендацию')
            }
            if (wateringDialogSessionRef.current !== sessionId) return

            if (Number.isInteger(data.maxQuestions) && data.maxQuestions > 0) {
                setWateringMaxQuestions(data.maxQuestions)
            }

            if (data.type === 'question' && typeof data.question === 'string') {
                setWateringMessages(messages => [...messages, {
                    role: 'assistant',
                    text: data.question,
                    options: Array.isArray(data.options)
                        ? data.options.filter(option => typeof option === 'string' && option.trim()).slice(0, 4)
                        : []
                }])
            } else if (
                data.type === 'recommendation' &&
                Number.isInteger(data.intervalDays) &&
                data.intervalDays >= 1 &&
                data.intervalDays <= 365 &&
                typeof data.reason === 'string'
            ) {
                setWateringRecommendation(data)
            } else {
                throw new Error('ИИ прислал некорректную рекомендацию. Попробуйте ещё раз.')
            }
        } catch (error) {
            if (wateringDialogSessionRef.current !== sessionId) return
            console.error('Ошибка рекомендации частоты полива:', error)
            setWateringAdviceError(describeAiRequestError(error, 'Не удалось получить рекомендацию'))
        } finally {
            if (wateringDialogSessionRef.current === sessionId) {
                setIsAskingWateringAdvice(false)
            }
        }
    }

    const requestWateringTimeAdvice = async () => {
        if (!name.trim() || isAskingWateringTime) return

        setIsWateringTimeDialogOpen(true)
        setIsAskingWateringTime(true)
        setWateringTimeAdvice(null)
        setWateringTimeAdviceError('')
        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/watering-time-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: name.trim(),
                    species: species.trim(),
                    intervalDays: days
                })
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || 'Не удалось подобрать время полива')
            }
            if (
                !WATERING.some(option => option.id === data.timeOfDay) ||
                typeof data.reason !== 'string' ||
                !data.reason.trim()
            ) {
                throw new Error('ИИ прислал некорректную рекомендацию. Попробуйте ещё раз.')
            }
            setWateringTimeAdvice(data)
        } catch (error) {
            console.error('Ошибка рекомендации времени полива:', error)
            setWateringTimeAdviceError(describeAiRequestError(error, 'Не удалось подобрать время полива'))
        } finally {
            setIsAskingWateringTime(false)
        }
    }

    const applyWateringTimeAdvice = () => {
        if (!wateringTimeAdvice) return
        setSelectedWatering(wateringTimeAdvice.timeOfDay)
        setIsWateringTimeDialogOpen(false)
        setWateringTimeAdvice(null)
    }

    const openWateringAdvice = () => {
        if (!name.trim() || isAskingWateringAdvice) return
        const sessionId = wateringDialogSessionRef.current + 1
        wateringDialogSessionRef.current = sessionId
        setIsWateringDialogOpen(true)
        setWateringAnswers([])
        setWateringMessages([])
        setWateringAnswer('')
        setWateringRecommendation(null)
        setWateringAdviceError('')
        requestWateringAdvice([], sessionId)
    }

    const closeWateringAdvice = () => {
        wateringDialogSessionRef.current++
        setIsWateringDialogOpen(false)
        setIsAskingWateringAdvice(false)
    }

    const sendWateringAnswer = (rawAnswer, mode = 'auto') => {
        const answer = String(rawAnswer || '').trim()
        const lastQuestion = [...wateringMessages].reverse().find(
            message => message.role === 'assistant'
        )?.text
        const skip = mode === 'recommendation' && !answer
        if (!lastQuestion || isAskingWateringAdvice) return
        if (!answer && !skip) return

        const answerText = answer || 'Пропустить вопрос'
        const nextAnswers = [...wateringAnswers, {
            question: lastQuestion,
            answer: answerText
        }]
        const sessionId = wateringDialogSessionRef.current
        setWateringAnswers(nextAnswers)
        setWateringMessages(messages => [
            ...messages.map(message => ({ ...message, options: [] })),
            { role: 'user', text: answerText }
        ])
        setWateringAnswer('')
        setWateringAdviceError('')
        setWateringRecommendation(null)
        requestWateringAdvice(nextAnswers, sessionId, mode)
    }

    const submitWateringAnswer = event => {
        event.preventDefault()
        sendWateringAnswer(wateringAnswer)
    }

    const skipWateringQuestions = () => {
        sendWateringAnswer('', 'recommendation')
    }

    const refineWateringAdvice = () => {
        if (wateringAnswers.length >= wateringMaxQuestions || isAskingWateringAdvice) return
        setWateringRecommendation(null)
        setWateringAdviceError('')
        requestWateringAdvice(wateringAnswers, wateringDialogSessionRef.current, 'question')
    }

    const applyWateringRecommendation = () => {
        if (!wateringRecommendation) return
        const matchingPreset = PRESETS.find(
            preset => preset.days === wateringRecommendation.intervalDays
        )
        setWateringInterval(wateringRecommendation.intervalDays)
        setSelectedPreset(matchingPreset?.id || 'custom')
        closeWateringAdvice()
    }

    const lastWateringMessage = wateringMessages[wateringMessages.length - 1]
    const currentQuestionOptions = lastWateringMessage?.role === 'assistant'
        ? (lastWateringMessage.options || [])
        : []

    useEffect(() => {
        if (isWateringDialogOpen) {
            wateringMessagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
        }
    }, [
        isWateringDialogOpen,
        isAskingWateringAdvice,
        wateringMessages,
        wateringRecommendation
    ])

    const handleFileChange = (e) => {
        const newFiles = Array.from(e.target.files)
        if (!newFiles.length) return

        const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
        if (newFiles.some(file => !allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024)) {
            setSubmitError('Выберите JPEG, PNG, WebP или HEIC размером до 5 МБ')
            e.target.value = ''
            return
        }

        const freeSlots = MAX_PHOTOS - filesRef.current.length
        if (freeSlots <= 0) {
            setSubmitError(`Можно добавить не более ${MAX_PHOTOS} фотографий`)
            e.target.value = ''
            return
        }
        if (newFiles.length > freeSlots) {
            setSubmitError(`Можно добавить ещё ${freeSlots} фотографии`)
            e.target.value = ''
            return
        }

        const newUrls = newFiles.map(file => URL.createObjectURL(file))

        filesRef.current = [...filesRef.current, ...newFiles]
        urlsRef.current = [...urlsRef.current, ...newUrls]
        setPreviews([...urlsRef.current])
        setSubmitError('')

        e.target.value = ''
    }

    const handleRemove = (index) => {
        URL.revokeObjectURL(urlsRef.current[index])
        filesRef.current = filesRef.current.filter((_, i) => i !== index)
        urlsRef.current = urlsRef.current.filter((_, i) => i !== index)
        setPreviews([...urlsRef.current])
    }

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
            if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
            urlsRef.current.forEach(url => URL.revokeObjectURL(url))
            urlsRef.current = []
        }
    }, [])

    useEffect(() => {
        if (!draftHasContent || saveCompleted) {
            clearDraft()
            return
        }
        writeDraft({
            name,
            species,
            days,
            selectedPreset,
            selectedWatering,
            selectedDays,
            notifyMorning,
            notifyDayBefore,
            step
        })
    }, [
        draftHasContent,
        saveCompleted,
        name,
        species,
        days,
        selectedPreset,
        selectedWatering,
        selectedDays,
        notifyMorning,
        notifyDayBefore,
        step
    ])

    useEffect(() => {
        if (!draftHasContent || saveCompleted) return undefined
        const handleBeforeUnload = event => {
            event.preventDefault()
            event.returnValue = ''
            return ''
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [draftHasContent, saveCompleted])

    const addPlant = async (event) => {
        event.preventDefault()
        if (isSubmitting) return

        const validationMessage = validateName()
        if (validationMessage) {
            setNameError(validationMessage)
            setSubmitError('')
            focusNameInput()
            return
        }

        setNameError('')
        setIsSubmitting(true)
        setSubmitError('')

        try {
            let uploadedUrls = []
            if (filesRef.current.length > 0) {
                const formData = new FormData()
                filesRef.current.forEach(file => formData.append('photos', file))

                const uploadRes = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                })

                const uploadData = await uploadRes.json().catch(() => ({}))
                if (!uploadRes.ok) {
                    throw new Error(uploadData.message || 'Не удалось загрузить фото')
                }
                uploadedUrls = Array.isArray(uploadData.urls) ? uploadData.urls : []
            }

            const response = await fetch(`${API_URL}/plants`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name.trim(),
                    species: species.trim(),
                    photos: uploadedUrls,
                    watering_interval_days: days,
                    watering_time_of_day: selectedWatering,
                    notify_morning: notifyMorning,
                    notify_day_before: notifyDayBefore,
                    reminder_weekdays: selectedDays,
                    metadata: wateringAnswers.length
                        ? {
                            care_hints: {
                                watering_answers: wateringAnswers
                            }
                        }
                        : undefined
                }),
                credentials: 'include'
            })

            const responseData = await response.json().catch(() => ({}))

            if (response.ok) {
                setSaveCompleted(true)
                clearDraft()
                urlsRef.current.forEach(url => URL.revokeObjectURL(url))
                urlsRef.current = []
                filesRef.current = []

                setToast({
                    title: 'Растение добавлено',
                    subtitle: name.trim(),
                })

                navigateTimerRef.current = setTimeout(() => {
                    navigate('/home', { replace: true })
                }, 1600)
            } else {
                throw new Error(responseData.message || 'Не удалось сохранить растение')
            }
        } catch (error) {
            console.error('Add plant error:', error)
            setSubmitError(error.message || 'Ошибка при сохранении. Попробуйте ещё раз.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className='formForPlant'>
            <p className='headerOfBlockAddPlants'>Новое растение</p>
            {draftRestored && (
                <div className='draftRestoreNotice' role='status'>
                    <p>
                        Черновик восстановлен — можно продолжить с того же места. Фотографии нужно добавить заново.
                    </p>
                    <button
                        type='button'
                        onClick={() => setDraftRestored(false)}
                        aria-label='Скрыть уведомление о черновике'
                    >
                        ×
                    </button>
                </div>
            )}
            <div className='godOfbarCheckFilling'>
                <div className="barCheckFilling">
                    <span className='numbersOfFirstStep'>1</span>
                    <span className={`firstStep ${step >= 2 ? 'active' : ''}`}></span>
                    <span className={`numbersOfSecondStep ${step >= 2 ? 'active' : ''}`}>2</span>
                    <span className={`secondStep ${step >= 3 ? 'active' : ''}`}></span>
                    <span className={`numbersOfThirdStep ${step >= 3 ? 'active' : ''}`}>3</span>
                </div>
            </div>
            <div>
                <form onSubmit={addPlant} noValidate>
                    <div className={`firstStepCheck ${step === 1 ? 'active' : ''} ${leaving === 1 ? 'leaving' : ''}`}>
                        <div className='headerfirstStepCheck'>
                            <p>Шаг 1 из 3 · Вид и название</p>
                            <p>Дальше: частота полива и напоминания</p>
                        </div>
                        <div className='addPhotoPlant'>
                            <p>Фото растения</p>
                            <p>Сфотографируйте растение или выберите снимок из галереи</p>
                            <div className='upload-row'>
                                <label className="add-photo-btn">
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/heic"
                                        multiple
                                        className="addPhotoPlantInput"
                                        aria-label="Добавить фотографии растения"
                                        onChange={handleFileChange}
                                    />
                                    <img src={camera} alt="" aria-hidden="true" className="add-photo-icon" />
                                    <span className="add-photo-text">Добавить</span>
                                </label>
                                {[0, 1].map((i) => (
                                    <div
                                        key={i}
                                        className={`preview-box ${previews[i] ? 'has-preview' : ''}`}
                                    >
                                        {previews[i] ? (
                                            <>
                                                <img
                                                    src={previews[i]}
                                                    alt={`Фото ${i + 1}`}
                                                    className="preview-img"
                                                />
                                                <button
                                                    type="button"
                                                    className="preview-remove"
                                                    onClick={() => handleRemove(i)}
                                                    aria-label="Удалить фото"
                                                >
                                                    ×
                                                </button>
                                            </>
                                        ) : (
                                            <img
                                                src={leaf}
                                                alt=""
                                                className="preview-placeholder-icon"
                                                aria-hidden="true"
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className='addNamePlant'>
                            <p className='headerOfaddNamePlant'>Название и вид</p>
                            <div className='nameOfPlant'>
                                <p>Название</p>
                                <input
                                    id='plantName'
                                    type="text"
                                    placeholder='Монстера Анна'
                                    maxLength={255}
                                    aria-label="Название растения"
                                    aria-invalid={nameError ? 'true' : undefined}
                                    aria-describedby={nameError ? 'plantNameError' : undefined}
                                    ref={nameInputRef}
                                    disabled={isSuggestingSpecies}
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value)
                                        setSubmitError('')
                                        if (nameError) setNameError('')
                                    }}
                                    required
                                />
                                {nameError && (
                                    <p id='plantNameError' className='fieldError' role='alert'>
                                        {nameError}
                                    </p>
                                )}
                            </div>
                            <div className='speciesName'>
                                <div>
                                    <p>Вид растения</p>
                                    <div>
                                        <img src={sparkles} alt="" aria-hidden="true" />
                                        <button
                                            type="button"
                                            onClick={handleSuggestSpecies}
                                            disabled={!name.trim() || isSuggestingSpecies}
                                            aria-busy={isSuggestingSpecies}
                                        >
                                            {isSuggestingSpecies ? 'Подбираю…' : 'Спросить у ИИ'}
                                        </button>
                                    </div>
                                </div>
                                <div className={`speciesInputShell ${isSuggestingSpecies ? 'isLoading' : ''}`}>
                                    <input
                                        type="text"
                                        placeholder='Monstera deliciosa'
                                        maxLength={255}
                                        aria-label="Вид растения"
                                        aria-describedby={speciesSuggestionError ? 'speciesSuggestionError' : undefined}
                                        disabled={isSuggestingSpecies}
                                        value={species}
                                        onChange={(e) => setSpecies(e.target.value)}
                                        required
                                    />
                                </div>
                                {speciesSuggestionError && (
                                    <p id="speciesSuggestionError" className="speciesSuggestionError" role="alert">
                                        {speciesSuggestionError}
                                    </p>
                                )}
                            </div>
                            <div className='popularTypes'>
                                <p>Популярные виды</p>
                                <div>
                                    {[
                                        ['Монстера', 'Monstera'],
                                        ['Фикус', 'Ficus'],
                                        ['Суккулент', 'Succulent']
                                    ].map(([label, value]) => (
                                        <button key={value} type="button" onClick={() => setSpecies(value)}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            className='nextSlidewatering'
                            onClick={goNextFromStep1}
                        >
                            Далее: Частота полива
                        </button>
                    </div>
                    <div className={`secondSection ${step === 2 ? 'active' : ''} ${leaving === 2 ? 'leaving' : ''}`}>
                        <div className='headerfirstStepCheck'>
                            <p>Шаг 2 из 3 · Частота полива</p>
                            <p>Дальше: напоминания и заметки</p>
                            <div className='wateringFrequency'>
                                <div>
                                    <div className='headerOfBlockWatering'>
                                        <p>Частота полива</p>
                                        <button
                                            type="button"
                                            className='askAI wateringAdviceTrigger'
                                            onClick={openWateringAdvice}
                                            disabled={!name.trim() || isAskingWateringAdvice}
                                        >
                                            <img src={sparkles} alt="" aria-hidden="true" />
                                            <span>Спросить ИИ</span>
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <div className='buttonHoldWatering'>
                                        {PRESETS.map(p => (
                                            <button
                                                key={p.id}
                                                type='button'
                                                className={`wateringPreset ${selectedPreset === p.id ? 'active' : ''}`}
                                                onClick={() => {
                                                    setSelectedPreset(p.id)
                                                    setWateringInterval(p.days)
                                                }}
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className={`customSchedule ${selectedPreset === 'custom' ? 'active' : ''}`}>
                                        <div>
                                            <p>Свой график</p>
                                            <p>Поливать {everyDaysLabel(days)}</p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button type='button' className='counterBtn' onClick={dec} aria-label="Уменьшить">
                                                <ThemedIcon src={minus} alt="" aria-hidden="true" />
                                            </button>
                                            <button type='button' className='counterBtn' onClick={inc} aria-label="Увеличить">
                                                <img src={plus} alt="" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className='presetPlantCheck'>
                                <div>
                                    <div className='headerOfBlockWatering'>
                                        <p>Когда поливать</p>
                                        <button
                                            type='button'
                                            className='askAI wateringAdviceTrigger'
                                            onClick={requestWateringTimeAdvice}
                                            disabled={!name.trim() || isAskingWateringTime}
                                            aria-busy={isAskingWateringTime}
                                        >
                                            <img src={sparkles} alt="" aria-hidden="true" />
                                            <span>{isAskingWateringTime ? 'Подбираю…' : 'Спросить ИИ'}</span>
                                        </button>
                                    </div>
                                    <div className='buttonHoldPreset'>
                                        {WATERING.map(w => (
                                            <button
                                                key={w.id}
                                                type='button'
                                                className={`wateringPreset ${selectedWatering === w.id ? 'active' : ''}`}
                                                onClick={() => setSelectedWatering(w.id)}
                                            >
                                                {w.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className='commentOfPreset'>Выберите время напоминания. Частоту подбирайте с учётом вида растения и того, как просыхает грунт.</p>
                                </div>
                            </div>
                            <div className='buttonOfslider'>
                                <button
                                    type="button"
                                    className='backSlidewatering'
                                    onClick={() => goToStep(1)}
                                >
                                    Назад
                                </button>
                                <button
                                    type="button"
                                    className='nextSlidewatering'
                                    onClick={() => goToStep(3)}
                                >
                                    Далее: Напоминания
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className={`thirdSection ${step === 3 ? 'active' : ''} ${leaving === 3 ? 'leaving' : ''}`}>
                        <div className='headerfirstStepCheck'>
                            <p>Шаг 3 из 3 · Напоминания и заметки</p>
                            <p>Готово — сохраните растение</p>
                        </div>
                        <div className='blocksOfWeekDay'>
                            <div className='headerOfBlockWatering'>
                                <p>Напоминания</p>
                            </div>
                            <div className='godblocksOfNotification'>
                                <div className='blocksOfNotification'>
                                    <p>Утреннее напоминание</p>
                                    <p>В день полива</p>
                                </div>
                                <label className="apple-switch">
                                    <input
                                        type="checkbox"
                                        checked={notifyMorning}
                                        aria-label="Утреннее напоминание"
                                        onChange={(e) => setNotifyMorning(e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            <div className='godblocksOfNotification'>
                                <div className='blocksOfNotification'>
                                    <p>Напоминать за день</p>
                                    <p>За день до полива</p>
                                </div>
                                <label className="apple-switch">
                                    <input
                                        type="checkbox"
                                        checked={notifyDayBefore}
                                        aria-label="Напоминать за день"
                                        onChange={(e) => setNotifyDayBefore(e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <p className='commentOfPreset'>
                                {!canRestrictWeekdays
                                    ? 'Полив попадает на разные дни недели — дни ниже показывают ближайшие поливы, а напоминание придёт в каждый день полива. Ограничить дни недели можно при графике «каждый день» или кратном 7.'
                                    : selectedDays.length === 0
                                        ? 'Напоминание придёт в каждый день полива. При необходимости ограничьте дни недели.'
                                        : 'Дни выбраны по частоте полива. При необходимости измените их вручную.'}
                            </p>
                            <div className='buttonHoldWeekday'>
                                {WEEKDAY.map(w => {
                                    const isSelected = canRestrictWeekdays && selectedDays.includes(w.id)
                                    const isPreview = !canRestrictWeekdays && previewWeekdays.has(w.id)

                                    return (
                                        <button
                                            key={w.id}
                                            type='button'
                                            className={[
                                                'wateringWeekday',
                                                isSelected && 'active',
                                                isPreview && 'preview'
                                            ].filter(Boolean).join(' ')}
                                            onClick={() => toggleDay(w.id)}
                                            disabled={!canRestrictWeekdays}
                                            aria-pressed={canRestrictWeekdays ? isSelected : undefined}
                                        >
                                            {w.label}
                                        </button>
                                    )
                                })}
                            </div>
                            {weekdayPreview.length > 0 && (
                                <p className='wateringWeekdayPreview'>
                                    {weekdayPreview.map(item => (
                                        <span key={item.date.getTime()}>
                                            {formatPreviewDate(item.date)}
                                            <b>{WEEKDAY_LABELS.get(item.weekday)}</b>
                                        </span>
                                    ))}
                                </p>
                            )}
                        </div>
                        <div className='buttonOfslider'>
                            <button
                                type="button"
                                className='backSlidewatering'
                                onClick={() => goToStep(2)}
                            >
                                Назад
                            </button>
                            <button
                                type="submit"
                                className='nextSlidewatering'
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Сохраняем…' : 'Сохранить растение'}
                            </button>
                        </div>
                    </div>
                    {submitError && <p className='addPlantError' role='alert'>{submitError}</p>}
                </form>
                {isWateringTimeDialogOpen && (
                    <div
                        className='wateringAdviceOverlay'
                        onMouseDown={event => {
                            if (event.target === event.currentTarget) {
                                setIsWateringTimeDialogOpen(false)
                            }
                        }}
                    >
                        <section
                            className='wateringAdviceDialog'
                            role='dialog'
                            aria-modal='true'
                            aria-labelledby='wateringTimeAdviceTitle'
                            aria-describedby='wateringTimeAdviceDescription'
                        >
                            <header className='wateringAdviceHeader'>
                                <div>
                                    <h2 id='wateringTimeAdviceTitle'>Когда лучше поливать?</h2>
                                    <p id='wateringTimeAdviceDescription'>
                                        Подберу время с учётом растения и частоты полива.
                                    </p>
                                </div>
                                <button
                                    type='button'
                                    className='wateringAdviceClose'
                                    onClick={() => setIsWateringTimeDialogOpen(false)}
                                    aria-label='Закрыть рекомендацию'
                                >
                                    ×
                                </button>
                            </header>
                            <div className='wateringAdviceMessages' aria-live='polite'>
                                <p className='wateringAdvicePlant'>
                                    Растение: <strong>{name.trim()}</strong>
                                    {species.trim() && ` · ${species.trim()}`}
                                    {' · полив '}{everyDaysLabel(days)}
                                </p>
                                {isAskingWateringTime && (
                                    <div className='wateringAdviceMessage assistant' role='status'>
                                        Подбираю подходящее время…
                                    </div>
                                )}
                                {wateringTimeAdvice && (
                                    <div className='wateringRecommendation' role='status'>
                                        <p className='wateringRecommendationInterval'>
                                            ИИ рекомендует: {
                                                WATERING.find(option => option.id === wateringTimeAdvice.timeOfDay)?.label
                                            }
                                        </p>
                                        <p>{wateringTimeAdvice.reason}</p>
                                        <button
                                            type='button'
                                            className='wateringRecommendationApply'
                                            onClick={applyWateringTimeAdvice}
                                        >
                                            Применить время
                                        </button>
                                    </div>
                                )}
                                <div ref={wateringMessagesEndRef} />
                            </div>
                            {wateringTimeAdviceError && (
                                <div className='wateringAdviceError' role='alert'>
                                    <p>{wateringTimeAdviceError}</p>
                                    <button
                                        type='button'
                                        onClick={requestWateringTimeAdvice}
                                        disabled={isAskingWateringTime}
                                    >
                                        Попробовать ещё раз
                                    </button>
                                </div>
                            )}
                        </section>
                    </div>
                )}
                {isWateringDialogOpen && (
                    <div
                        className='wateringAdviceOverlay'
                        onMouseDown={event => {
                            if (event.target === event.currentTarget && !isAskingWateringAdvice) {
                                closeWateringAdvice()
                            }
                        }}
                    >
                        <section
                            className='wateringAdviceDialog'
                            role='dialog'
                            aria-modal='true'
                            aria-labelledby='wateringAdviceTitle'
                            aria-describedby='wateringAdviceDescription'
                        >
                            <header className='wateringAdviceHeader'>
                                <div>
                                    <h2 id='wateringAdviceTitle'>Подберём график полива</h2>
                                    <p id='wateringAdviceDescription'>
                                        Ответьте на несколько вопросов. Рекомендация будет ориентировочной.
                                    </p>
                                </div>
                                <button
                                    type='button'
                                    className='wateringAdviceClose'
                                    onClick={closeWateringAdvice}
                                    aria-label='Закрыть диалог'
                                >
                                    ×
                                </button>
                            </header>
                            <div className='wateringAdviceMessages' aria-live='polite'>
                                <p className='wateringAdvicePlant'>
                                    Растение: <strong>{name.trim()}</strong>
                                    {species.trim() && ` · ${species.trim()}`}
                                </p>
                                <div className='wateringAdviceMessage assistant'>
                                    Подберу стартовый интервал с учётом условий. Это не заменяет проверку влажности грунта.
                                </div>
                                {wateringMessages.map((message, index) => (
                                    <div
                                        key={`${message.role}-${index}`}
                                        className={`wateringAdviceMessage ${message.role}`}
                                    >
                                        {message.text}
                                    </div>
                                ))}
                                {isAskingWateringAdvice && (
                                    <div className='wateringAdviceMessage assistant' role='status'>
                                        Подбираю следующий вопрос…
                                    </div>
                                )}
                                {wateringRecommendation && (
                                    <div className='wateringRecommendation' role='status'>
                                        <p className='wateringRecommendationInterval'>
                                            Ориентир: раз в {wateringRecommendation.intervalDays} дн.
                                        </p>
                                        <p>{wateringRecommendation.reason}</p>
                                        <p className='wateringRecommendationConfidence'>
                                            Уверенность: {
                                                wateringRecommendation.confidence === 'high'
                                                    ? 'высокая — условий достаточно для точного ориентира'
                                                    : wateringRecommendation.confidence === 'medium'
                                                        ? 'средняя — условия типичные, но уточнены не все'
                                                        : 'низкая — данных мало, ориентир самый осторожный'
                                            }. Проверяйте, просох ли грунт, и корректируйте график.
                                        </p>
                                        <div className='wateringRecommendationActions'>
                                            <button
                                                type='button'
                                                className='wateringRecommendationApply'
                                                onClick={applyWateringRecommendation}
                                            >
                                                Применить интервал
                                            </button>
                                            {wateringAnswers.length < 4 && (
                                                <button
                                                    type='button'
                                                    className='wateringRecommendationRefine'
                                                    onClick={refineWateringAdvice}
                                                    disabled={isAskingWateringAdvice}
                                                >
                                                    Уточнить условия
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div ref={wateringMessagesEndRef} />
                            </div>
                            {wateringAdviceError && (
                                <div className='wateringAdviceError' role='alert'>
                                    <p>{wateringAdviceError}</p>
                                    <button
                                        type='button'
                                        onClick={() => requestWateringAdvice(wateringAnswers, wateringDialogSessionRef.current, 'auto')}
                                        disabled={isAskingWateringAdvice}
                                    >
                                        Попробовать ещё раз
                                    </button>
                                </div>
                            )}
                            {!wateringRecommendation && currentQuestionOptions.length > 0 && (
                                <div className='wateringAdviceOptions' role='group' aria-label='Варианты ответа'>
                                    {currentQuestionOptions.map(option => (
                                        <button
                                            key={option}
                                            type='button'
                                            onClick={() => sendWateringAnswer(option)}
                                            disabled={isAskingWateringAdvice}
                                        >
                                            {option}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!wateringRecommendation && (
                                <form className='wateringAdviceReply' onSubmit={submitWateringAnswer}>
                                    <label htmlFor='wateringAdviceAnswer'>
                                        {wateringAnswers.length >= wateringMaxQuestions
                                            ? 'Получаем рекомендацию'
                                            : 'Ваш ответ или свой вариант'}
                                    </label>
                                    <textarea
                                        id='wateringAdviceAnswer'
                                        value={wateringAnswer}
                                        onChange={event => setWateringAnswer(event.target.value)}
                                        maxLength={500}
                                        rows={3}
                                        placeholder='Например: стоит на южном окне, грунт просыхает за 4 дня'
                                        disabled={
                                            isAskingWateringAdvice ||
                                            Boolean(wateringAdviceError) ||
                                            wateringAnswers.length >= wateringMaxQuestions ||
                                            !wateringMessages.some(message => message.role === 'assistant')
                                        }
                                    />
                                    <div className='wateringAdviceFooter'>
                                        <span>
                                            {wateringAnswers.length}/{wateringMaxQuestions} уточнений
                                            {wateringAnswers.length >= 3 && ' — дальше уже будет рекомендация'}
                                        </span>
                                        <div className='wateringAdviceFooterButtons'>
                                            <button
                                                type='button'
                                                className='wateringAdviceSkip'
                                                onClick={skipWateringQuestions}
                                                disabled={
                                                    isAskingWateringAdvice ||
                                                    Boolean(wateringAdviceError) ||
                                                    wateringAnswers.length >= wateringMaxQuestions ||
                                                    !wateringMessages.some(message => message.role === 'assistant')
                                                }
                                            >
                                                Хватит вопросов
                                            </button>
                                            <button
                                                type='submit'
                                                disabled={
                                                    !wateringAnswer.trim() ||
                                                    isAskingWateringAdvice ||
                                                    Boolean(wateringAdviceError) ||
                                                    wateringAnswers.length >= wateringMaxQuestions
                                            }
                                        >
                                            Ответить
                                        </button>
                                        </div>
                                    </div>
                                </form>
                            )}
                        </section>
                    </div>
                )}
                {toast && (
                    <div className={`toast ${toastLeaving ? 'leaving' : ''}`} role="status" aria-live="polite">
                        <div className="toastText">
                            <p className="toastTitle">{toast.title}</p>
                            <p className="toastSubtitle">{toast.subtitle}</p>
                        </div>
                        <button
                            type="button"
                            className="toastClose"
                            onClick={closeToast}
                            aria-label="Закрыть уведомление"
                        >
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AddPlants
