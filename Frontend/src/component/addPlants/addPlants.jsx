import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import './addPlants.css'
import './dark-theme.css'
import camera from '../../assets/camera.svg'
import leaf from '../../assets/leaf.svg'
import sparkles from '../../assets/sparkles.svg'
import plus from '../../assets/plus.svg'
import minus from '../../assets/minus.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import WateringAdviceDialog from '../wateringAdvice/WateringAdviceDialog.jsx'
import { API_URL } from '../../utils/api.js'
import { describeAiRequestError, fetchWithTimeout } from '../../utils/aiRequest.js'
import { trackEvent } from '../../utils/productEvents.js'
import { saveFirstPlantPending } from '../../utils/onboarding.js'
import { PLANTS } from '../../data/plants.js'
import {
    POPULAR_SPECIES_LIMIT,
    mapPopularSpecies
} from '../../utils/popularSpecies.js'
import {
    reminderWeekdaysForInterval,
    upcomingWateringDays,
    weekdayRestrictionApplies
} from '../../utils/date.js'
import {
    LIGHT_OPTIONS,
    ROOM_SUGGESTIONS,
    buildConditionsMetadata,
    clampIntervalDays,
    conditionsSummary,
    normalizeLight,
    normalizeRoom,
    resolveAddPlantPrefill
} from '../../utils/plantConditions.js'
import {
    isFeatureUnavailable,
    suggestSpeciesFromPhoto
} from '../../utils/plantsExtraApi.js'

const MAX_PHOTOS = 2
const DRAFT_STORAGE_KEY = 'webplant-add-plant-draft'
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000
const ROOM_SUGGESTIONS_ID = 'plantRoomSuggestions'

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

function intervalPresetFor(intervalDays) {
    return PRESETS.find(preset => preset.days === intervalDays)?.id || 'custom'
}

function AddPlants() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [queryPrefill] = useState(() => resolveAddPlantPrefill(searchParams))
    const hasQueryPrefill = Boolean(
        queryPrefill.matchedGuide ||
        queryPrefill.name ||
        queryPrefill.species ||
        Number.isInteger(queryPrefill.intervalDays)
    )
    const [initialDraft] = useState(() => (hasQueryPrefill ? null : readDraft()))
    const prefilledDays = (() => {
        const restored = Number(initialDraft?.days)
        if (Number.isInteger(restored) && restored >= 1 && restored <= 365) return restored
        if (Number.isInteger(queryPrefill.intervalDays)) return queryPrefill.intervalDays
        return 7
    })()
    const [previews, setPreviews] = useState([])
    const filesRef = useRef([])
    const urlsRef = useRef([])
    const timeoutRef = useRef(null)
    const nameInputRef = useRef(null)
    const intervalEditorRef = useRef(null)
    const [saveCompleted, setSaveCompleted] = useState(false)

    const [step, setStep] = useState(1)
    const [leaving, setLeaving] = useState(null)
    const [days, setDays] = useState(prefilledDays)
    const [selectedPreset, setSelectedPreset] = useState(() => {
        if (PRESETS.some(preset => preset.id === initialDraft?.selectedPreset)) {
            return initialDraft.selectedPreset
        }
        return intervalPresetFor(prefilledDays)
    })
    const [selectedWatering, setSelectedWatering] = useState(() =>
        WATERING.some(option => option.id === initialDraft?.selectedWatering)
            ? initialDraft.selectedWatering
            : 'morning'
    )
    const [selectedDays, setSelectedDays] = useState(() => {
        if (Array.isArray(initialDraft?.selectedDays)) {
            return initialDraft.selectedDays.filter(id => Number.isInteger(id) && id >= 0 && id <= 6)
        }
        return getReminderWeekdays(prefilledDays)
    })
    const [notifyMorning, setNotifyMorning] = useState(() =>
        typeof initialDraft?.notifyMorning === 'boolean' ? initialDraft.notifyMorning : true
    )
    const [notifyDayBefore, setNotifyDayBefore] = useState(() =>
        typeof initialDraft?.notifyDayBefore === 'boolean' ? initialDraft.notifyDayBefore : false
    )
    const [justWatered, setJustWatered] = useState(() =>
        typeof initialDraft?.justWatered === 'boolean' ? initialDraft.justWatered : true
    )
    const [name, setName] = useState(() => {
        if (typeof initialDraft?.name === 'string' && initialDraft.name) return initialDraft.name
        return queryPrefill.name.slice(0, 255)
    })
    const [species, setSpecies] = useState(() => {
        if (typeof initialDraft?.species === 'string' && initialDraft.species) return initialDraft.species
        return queryPrefill.species
    })
    const [room, setRoom] = useState(() => {
        if (typeof initialDraft?.room === 'string') return initialDraft.room
        return queryPrefill.room
    })
    const [light, setLight] = useState(() => {
        if (typeof initialDraft?.light === 'string' && normalizeLight(initialDraft.light)) {
            return normalizeLight(initialDraft.light)
        }
        return queryPrefill.light
    })
    const [draftRestored, setDraftRestored] = useState(Boolean(initialDraft))
    const [nameError, setNameError] = useState('')
    const [isSuggestingSpecies, setIsSuggestingSpecies] = useState(false)
    const [speciesSuggestionError, setSpeciesSuggestionError] = useState('')
    const [popularSpecies, setPopularSpecies] = useState(() =>
        mapPopularSpecies([], { plants: PLANTS })
    )
    const [popularSpeciesLoading, setPopularSpeciesLoading] = useState(true)
    const [isWateringDialogOpen, setIsWateringDialogOpen] = useState(false)
    const [wateringAnswers, setWateringAnswers] = useState([])
    const [isAskingWateringTime, setIsAskingWateringTime] = useState(false)
    const [isWateringTimeDialogOpen, setIsWateringTimeDialogOpen] = useState(false)
    const [wateringTimeAdvice, setWateringTimeAdvice] = useState(null)
    const [wateringTimeAdviceError, setWateringTimeAdviceError] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState('')

    const [autoInterval, setAutoInterval] = useState(null)
    const [autoIntervalState, setAutoIntervalState] = useState('idle')
    const intervalTouchedRef = useRef(false)
    const adviceRequestRef = useRef('')

    const [photoSpeciesState, setPhotoSpeciesState] = useState('idle')
    const [photoSpeciesSuggestions, setPhotoSpeciesSuggestions] = useState([])
    const photoSpeciesAvailableRef = useRef(true)
    const photoSpeciesSignatureRef = useRef('')

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

    const applyIntervalDays = useCallback((value, { automatic = false } = {}) => {
        const interval = clampIntervalDays(value)
        setDays(interval)
        setSelectedDays(getReminderWeekdays(interval))
        setSelectedPreset(intervalPresetFor(interval))
        intervalTouchedRef.current = !automatic
    }, [])

    const setManualInterval = (value) => {
        applyIntervalDays(value)
        setAutoIntervalState(current => current === 'applied' ? 'ready' : current)
    }

    const dec = () => {
        setManualInterval(Math.max(1, days - 1))
    }

    const inc = () => {
        setManualInterval(Math.min(365, days + 1))
    }

    const focusIntervalEditor = () => {
        const node = intervalEditorRef.current
        if (!node) return
        node.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        node.focus?.({ preventScroll: true })
    }

    const canRestrictWeekdays = weekdayRestrictionApplies(days)
    const weekdayPreview = canRestrictWeekdays ? [] : upcomingWateringDays(days, new Date(), 4)
    const previewWeekdays = new Set(weekdayPreview.map(item => item.weekday))

    const currentRoom = normalizeRoom(room)
    const currentLight = normalizeLight(light)
    const conditionsLabel = conditionsSummary(currentRoom, currentLight)

    const draftHasContent =
        Boolean(name.trim()) ||
        Boolean(species.trim()) ||
        Boolean(currentRoom) ||
        Boolean(currentLight) ||
        !justWatered ||
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
        void requestAutoInterval()
        goToStep(2)
    }

    const backToIntervalStep = () => {
        void requestAutoInterval()
        goToStep(2)
    }

    const adviceSignature = [
        name.trim().toLowerCase(),
        species.trim().toLowerCase(),
        currentRoom.toLowerCase(),
        currentLight
    ].join('|')

    const requestAutoInterval = async () => {
        if (!name.trim()) return
        if (adviceRequestRef.current === adviceSignature) return
        adviceRequestRef.current = adviceSignature
        setAutoIntervalState('loading')
        setAutoInterval(null)

        const payload = {
            name: name.trim(),
            species: species.trim(),
            answers: [],
            mode: 'recommendation'
        }
        if (conditionsLabel) payload.location = conditionsLabel

        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/watering-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                setAutoIntervalState('unavailable')
                return
            }
            const intervalDays = Number(data?.intervalDays)
            if (
                data?.type === 'recommendation' &&
                Number.isInteger(intervalDays) &&
                intervalDays >= 1 &&
                intervalDays <= 365
            ) {
                setAutoInterval({
                    intervalDays,
                    reason: typeof data.reason === 'string' ? data.reason.trim() : '',
                    confidence: typeof data.confidence === 'string' ? data.confidence : ''
                })
                if (intervalTouchedRef.current) {
                    setAutoIntervalState('ready')
                    return
                }
                applyIntervalDays(intervalDays, { automatic: true })
                setAutoIntervalState('applied')
                return
            }
            setAutoIntervalState('unavailable')
        } catch (error) {
            console.warn('Не удалось подобрать интервал автоматически:', error)
            setAutoIntervalState('unavailable')
        }
    }

    const runPhotoSpeciesSuggestion = async file => {
        if (!file || !photoSpeciesAvailableRef.current) return
        const signature = `${file.name}|${file.size}|${file.lastModified}`
        if (photoSpeciesSignatureRef.current === signature) return
        photoSpeciesSignatureRef.current = signature
        setPhotoSpeciesState('loading')

        try {
            const items = await suggestSpeciesFromPhoto(file)
            if (!Array.isArray(items) || !items.length) {
                setPhotoSpeciesSuggestions([])
                setPhotoSpeciesState('empty')
                return
            }
            setPhotoSpeciesSuggestions(items)
            setPhotoSpeciesState('ready')
        } catch (error) {
            if (isFeatureUnavailable(error)) {
                photoSpeciesAvailableRef.current = false
                setPhotoSpeciesSuggestions([])
                setPhotoSpeciesState('hidden')
                return
            }
            console.warn('Не удалось подобрать вид по фото:', error)
            setPhotoSpeciesSuggestions([])
            setPhotoSpeciesState('hidden')
        }
    }

    const applyPhotoSpeciesSuggestion = suggestion => {
        setSpecies(suggestion.species || suggestion.latin || suggestion.name)
        setPhotoSpeciesState('applied')
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

    const requestWateringTimeAdvice = async () => {
        if (!name.trim() || isAskingWateringTime) return

        setIsWateringTimeDialogOpen(true)
        setIsAskingWateringTime(true)
        setWateringTimeAdvice(null)
        setWateringTimeAdviceError('')
        try {
            const payload = {
                name: name.trim(),
                species: species.trim(),
                intervalDays: days
            }
            if (conditionsLabel) payload.location = conditionsLabel
            const response = await fetchWithTimeout(`${API_URL}/plants/watering-time-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
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
        if (!name.trim()) return
        setIsWateringDialogOpen(true)
    }

    const closeWateringAdvice = () => {
        setIsWateringDialogOpen(false)
    }

    const applyWateringRecommendation = intervalDays => {
        setManualInterval(intervalDays)
        setAutoIntervalState('ready')
    }

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
        void runPhotoSpeciesSuggestion(filesRef.current[0])

        e.target.value = ''
    }

    const handleRemove = (index) => {
        URL.revokeObjectURL(urlsRef.current[index])
        filesRef.current = filesRef.current.filter((_, i) => i !== index)
        urlsRef.current = urlsRef.current.filter((_, i) => i !== index)
        setPreviews([...urlsRef.current])
        if (!filesRef.current.length) {
            photoSpeciesSignatureRef.current = ''
            setPhotoSpeciesSuggestions([])
            setPhotoSpeciesState('idle')
            return
        }
        if (index === 0) void runPhotoSpeciesSuggestion(filesRef.current[0])
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
            room,
            light,
            days,
            selectedPreset,
            selectedWatering,
            selectedDays,
            notifyMorning,
            notifyDayBefore,
            justWatered,
            step
        })
    }, [
        draftHasContent,
        saveCompleted,
        name,
        species,
        room,
        light,
        days,
        selectedPreset,
        selectedWatering,
        selectedDays,
        notifyMorning,
        notifyDayBefore,
        justWatered,
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

    useEffect(() => {
        let cancelled = false

        const loadPopularSpecies = async () => {
            try {
                const response = await fetchWithTimeout(
                    `${API_URL}/plants/popular-species?limit=${POPULAR_SPECIES_LIMIT}`,
                    { method: 'GET', credentials: 'include' }
                )
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }
                const data = await response.json().catch(() => ({}))
                if (cancelled) return
                setPopularSpecies(mapPopularSpecies(data?.items, { plants: PLANTS }))
            } catch (error) {
                if (cancelled) return
                console.warn('Не удалось загрузить популярные виды:', error)
                setPopularSpecies(mapPopularSpecies([], { plants: PLANTS }))
            } finally {
                if (!cancelled) setPopularSpeciesLoading(false)
            }
        }

        loadPopularSpecies()
        return () => {
            cancelled = true
        }
    }, [])

    const markJustWatered = async plantId => {
        if (!plantId) return false
        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/${plantId}/water`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            })
            return response.ok
        } catch (error) {
            console.warn('Не удалось отметить первый полив:', error)
            return false
        }
    }

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

            const metadata = buildConditionsMetadata(
                currentLight,
                wateringAnswers.length
                    ? {
                        care_hints: {
                            watering_answers: wateringAnswers
                        }
                    }
                    : {}
            )

            const response = await fetch(`${API_URL}/plants`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name.trim(),
                    species: species.trim(),
                    location: currentRoom || null,
                    light: currentLight || undefined,
                    photos: uploadedUrls,
                    watering_interval_days: days,
                    watering_time_of_day: selectedWatering,
                    notify_morning: notifyMorning,
                    notify_day_before: notifyDayBefore,
                    reminder_weekdays: selectedDays,
                    metadata: Object.keys(metadata).length ? metadata : undefined
                }),
                credentials: 'include'
            })

            const responseData = await response.json().catch(() => ({}))

            if (response.ok) {
                const createdId = responseData.id ?? responseData.plant?.id ?? null
                const waterMarked = justWatered ? await markJustWatered(createdId) : false
                const hasPhoto = uploadedUrls.length > 0
                trackEvent('plant_created', {
                    hasPhoto,
                    hasSpecies: Boolean(species.trim()),
                    intervalDays: Number(days) || 0,
                    hasConditions: Boolean(currentRoom || currentLight)
                })
                if (hasPhoto) trackEvent('photo_added')
                if (waterMarked) trackEvent('watering_marked', { onTime: true })

                saveFirstPlantPending({
                    id: createdId,
                    name: name.trim(),
                    intervalDays: Number(days)
                })

                setSaveCompleted(true)
                clearDraft()
                urlsRef.current.forEach(url => URL.revokeObjectURL(url))
                urlsRef.current = []
                filesRef.current = []

                let subtitle = name.trim()
                if (justWatered) {
                    subtitle = waterMarked
                        ? `${name.trim()} · первый полив отмечен`
                        : `${name.trim()} · полив не отмечен — отметьте на главной`
                }

                setToast({
                    title: 'Растение добавлено',
                    subtitle,
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

    const photoSpeciesVisible =
        photoSpeciesState === 'loading' ||
        photoSpeciesState === 'ready' ||
        (photoSpeciesState === 'applied' && photoSpeciesSuggestions.length > 0)

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
                            {photoSpeciesVisible && (
                                <div className='photoSpeciesSuggestion' aria-live='polite'>
                                    {photoSpeciesState === 'loading' && (
                                        <p className='photoSpeciesLoading' role='status'>
                                            Смотрю фото и подбираю вид…
                                        </p>
                                    )}
                                    {photoSpeciesState === 'ready' && (
                                        <>
                                            <p className='photoSpeciesTitle'>Похоже на…</p>
                                            <div className='photoSpeciesChips'>
                                                {photoSpeciesSuggestions.map(suggestion => (
                                                    <button
                                                        key={suggestion.species}
                                                        type='button'
                                                        className='photoSpeciesChip'
                                                        onClick={() => applyPhotoSpeciesSuggestion(suggestion)}
                                                        title={suggestion.latin || suggestion.species}
                                                    >
                                                        {suggestion.name}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className='photoSpeciesHint'>
                                                Вид можно поменять вручную ниже.
                                            </p>
                                        </>
                                    )}
                                    {photoSpeciesState === 'applied' && (
                                        <p className='photoSpeciesLoading'>
                                            Вид подставлен: {species || '—'}. Можно изменить вручную ниже.
                                        </p>
                                    )}
                                </div>
                            )}
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
                                            {isSuggestingSpecies ? 'Подбираю…' : 'Подсказать вид'}
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
                            <div className='plantConditions'>
                                <p className='plantConditionsTitle'>Условия содержания</p>
                                <p className='plantConditionsSubtitle'>
                                    Подскажем интервал полива с учётом места и света
                                </p>
                                <label className='plantConditionField' htmlFor='plantRoom'>
                                    <span>Комната</span>
                                    <input
                                        id='plantRoom'
                                        type='text'
                                        maxLength={255}
                                        list={ROOM_SUGGESTIONS_ID}
                                        placeholder='Гостиная'
                                        value={room}
                                        onChange={event => setRoom(event.target.value)}
                                    />
                                </label>
                                <datalist id={ROOM_SUGGESTIONS_ID}>
                                    {ROOM_SUGGESTIONS.map(option => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                                <fieldset className='plantLightChoices'>
                                    <legend>Свет</legend>
                                    <div>
                                        {LIGHT_OPTIONS.map(option => (
                                            <label
                                                key={option.id}
                                                className={`plantLightChoice ${currentLight === option.id ? 'active' : ''}`}
                                                title={option.hint}
                                            >
                                                <input
                                                    type='radio'
                                                    name='plantLight'
                                                    value={option.id}
                                                    checked={currentLight === option.id}
                                                    onChange={() => setLight(option.id)}
                                                />
                                                <span>{option.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <p className='plantLightHint'>
                                        {LIGHT_OPTIONS.find(option => option.id === currentLight)?.hint
                                            ?? 'Выберите, сколько света получает растение'}
                                    </p>
                                </fieldset>
                            </div>
                            <div className='popularTypes'>
                                <p>Популярные виды</p>
                                <div
                                    aria-busy={popularSpeciesLoading || undefined}
                                    aria-label='Популярные виды растений'
                                    className='gridPopular'
                                    role='group'
                                >
                                    {popularSpecies.map(item => (
                                        <button
                                            key={item.species}
                                            type="button"
                                            title={item.species}
                                            aria-label={`Подставить вид «${item.label}»`}
                                            onClick={() => setSpecies(item.species)}
                                        >
                                            {item.label}
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
                                    </div>
                                </div>
                                <div className='autoIntervalBlock' aria-live='polite'>
                                    {autoIntervalState === 'loading' && (
                                        <p className='autoIntervalHint' role='status'>
                                            <span className='autoIntervalSpinner' aria-hidden='true' />
                                            Подбираю интервал по виду и условиям…
                                        </p>
                                    )}
                                    {autoIntervalState === 'applied' && autoInterval && (
                                        <p className='autoIntervalHint autoIntervalHint--ready'>
                                            Подставили интервал {everyDaysLabel(autoInterval.intervalDays)}
                                            {conditionsLabel ? ` — с учётом «${conditionsLabel}»` : ' — по виду растения'}.
                                        </p>
                                    )}
                                    {autoIntervalState === 'ready' && autoInterval && (
                                        <div className='autoIntervalHint autoIntervalHint--offer'>
                                            <p>
                                                ИИ предлагает {everyDaysLabel(autoInterval.intervalDays)}.
                                                {autoInterval.reason ? ` ${autoInterval.reason}` : ''}
                                            </p>
                                            <button
                                                type='button'
                                                className='autoIntervalApply'
                                                onClick={() => {
                                                    applyIntervalDays(autoInterval.intervalDays, { automatic: true })
                                                    setAutoIntervalState('applied')
                                                }}
                                            >
                                                Применить
                                            </button>
                                        </div>
                                    )}
                                    {autoIntervalState === 'unavailable' && (
                                        <p className='autoIntervalHint autoIntervalHint--muted'>
                                            Не удалось подобрать интервал автоматически — выберите вручную ниже.
                                        </p>
                                    )}
                                    {autoInterval && (
                                        <button
                                            type='button'
                                            className='autoIntervalEdit'
                                            onClick={focusIntervalEditor}
                                        >
                                            Поправить интервал
                                        </button>
                                    )}
                                </div>
                                <div
                                    className='intervalEditor'
                                    ref={intervalEditorRef}
                                    tabIndex={-1}
                                    role='group'
                                    aria-label='Интервал полива'
                                >
                                    <div className='buttonHoldWatering'>
                                        {PRESETS.map(p => (
                                            <button
                                                key={p.id}
                                                type='button'
                                                className={`wateringPreset ${selectedPreset === p.id ? 'active' : ''}`}
                                                onClick={() => {
                                                    applyIntervalDays(p.days)
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
                                <div className='plantAdviceRow'>
                                    <button
                                        type='button'
                                        className='plantAdviceTextLink'
                                        onClick={openWateringAdvice}
                                        disabled={!name.trim()}
                                    >
                                        Уточнить у ИИ, если условия необычные
                                    </button>
                                </div>
                            </div>
                            <div className='presetPlantCheck'>
                                <div>
                                    <div className='headerOfBlockWatering'>
                                        <p>Когда поливать</p>
                                        <button
                                            type='button'
                                            className='askAI wateringAdviceTrigger plantAdviceLink'
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
                                            type="button"
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
                        <label className='justWateredOption'>
                            <input
                                type='checkbox'
                                checked={justWatered}
                                onChange={event => setJustWatered(event.target.checked)}
                            />
                            <span>
                                <span className='justWateredTitle'>Я только что полил</span>
                                <span className='justWateredHint'>
                                    Создадим первую запись в истории и отсчитаем график от сегодня
                                </span>
                            </span>
                        </label>
                        <div className='buttonOfslider'>
                            <button
                                type="button"
                                className='backSlidewatering'
                                onClick={backToIntervalStep}
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
                    <WateringAdviceDialog
                        open
                        plantName={name}
                        species={species}
                        location={conditionsLabel}
                        currentIntervalDays={days}
                        onClose={closeWateringAdvice}
                        onApply={applyWateringRecommendation}
                        onAnswersChange={setWateringAnswers}
                    />
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
