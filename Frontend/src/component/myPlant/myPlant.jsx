import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import BackBtn from '../../assets/BackBtn.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import PlantPhoto from '../PlantPhoto/PlantPhoto'
import CareActionSheet from '../careActions/CareActionSheet.jsx'
import WateringAdviceDialog from '../wateringAdvice/WateringAdviceDialog.jsx'
import './myPlant.css'
import './dark-theme.css'
import search from '../../assets/search.svg'
import sparkles from '../../assets/sparkles.svg'
import xcircle from '../../assets/x-circle.svg'
import plus from '../../assets/plus.svg'
import shieldCheck from '../../assets/shield-check.svg'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { formatCareSummary } from '../../utils/careActionForm.js'
import {
    dayOfMonth,
    diffInDays,
    monthGenitive,
    weekdayRestrictionApplies
} from '../../utils/date.js'
import {
    LIGHT_OPTIONS,
    ROOM_SUGGESTIONS,
    buildConditionsMetadata,
    guidePlants,
    lightFromPlant,
    lightLabel,
    normalizeLight,
    normalizeRoom,
    roomFromPlant
} from '../../utils/plantConditions.js'
import {
    fetchPlantPhotos,
    formatCheckDate,
    healthCheckFromPlant,
    healthCheckLabel,
    isFeatureUnavailable,
    normalizePhotoList,
    pickLatestHealthCheck,
    readHealthChecks,
    requestPlantHealthCheck,
    saveHealthCheck,
    sortPhotosByDate
} from '../../utils/plantsExtraApi.js'
import { markWateredWithQueue } from '../../utils/offlineQueue.js'
import { trackEvent } from '../../utils/productEvents.js'
import {
    GARDEN_SHARE_TITLE,
    buildShareUrl,
    createGardenShare,
    fetchShareStatus,
    shareGardenLink
} from '../../utils/gardenShare.js'

const WEEKDAYS = [
    { id: 1, label: 'Пн' },
    { id: 2, label: 'Вт' },
    { id: 3, label: 'Ср' },
    { id: 4, label: 'Чт' },
    { id: 5, label: 'Пт' },
    { id: 6, label: 'Сб' },
    { id: 0, label: 'Вс' }
]

const WATERING_TIMES = [
    { id: 'morning', label: 'Утро' },
    { id: 'day', label: 'День' },
    { id: 'evening', label: 'Вечер' }
]

const DAY_WORD_FORMS = ['день', 'дня', 'дней']
const DAY_MS = 86_400_000
const ROOM_SUGGESTIONS_ID = 'editPlantRoomSuggestions'
const MAX_HEALTH_PHOTO_SIZE = 5 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

function plural(count, forms) {
    const value = Math.abs(Number(count))
    if (!Number.isFinite(value)) return forms[2]
    const mod10 = value % 10
    const mod100 = value % 100
    if (mod10 === 1 && mod100 !== 11) return forms[0]
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
    return forms[2]
}

function daysWord(count) {
    return plural(count, DAY_WORD_FORMS)
}

function mainPhotoUrl(item) {
    if (!item) return null
    if (Array.isArray(item.photos) && item.photos.length) {
        const main = item.photos.find(photo => photo?.is_main) || item.photos[0]
        if (main?.url) return main.url
    }
    return item.photo_url || item.photo_thumb_url || null
}

function plantRoom(item) {
    return roomFromPlant(item)
}

function formatDayMonth(value) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return `${dayOfMonth(date)} ${monthGenitive(date)}`
}

function wateringStatus(item) {
    if (!item?.next_watering_at) return null
    const next = new Date(item.next_watering_at)
    if (!Number.isFinite(next.getTime())) return null

    const diff = diffInDays(next, new Date())

    if (diff < 0) {
        const late = Math.abs(diff)
        return {
            tone: 'overdue',
            label: late === 1 ? 'Полив просрочен на 1 день' : `Полив просрочен на ${late} ${daysWord(late)}`,
            date: formatDayMonth(next)
        }
    }
    if (diff === 0) {
        return { tone: 'today', label: 'Полить сегодня', date: formatDayMonth(next) }
    }
    if (diff === 1) {
        return { tone: 'soon', label: 'Полить завтра', date: formatDayMonth(next) }
    }
    return {
        tone: 'soon',
        label: `Полить через ${diff} ${daysWord(diff)}`,
        date: formatDayMonth(next)
    }
}

function estimateNextWatering(item) {
    const interval = Number(item?.watering_interval_days)
    const days = Number.isInteger(interval) && interval > 0 ? interval : 7
    return new Date(Date.now() + days * DAY_MS).toISOString()
}

async function readResponse(response) {
    return response.json().catch(() => ({}))
}

function MyPlant() {
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const [plant, setPlant] = useState([])
    const [searchQuery, setSearchQuery] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [listError, setListError] = useState('')
    const [editingPlant, setEditingPlant] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [editError, setEditError] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [deleteError, setDeleteError] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)
    const [careSheetPlant, setCareSheetPlant] = useState(null)
    const [latestCare, setLatestCare] = useState({})
    const [isWateringAdviceOpen, setIsWateringAdviceOpen] = useState(false)
    const [aiIntervalHint, setAiIntervalHint] = useState('')
    const [wateringId, setWateringId] = useState(null)
    const [waterNotice, setWaterNotice] = useState(null)
    const [shareBusyId, setShareBusyId] = useState(null)
    const [shareConfirmPlant, setShareConfirmPlant] = useState(null)
    const [healthChecks, setHealthChecks] = useState(readHealthChecks)
    const [healthBusyId, setHealthBusyId] = useState(null)
    const [healthDialog, setHealthDialog] = useState(null)
    const [growthDialog, setGrowthDialog] = useState(null)
    const [multiAddResult] = useState(() => {
        const addedRaw = Number(location.state?.addedPlants)
        const created = Number.isInteger(addedRaw) && addedRaw > 0 ? addedRaw : 0
        const failedRaw = Array.isArray(location.state?.addedPlantsFailed)
            ? location.state.addedPlantsFailed
            : []
        const failed = []
        for (const value of failedRaw) {
            const name = typeof value === 'string'
                ? value.trim()
                : (value && typeof value.name === 'string' ? value.name.trim() : '')
            if (name && !failed.includes(name)) failed.push(name)
        }
        return { created, failed, total: created + failed.length }
    })
    const multiAdded = multiAddResult.created
    const [multiAddedDismissed, setMultiAddedDismissed] = useState(false)
    const healthFileInputRef = useRef(null)
    const pendingHealthPlantRef = useRef(null)
    const deepLinkHandledRef = useRef('')
    const editDialogRef = useRef(null)
    const healthRetryRef = useRef(null)
    const healthRequestRef = useRef(null)
    const healthRequestSeqRef = useRef(0)
    const previousFocusRef = useRef(null)
    const wasEditingRef = useRef(false)

    const cancelHealthCheck = useCallback(() => {
        const active = healthRequestRef.current
        healthRequestRef.current = null
        if (active?.controller && typeof active.controller.abort === 'function') {
            try {
                active.controller.abort()
            } catch {
                void 0
            }
        }
        return Boolean(active)
    }, [])

    const closeHealthDialog = useCallback(() => {
        cancelHealthCheck()
        setHealthBusyId(null)
        setHealthDialog(null)
    }, [cancelHealthCheck])

    useEffect(() => () => {
        cancelHealthCheck()
    }, [cancelHealthCheck])

    const getAllPlant = useCallback(async (options = {}) => {
        const silent = Boolean(options) && options.silent === true
        if (!silent) setIsLoading(true)
        if (!silent) setListError('')
        try {
            const response = await fetch(`${API_URL}/plants/`, {
                method: 'GET',
                credentials: 'include'
            })
            if (response.status === 401 || response.status === 404) {
                navigate('/login', { replace: true })
                return
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const data = await response.json()
            if (!Array.isArray(data)) {
                throw new Error('Сервер вернул некорректный список растений')
            }
            setPlant(data)
        } catch (error) {
            console.error('Ошибка получения растений:', error)
            if (!silent) {
                setListError('Не удалось загрузить растения. Проверьте подключение и попробуйте ещё раз.')
            }
        } finally {
            if (!silent) setIsLoading(false)
        }
    }, [navigate])

    useEffect(() => {
        const loadPlants = async () => getAllPlant()
        loadPlants()
    }, [getAllPlant])

    const loadLatestCare = useCallback(async () => {
        try {
            const response = await fetchWithTimeout(
                `${API_URL}/plants/care-actions/latest`,
                { method: 'GET', credentials: 'include' }
            )
            if (!response.ok) return
            const data = await response.json().catch(() => ({}))
            const items = Array.isArray(data?.items) ? data.items : []
            const next = {}
            for (const item of items) {
                if (item && item.plant_id !== null && item.plant_id !== undefined) {
                    next[item.plant_id] = item
                }
            }
            setLatestCare(next)
        } catch (error) {
            console.warn('Не удалось загрузить последний уход:', error)
        }
    }, [])

    useEffect(() => {
        const load = async () => loadLatestCare()
        load()
    }, [loadLatestCare])

    useEffect(() => {
        if (!waterNotice) return undefined
        const timer = window.setTimeout(() => setWaterNotice(null), 6000)
        return () => window.clearTimeout(timer)
    }, [waterNotice])

    useEffect(() => {
        if (!multiAdded || multiAddedDismissed || multiAddResult.failed.length > 0) return undefined
        const timer = window.setTimeout(() => setMultiAddedDismissed(true), 9000)
        return () => window.clearTimeout(timer)
    }, [multiAdded, multiAddedDismissed, multiAddResult.failed.length])

    useEffect(() => {
        if (!editingPlant && !deleteTarget && !healthDialog && !growthDialog && !shareConfirmPlant) {
            return undefined
        }

        const handleKeyDown = event => {
            if (event.key !== 'Escape' || isSaving || isDeleting) return
            if (healthDialog) {
                closeHealthDialog()
                return
            }
            if (growthDialog) {
                setGrowthDialog(null)
                return
            }
            if (shareConfirmPlant) {
                setShareConfirmPlant(null)
                return
            }
            if (editingPlant && isWateringAdviceOpen) {
                setIsWateringAdviceOpen(false)
                return
            }
            setEditingPlant(null)
            setEditError('')
            setDeleteTarget(null)
            setDeleteError('')
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [
        editingPlant,
        deleteTarget,
        isSaving,
        isDeleting,
        isWateringAdviceOpen,
        healthDialog,
        growthDialog,
        shareConfirmPlant,
        closeHealthDialog
    ])

    const openEditor = useCallback(selectedPlant => {
        const activeElement = typeof document === 'undefined' ? null : document.activeElement
        previousFocusRef.current = activeElement && activeElement !== document.body
            ? activeElement
            : null
        setEditingPlant(selectedPlant)
        setEditForm({
            name: selectedPlant.name ?? '',
            species: selectedPlant.species ?? '',
            location: plantRoom(selectedPlant),
            light: lightFromPlant(selectedPlant),
            watering_interval_days: String(selectedPlant.watering_interval_days || 7),
            watering_time_of_day: selectedPlant.watering_time_of_day || 'morning',
            notify_morning: selectedPlant.notify_morning !== false,
            notify_day_before: selectedPlant.notify_day_before === true,
            reminder_weekdays: Array.isArray(selectedPlant.reminder_weekdays)
                ? selectedPlant.reminder_weekdays
                : []
        })
        setEditError('')
        setIsWateringAdviceOpen(false)
        setAiIntervalHint('')
    }, [])

    useEffect(() => {
        if (editingPlant) {
            wasEditingRef.current = true
            const frame = window.requestAnimationFrame(() => {
                editDialogRef.current?.focus({ preventScroll: true })
            })
            return () => window.cancelAnimationFrame(frame)
        }

        if (!wasEditingRef.current) return undefined
        wasEditingRef.current = false
        const previous = previousFocusRef.current
        previousFocusRef.current = null
        if (!previous || typeof previous.focus !== 'function') return undefined
        const frame = window.requestAnimationFrame(() => {
            previous.focus({ preventScroll: true })
        })
        return () => window.cancelAnimationFrame(frame)
    }, [editingPlant])

    useEffect(() => {
        if (isLoading) return undefined
        const plantParam = searchParams.get('plant')
        if (!plantParam) {
            deepLinkHandledRef.current = ''
            return undefined
        }
        if (deepLinkHandledRef.current === plantParam) return undefined
        const target = plant.find(item => String(item.id) === plantParam)
        if (!target) return undefined

        const frame = window.requestAnimationFrame(() => {
            deepLinkHandledRef.current = plantParam
            openEditor(target)
            const next = new URLSearchParams(searchParams)
            next.delete('plant')
            setSearchParams(next, { replace: true })
        })
        return () => window.cancelAnimationFrame(frame)
    }, [isLoading, plant, searchParams, setSearchParams, openEditor])

    const closeEditor = () => {
        if (isSaving) return
        setEditingPlant(null)
        setEditForm(null)
        setEditError('')
        setIsWateringAdviceOpen(false)
        setAiIntervalHint('')
    }

    const applyAiInterval = intervalDays => {
        setEditForm(current => ({
            ...current,
            watering_interval_days: String(intervalDays)
        }))
        setAiIntervalHint(
            `ИИ предложил раз в ${intervalDays} ${daysWord(intervalDays)} — сохраните изменения`
        )
    }

    const handleEditSubmit = async event => {
        event.preventDefault()
        if (!editingPlant || !editForm || isSaving) return

        const intervalDays = Number(editForm.watering_interval_days)
        if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
            setEditError('Укажите интервал от 1 до 365 дней.')
            return
        }
        if (!editForm.name.trim()) {
            setEditError('Введите название растения.')
            return
        }

        const nextRoom = normalizeRoom(editForm.location)
        const nextLight = normalizeLight(editForm.light)
        const editingId = editingPlant.id

        setIsSaving(true)
        setEditError('')
        try {
            const payload = {
                name: editForm.name.trim(),
                species: editForm.species.trim() || null,
                location: nextRoom || null,
                watering_interval_days: intervalDays,
                watering_time_of_day: editForm.watering_time_of_day,
                notify_morning: editForm.notify_morning,
                notify_day_before: editForm.notify_day_before,
                reminder_weekdays: editForm.reminder_weekdays
            }
            if (nextLight) {
                payload.light = nextLight
                payload.metadata = buildConditionsMetadata(nextLight)
            }
            const response = await fetch(`${API_URL}/plants/${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            })
            const data = await readResponse(response)
            if (!response.ok) {
                throw new Error(data.message || `Не удалось сохранить изменения: HTTP ${response.status}`)
            }

            setPlant(current =>
                current.map(item => item.id === editingId
                    ? {
                        ...item,
                        name: editForm.name.trim(),
                        species: editForm.species.trim() || null,
                        location: nextRoom || null,
                        watering_interval_days: intervalDays,
                        watering_time_of_day: editForm.watering_time_of_day,
                        notify_morning: editForm.notify_morning,
                        notify_day_before: editForm.notify_day_before,
                        reminder_weekdays: editForm.reminder_weekdays,
                        metadata: nextLight
                            ? buildConditionsMetadata(nextLight, item.metadata)
                            : item.metadata
                    }
                    : item)
            )
            setEditingPlant(null)
            setEditForm(null)
            void getAllPlant({ silent: true })
        } catch (error) {
            console.error('Ошибка сохранения растения:', error)
            setEditError(error.message || 'Не удалось сохранить изменения.')
        } finally {
            setIsSaving(false)
        }
    }

    const confirmDeletePlant = async () => {
        if (!deleteTarget || isDeleting) return

        setIsDeleting(true)
        setDeleteError('')
        try {
            const response = await fetch(`${API_URL}/plants/${deleteTarget.id}`, {
                method: 'DELETE',
                credentials: 'include'
            })
            const data = await readResponse(response)
            if (!response.ok) {
                throw new Error(data.message || `Не удалось удалить растение: HTTP ${response.status}`)
            }

            setPlant(current => current.filter(item => item.id !== deleteTarget.id))
            setDeleteTarget(null)
        } catch (error) {
            console.error('Ошибка удаления растения:', error)
            setDeleteError(error.message || 'Не удалось удалить растение.')
        } finally {
            setIsDeleting(false)
        }
    }

    const toggleReminderWeekday = day => {
        if (!weekdayRestrictionApplies(Number(editForm?.watering_interval_days))) return
        setEditForm(current => ({
            ...current,
            reminder_weekdays: current.reminder_weekdays.includes(day)
                ? current.reminder_weekdays.filter(value => value !== day)
                : [...current.reminder_weekdays, day]
        }))
    }

    const waterPlantCard = async item => {
        if (!item?.id || wateringId) return

        setWateringId(item.id)
        setWaterNotice(null)
        try {
            const result = await markWateredWithQueue(item.id)
            if (!result || !result.ok) {
                throw new Error(
                    result?.data?.message ||
                    'Не удалось отметить полив. Проверьте подключение и попробуйте ещё раз.'
                )
            }

            if (result.queued) {
                setWaterNotice({
                    tone: 'ok',
                    text: 'Нет сети — отметка сохранена и отправится, когда связь вернётся.'
                })
            } else {
                setWaterNotice({ tone: 'ok', text: `Полив «${item.name}» отмечен` })
            }

            setPlant(current => current.map(row => row.id === item.id
                ? {
                    ...row,
                    last_watered_at: new Date().toISOString(),
                    next_watering_at: estimateNextWatering(row)
                }
                : row))
            void getAllPlant({ silent: true })
        } catch (error) {
            console.error('Ошибка отметки полива:', error)
            setWaterNotice({
                tone: 'error',
                text: error.message || 'Не удалось отметить полив. Попробуйте ещё раз.'
            })
        } finally {
            setWateringId(null)
        }
    }

    const runHealthCheck = async (item, file = null) => {
        if (!item?.id) return
        if (healthRequestRef.current) return
        if (healthBusyId) return

        const token = {
            id: healthRequestSeqRef.current + 1,
            controller: new AbortController()
        }
        healthRequestSeqRef.current = token.id
        healthRequestRef.current = token

        healthRetryRef.current = () => runHealthCheck(item, file)
        setHealthBusyId(item.id)
        setHealthDialog({ plant: item, status: 'loading', check: null, message: '' })

        try {
            const check = await requestPlantHealthCheck(item.id, {
                photoUrl: file ? '' : (mainPhotoUrl(item) || ''),
                file,
                question: `Проверка здоровья растения «${item.name}»`,
                signal: token.controller.signal
            })
            if (healthRequestRef.current !== token) return
            if (!check) throw new Error('Сервер не вернул результат проверки')
            setHealthChecks(saveHealthCheck(item.id, check))
            setHealthDialog({ plant: item, status: 'ready', check, message: '' })
        } catch (error) {
            if (healthRequestRef.current !== token) return
            console.error('Ошибка проверки здоровья:', error)
            const message = isFeatureUnavailable(error)
                ? 'Проверка здоровья по фото пока недоступна: сервер ещё не обновлён. Можно спросить в чате — пришлите фото там.'
                : error.message || 'Не удалось проверить здоровье. Попробуйте ещё раз.'
            setHealthDialog({ plant: item, status: 'error', check: null, message })
        } finally {
            if (healthRequestRef.current === token) {
                healthRequestRef.current = null
                setHealthBusyId(null)
            }
        }
    }

    const startHealthCheck = item => {
        if (!item?.id || healthBusyId) return
        if (!mainPhotoUrl(item)) {
            pendingHealthPlantRef.current = item
            healthFileInputRef.current?.click()
            return
        }
        void runHealthCheck(item)
    }

    const handleHealthFileChange = event => {
        const file = event.target.files?.[0] ?? null
        event.target.value = ''
        const target = pendingHealthPlantRef.current
        pendingHealthPlantRef.current = null
        if (!target || !file) return
        if (!ALLOWED_PHOTO_TYPES.has(file.type) || file.size > MAX_HEALTH_PHOTO_SIZE) {
            setWaterNotice({
                tone: 'error',
                text: 'Выберите JPEG, PNG, WebP или HEIC размером до 5 МБ'
            })
            return
        }
        void runHealthCheck(target, file)
    }

    const openGrowthGallery = (item, photos) => {
        setGrowthDialog({ plant: item, photos, loading: true, fetchFailed: false })
        fetchPlantPhotos(item.id)
            .then(items => {
                const next = Array.isArray(items) && items.length ? items : photos
                setGrowthDialog(current => current && current.plant.id === item.id
                    ? { ...current, photos: next, loading: false }
                    : current)
            })
            .catch(() => {
                setGrowthDialog(current => current && current.plant.id === item.id
                    ? { ...current, loading: false, fetchFailed: true }
                    : current)
            })
    }

    const closeGrowthDialog = () => setGrowthDialog(null)

    const sharePlant = async item => {
        if (!item?.id || shareBusyId) return
        setShareBusyId(item.id)
        setWaterNotice(null)
        try {
            let url = ''
            try {
                let share = await fetchShareStatus()
                if (!share) share = await createGardenShare()
                if (share?.token) {
                    url = buildShareUrl(share.token, window.location.origin) || ''
                }
            } catch (error) {
                console.warn('Не удалось получить ссылку на сад:', error)
                const message = typeof error?.message === 'string' && error.message.trim()
                    ? error.message.trim()
                    : ''
                setWaterNotice({
                    tone: 'error',
                    text: message || 'Не удалось создать публичную ссылку на сад. Проверьте подключение и попробуйте ещё раз.'
                })
                return
            }
            if (!url) {
                setWaterNotice({
                    tone: 'error',
                    text: 'Не удалось получить публичную ссылку на сад. Попробуйте ещё раз.'
                })
                return
            }

            const title = GARDEN_SHARE_TITLE
            const text = 'Мой сад в «Лейке» — коллекция комнатных растений и напоминания об уходе. Посмотрите, что у меня растёт.'
            trackEvent('share_clicked', { scope: 'garden' })
            const result = await shareGardenLink({ url, title, text })
            if (result === 'shared') {
                setWaterNotice({ tone: 'ok', text: 'Спасибо! Публичная ссылка на сад отправлена.' })
            } else if (result === 'copied') {
                setWaterNotice({ tone: 'ok', text: 'Ссылка на сад скопирована — можно отправить другу' })
            } else {
                setWaterNotice({ tone: 'info', text: 'Шаринг отменён — ссылка не отправлена.' })
            }
        } catch (error) {
            console.error('Ошибка шаринга сада:', error)
            setWaterNotice({ tone: 'error', text: 'Не удалось поделиться садом. Попробуйте ещё раз.' })
        } finally {
            setShareBusyId(null)
        }
    }

    const goAddPlant = () => navigate('/add-plant')

    const goAddPlantFromGuide = guide => {
        const query = new URLSearchParams({
            name: guide.name,
            species: guide.latin || guide.species,
            interval: String(guide.intervalDays)
        })
        navigate(`/add-plant?${query.toString()}`)
    }

    const filteredPlants = plant.filter(item =>
        item.name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
    const canRestrictWeekdays = weekdayRestrictionApplies(
        Number(editForm?.watering_interval_days)
    )
    const editIntervalDays = Number(editForm?.watering_interval_days)
    const editIntervalValue = Number.isInteger(editIntervalDays) && editIntervalDays > 0
        ? editIntervalDays
        : undefined
    const emptyStatePlants = guidePlants(6)
    const goBack = () => {
        if (location.key === 'default') {
            navigate('/home', { replace: true })
            return
        }
        navigate(-1)
    }

    return (
        <main className='gofOfMyplants'>
            <header className='headerOfPlants'>
                <button
                    type='button'
                    className='myPlantsBackButton'
                    onClick={goBack}
                    aria-label='Назад'
                >
                    <ThemedIcon src={BackBtn} alt='' />
                </button>
                <h1>Мои растения</h1>
                <button
                    type='button'
                    className='addPlantHeaderButton'
                    onClick={goAddPlant}
                    aria-label='Добавить растение'
                >
                    <img src={plus} alt='' aria-hidden='true' />
                    <span>Добавить</span>
                </button>
            </header>

            <div className='searchButton'>
                <div className='childOfsearchButton'>
                    <img src={search} alt='' aria-hidden='true' />
                    <input
                        type='search'
                        placeholder='Поиск по названию'
                        className='searchPlaceholder'
                        value={searchQuery}
                        onChange={event => setSearchQuery(event.target.value)}
                        aria-label='Поиск растений по названию'
                    />
                </div>

                {searchQuery && (
                    <button
                        type='button'
                        className='clearPlantSearch'
                        onClick={() => setSearchQuery('')}
                        aria-label='Очистить поиск'
                    >
                        <img src={xcircle} alt='' />
                    </button>
                )}
            </div>

            {multiAddResult.failed.length > 0 && (
                <div className='plantListMessage' role='alert'>
                    <p>
                        <b>Добавлено {multiAddResult.created} из {multiAddResult.total}.</b>{' '}
                        Не добавлены: {multiAddResult.failed.map(name => `«${name}»`).join(', ')}.
                    </p>
                    <p>Можно попробовать ещё раз или добавить их вручную.</p>
                    <div className='plantListMessageActions'>
                        <button type='button' onClick={() => navigate('/add-plant?multi=1')}>
                            Повторить добавление
                        </button>
                        {multiAddResult.failed.map(name => (
                            <button
                                key={name}
                                type='button'
                                onClick={() => navigate(`/add-plant?name=${encodeURIComponent(name)}`)}
                            >
                                Добавить «{name}»
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {multiAdded > 0 && multiAddResult.failed.length === 0 && !multiAddedDismissed && (
                <div className='plantListNotice plantListNotice--success' role='status'>
                    <p>
                        Добавлено {multiAdded} {plural(multiAdded, ['растение', 'растения', 'растений'])}.
                        Интервалы полива взяли из справочника — их можно поправить в карточке.
                    </p>
                    <button
                        type='button'
                        onClick={() => setMultiAddedDismissed(true)}
                        aria-label='Скрыть уведомление о добавленных растениях'
                    >
                        ×
                    </button>
                </div>
            )}

            {waterNotice && (
                <div
                    className={`plantListNotice ${waterNotice.tone === 'error'
                        ? 'plantListNotice--error'
                        : waterNotice.tone === 'ok'
                            ? 'plantListNotice--success'
                            : 'plantListNotice--info'}`}
                    role={waterNotice.tone === 'error' ? 'alert' : 'status'}
                >
                    <p>{waterNotice.text}</p>
                    <button
                        type='button'
                        onClick={() => setWaterNotice(null)}
                        aria-label='Скрыть уведомление'
                    >
                        ×
                    </button>
                </div>
            )}

            {listError && (
                <div className='plantListMessage' role='alert'>
                    <p>{listError}</p>
                    <button type='button' onClick={getAllPlant}>Попробовать ещё раз</button>
                </div>
            )}
            {isLoading && <p className='plantListMessage' role='status'>Загружаем растения…</p>}
            {!isLoading && !listError && plant.length === 0 && (
                <section className='plantEmptyState' aria-labelledby='plantEmptyTitle'>
                    <h2 id='plantEmptyTitle'>Здесь появятся ваши растения</h2>
                    <p className='plantEmptyLead'>
                        Начните с популярного — вид и интервал полива подставим автоматически.
                        Напоминания настроятся сами.
                    </p>
                    <div className='plantEmptyGrid'>
                        {emptyStatePlants.map(guide => (
                            <button
                                key={guide.slug}
                                type='button'
                                className='plantEmptyCard'
                                onClick={() => goAddPlantFromGuide(guide)}
                            >
                                <span className='plantEmptyCardName'>{guide.name}</span>
                                <span className='plantEmptyCardLatin'>{guide.latin}</span>
                                <span className='plantEmptyCardInterval'>
                                    {guide.intervalLabel || `полив каждые ${guide.intervalDays} дн.`}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className='plantEmptyActions'>
                        <button
                            type='button'
                            className='plantEmptyPrimary'
                            onClick={goAddPlant}
                        >
                            <img src={plus} alt='' aria-hidden='true' />
                            Добавить растение
                        </button>
                        <button
                            type='button'
                            className='plantEmptySecondary'
                            onClick={() => navigate('/add-plant?multi=1')}
                        >
                            Добавить сразу несколько
                        </button>
                    </div>
                </section>
            )}

            {!isLoading && !listError && plant.length > 0 && (
                <div className='gridBlocksOfPlant'>
                    {filteredPlants.map(item => {
                        const photo = mainPhotoUrl(item)
                        const room = plantRoom(item)
                        const plantLight = lightFromPlant(item)
                        const lightName = lightLabel(plantLight)
                        const status = wateringStatus(item)
                        const lastWatered = item.last_watered_at
                            ? formatDayMonth(item.last_watered_at)
                            : ''
                        const interval = Number(item.watering_interval_days)
                        const lastCare = latestCare[item.id]
                        const growthPhotos = sortPhotosByDate(normalizePhotoList(item.photos))
                        const lastCheck = pickLatestHealthCheck({
                            checks: healthChecks,
                            plantId: item.id,
                            photos: item.photos,
                            serverCheck: healthCheckFromPlant(item)
                        })
                        const healthInfo = healthCheckLabel(lastCheck)
                        const isWatering = wateringId === item.id
                        const isHealthBusy = healthBusyId === item.id

                        return (
                            <article key={item.id} className='plantRenderOfPants'>
                                <div className='plantCardTop'>
                                    <PlantPhoto
                                        className='plantCardPhoto'
                                        src={photo || undefined}
                                        alt={photo ? `Фото растения «${item.name}»` : ''}
                                    />
                                    <div className='plantCardTitles'>
                                        <h2>{item.name}</h2>
                                        <p className='plantCardSpecies'>
                                            {item.species || 'Вид не указан'}
                                        </p>
                                        <p className='plantCardRoom'>
                                            {room ? `Комната: ${room}` : 'Комната не указана'}
                                        </p>
                                        {lightName && (
                                            <p className='plantCardRoom'>
                                                Свет: {lightName.toLowerCase()}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        type='button'
                                        className='plantCardHealthCheck'
                                        onClick={() => startHealthCheck(item)}
                                        disabled={isHealthBusy}
                                        aria-busy={isHealthBusy || undefined}
                                        aria-label={`Проверить здоровье растения «${item.name}»`}
                                        title='Проверить здоровье по фото'
                                    >
                                        <img src={shieldCheck} alt='' aria-hidden='true' />
                                    </button>
                                </div>
                                {healthInfo && (
                                    <p className={`plantCardHealth plantCardHealth--${healthInfo.tone}`}>
                                        <img src={shieldCheck} alt='' aria-hidden='true' />
                                        Последняя проверка: {healthInfo.label}
                                        {lastCheck.createdAt ? ` · ${formatCheckDate(lastCheck.createdAt)}` : ''}
                                    </p>
                                )}
                                <dl className='plantCardMeta'>
                                    <div>
                                        <dt>Последний полив</dt>
                                        <dd>{lastWatered || 'нет данных'}</dd>
                                    </div>
                                    <div>
                                        <dt>Следующий полив</dt>
                                        <dd>
                                            {status
                                                ? `${status.date}${
                                                    Number.isInteger(interval) && interval > 0
                                                        ? ` · раз в ${interval} ${daysWord(interval)}`
                                                        : ''
                                                }`
                                                : 'не запланирован'}
                                        </dd>
                                    </div>
                                </dl>
                                <p className='plantCardLastCare'>
                                    Последний уход: {lastCare ? formatCareSummary(lastCare) : 'нет данных'}
                                </p>
                                {growthPhotos.length >= 2 && (
                                    <button
                                        type='button'
                                        className='plantGrowthButton'
                                        onClick={() => openGrowthGallery(item, growthPhotos)}
                                        aria-label={`Открыть галерею снимков роста растения «${item.name}»`}
                                    >
                                        <span className='plantGrowthThumbs' aria-hidden='true'>
                                            <PlantPhoto
                                                src={growthPhotos[0].url}
                                                alt=''
                                                className='plantGrowthThumb'
                                            />
                                            <span className='plantGrowthArrow'>→</span>
                                            <PlantPhoto
                                                src={growthPhotos[growthPhotos.length - 1].url}
                                                alt=''
                                                className='plantGrowthThumb'
                                            />
                                        </span>
                                        <span className='plantGrowthText'>
                                            <span>Снимки роста: {growthPhotos.length}</span>
                                            <span>
                                                {formatDayMonth(growthPhotos[0].createdAt)} — {formatDayMonth(growthPhotos[growthPhotos.length - 1].createdAt)}
                                            </span>
                                        </span>
                                    </button>
                                )}
                                {status ? (
                                    <p className={`plantCardStatus plantCardStatus--${status.tone}`}>
                                        <span className='plantCardStatusDot' aria-hidden='true' />
                                        {status.label}
                                    </p>
                                ) : (
                                    <p className='plantCardStatus plantCardStatus--unknown'>
                                        Полив не запланирован
                                    </p>
                                )}
                                <div className='plantCardPrimaryActions'>
                                    <button
                                        type='button'
                                        className='waterPlantButton'
                                        onClick={() => waterPlantCard(item)}
                                        disabled={isWatering}
                                        aria-busy={isWatering || undefined}
                                    >
                                        {isWatering ? 'Поливаем…' : 'Полить'}
                                    </button>
                                    <button
                                        type='button'
                                        className='sharePlantButton'
                                        onClick={() => setShareConfirmPlant(item)}
                                        disabled={shareBusyId === item.id}
                                        aria-busy={shareBusyId === item.id || undefined}
                                        title='Поделиться публичной ссылкой на весь сад'
                                    >
                                        {shareBusyId === item.id ? 'Готовим ссылку…' : 'Поделиться'}
                                    </button>
                                </div>
                                <div className='buttonEditPlants'>
                                    <button
                                        type='button'
                                        className='careActionButton'
                                        onClick={() => setCareSheetPlant(item)}
                                    >
                                        Уход
                                    </button>
                                    <button
                                        type='button'
                                        className='editPlantButton'
                                        onClick={() => openEditor(item)}
                                    >
                                        Изменить
                                    </button>
                                    <button
                                        type='button'
                                        className='deletePlantButton'
                                        onClick={() => {
                                            setDeleteTarget(item)
                                            setDeleteError('')
                                        }}
                                    >
                                        Удалить
                                    </button>
                                </div>
                            </article>
                        )
                    })}
                    {filteredPlants.length === 0 && (
                        <p className='plantListMessage' role='status'>
                            По запросу «{searchQuery}» ничего не найдено.
                        </p>
                    )}
                </div>
            )}

            {!isLoading && !listError && plant.length > 0 && (
                <div className='addPlantBottomBar'>
                    <button
                        type='button'
                        className='addPlantBottomButton'
                        onClick={goAddPlant}
                    >
                        <img src={plus} alt='' aria-hidden='true' />
                        Добавить ещё растение
                    </button>
                </div>
            )}

            <input
                type='file'
                accept='image/jpeg,image/png,image/webp,image/heic'
                className='healthPhotoInput'
                ref={healthFileInputRef}
                onChange={handleHealthFileChange}
                aria-label='Фото растения для проверки здоровья'
                tabIndex={-1}
            />

            {editingPlant && editForm && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeEditor()
                    }}
                >
                    <section
                        className='plantDialog'
                        ref={editDialogRef}
                        tabIndex={-1}
                        role='dialog'
                        aria-modal='true'
                        aria-labelledby='editPlantTitle'
                    >
                        <header className='plantDialogHeader'>
                            <h2 id='editPlantTitle'>Изменить растение</h2>
                            <button
                                type='button'
                                onClick={closeEditor}
                                disabled={isSaving}
                                aria-label='Закрыть'
                            >
                                ×
                            </button>
                        </header>
                        <form onSubmit={handleEditSubmit}>
                            <label>
                                Название
                                <input
                                    type='text'
                                    maxLength={255}
                                    value={editForm.name}
                                    onChange={event => setEditForm(current => ({
                                        ...current,
                                        name: event.target.value
                                    }))}
                                    required
                                />
                            </label>
                            <label>
                                Вид растения
                                <input
                                    type='text'
                                    maxLength={255}
                                    value={editForm.species}
                                    onChange={event => setEditForm(current => ({
                                        ...current,
                                        species: event.target.value
                                    }))}
                                />
                            </label>
                            <div className='plantEditorConditions'>
                                <label>
                                    Комната
                                    <input
                                        type='text'
                                        maxLength={255}
                                        list={ROOM_SUGGESTIONS_ID}
                                        placeholder='Гостиная'
                                        value={editForm.location}
                                        onChange={event => setEditForm(current => ({
                                            ...current,
                                            location: event.target.value
                                        }))}
                                    />
                                </label>
                                <datalist id={ROOM_SUGGESTIONS_ID}>
                                    {ROOM_SUGGESTIONS.map(option => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                                <fieldset className='plantEditorLight'>
                                    <legend>Свет</legend>
                                    <div>
                                        {LIGHT_OPTIONS.map(option => (
                                            <label
                                                key={option.id}
                                                className={normalizeLight(editForm.light) === option.id ? 'active' : ''}
                                                title={option.hint}
                                            >
                                                <input
                                                    type='radio'
                                                    name='editPlantLight'
                                                    value={option.id}
                                                    checked={normalizeLight(editForm.light) === option.id}
                                                    onChange={() => setEditForm(current => ({
                                                        ...current,
                                                        light: option.id
                                                    }))}
                                                />
                                                <span>{option.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            </div>
                            <div className='plantEditorFields'>
                                <label>
                                    Интервал, дней
                                    <input
                                        type='number'
                                        min='1'
                                        max='365'
                                        step='1'
                                        value={editForm.watering_interval_days}
                                        onChange={event => {
                                            setAiIntervalHint('')
                                            setEditForm(current => ({
                                                ...current,
                                                watering_interval_days: event.target.value
                                            }))
                                        }}
                                        required
                                    />
                                </label>
                                <label>
                                    Время полива
                                    <select
                                        value={editForm.watering_time_of_day}
                                        onChange={event => setEditForm(current => ({
                                            ...current,
                                            watering_time_of_day: event.target.value
                                        }))}
                                    >
                                        {WATERING_TIMES.map(time => (
                                            <option key={time.id} value={time.id}>{time.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className='plantEditorAi'>
                                <button
                                    type='button'
                                    className='plantEditorAiButton'
                                    onClick={() => setIsWateringAdviceOpen(true)}
                                    disabled={isSaving}
                                >
                                    <img src={sparkles} alt='' aria-hidden='true' />
                                    Пересмотреть частоту с ИИ
                                </button>
                                {aiIntervalHint && (
                                    <p className='plantEditorAiHint' role='status'>{aiIntervalHint}</p>
                                )}
                            </div>
                            <div className='plantEditorReminders'>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={editForm.notify_morning}
                                        onChange={event => setEditForm(current => ({
                                            ...current,
                                            notify_morning: event.target.checked
                                        }))}
                                    />
                                    Напоминать в день полива
                                </label>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={editForm.notify_day_before}
                                        onChange={event => setEditForm(current => ({
                                            ...current,
                                            notify_day_before: event.target.checked
                                        }))}
                                    />
                                    Напоминать за день
                                </label>
                            </div>
                            <fieldset className='plantEditorWeekdays'>
                                <legend>Дни напоминаний</legend>
                                <div>
                                    {WEEKDAYS.map(day => {
                                        const isSelected = canRestrictWeekdays &&
                                            editForm.reminder_weekdays.includes(day.id)

                                        return (
                                            <button
                                                key={day.id}
                                                type='button'
                                                className={isSelected ? 'active' : ''}
                                                aria-pressed={canRestrictWeekdays ? isSelected : undefined}
                                                onClick={() => toggleReminderWeekday(day.id)}
                                                disabled={!canRestrictWeekdays}
                                            >
                                                {day.label}
                                            </button>
                                        )
                                    })}
                                </div>
                                <small>
                                    {!canRestrictWeekdays
                                        ? 'Полив попадает на разные дни недели — ограничить дни можно при ежедневном поливе или интервале, кратном 7.'
                                        : editForm.reminder_weekdays.length === 0
                                            ? 'Если не выбирать дни, напоминания будут приходить по графику.'
                                            : 'Дни выбраны по частоте полива. При необходимости измените их вручную.'}
                                </small>
                            </fieldset>
                            {editError && <p className='plantDialogError' role='alert'>{editError}</p>}
                            <div className='plantDialogActions'>
                                <button type='button' onClick={closeEditor} disabled={isSaving}>
                                    Отмена
                                </button>
                                <button type='submit' disabled={isSaving}>
                                    {isSaving ? 'Сохраняем…' : 'Сохранить'}
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            {editingPlant && editForm && isWateringAdviceOpen && (
                <WateringAdviceDialog
                    open
                    plantName={(editForm.name || '').trim() || editingPlant.name || ''}
                    species={(editForm.species || '').trim() || editingPlant.species || ''}
                    location={[plantRoom(editingPlant), lightLabel(lightFromPlant(editingPlant))].filter(Boolean).join(', ')}
                    currentIntervalDays={editIntervalValue}
                    onClose={() => setIsWateringAdviceOpen(false)}
                    onApply={applyAiInterval}
                />
            )}

            {shareConfirmPlant && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) setShareConfirmPlant(null)
                    }}
                >
                    <section
                        className='plantDialog plantShareDialog'
                        role='alertdialog'
                        aria-modal='true'
                        aria-labelledby='shareGardenTitle'
                        aria-describedby='shareGardenDescription'
                    >
                        <header className='plantDialogHeader'>
                            <h2 id='shareGardenTitle'>Поделиться всем садом?</h2>
                            <button
                                type='button'
                                onClick={() => setShareConfirmPlant(null)}
                                aria-label='Закрыть подтверждение шаринга'
                            >
                                ×
                            </button>
                        </header>
                        <p className='plantHealthText' id='shareGardenDescription'>
                            Отдельной ссылки на одно растение нет. «Поделиться» создаёт публичную
                            ссылку на весь ваш сад: получатель увидит все растения, их виды и
                            интервалы полива. Создать публичную ссылку на сад и отправить её?
                        </p>
                        <div className='plantDialogActions'>
                            <button type='button' onClick={() => setShareConfirmPlant(null)}>
                                Отмена
                            </button>
                            <button
                                type='button'
                                className='plantShareConfirm'
                                onClick={() => {
                                    const target = shareConfirmPlant
                                    setShareConfirmPlant(null)
                                    void sharePlant(target)
                                }}
                            >
                                Создать ссылку и поделиться
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {healthDialog && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeHealthDialog()
                    }}
                >
                    <section
                        className='plantDialog plantHealthDialog'
                        role='dialog'
                        aria-modal='true'
                        aria-labelledby='plantHealthTitle'
                        aria-busy={healthDialog.status === 'loading' || undefined}
                    >
                        <header className='plantDialogHeader'>
                            <h2 id='plantHealthTitle'>Проверка здоровья</h2>
                            <button
                                type='button'
                                onClick={closeHealthDialog}
                                aria-label='Закрыть проверку здоровья'
                            >
                                ×
                            </button>
                        </header>
                        <p className='plantHealthPlant'>«{healthDialog.plant.name}»</p>
                        {healthDialog.status === 'loading' && (
                            <>
                                <p className='plantHealthStatus' role='status'>Смотрю фото растения…</p>
                                <div className='plantDialogActions'>
                                    <button type='button' onClick={closeHealthDialog}>Отмена</button>
                                </div>
                            </>
                        )}
                        {healthDialog.status === 'error' && (
                            <>
                                <p className='plantDialogError' role='alert'>{healthDialog.message}</p>
                                <div className='plantDialogActions'>
                                    <button type='button' onClick={closeHealthDialog}>Закрыть</button>
                                    <button
                                        type='button'
                                        onClick={() => {
                                            const retry = healthRetryRef.current
                                            if (typeof retry === 'function') retry()
                                        }}
                                    >
                                        Попробовать ещё раз
                                    </button>
                                </div>
                            </>
                        )}
                        {healthDialog.status === 'ready' && healthDialog.check && (
                            <>
                                {healthDialog.check.text && (
                                    <p className='plantHealthText'>{healthDialog.check.text}</p>
                                )}
                                {healthDialog.check.diagnosis?.likelyProblems?.length > 0 && (
                                    <ul className='plantHealthProblems'>
                                        {healthDialog.check.diagnosis.likelyProblems.map(problem => (
                                            <li key={problem.name}>
                                                <b>{problem.name}</b>
                                                {problem.why ? ` — ${problem.why}` : ''}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {healthDialog.check.diagnosis?.careAdvice?.length > 0 && (
                                    <ul className='plantHealthAdvice'>
                                        {healthDialog.check.diagnosis.careAdvice.map(advice => (
                                            <li key={advice}>{advice}</li>
                                        ))}
                                    </ul>
                                )}
                                <p className='plantHealthNote'>
                                    Это предварительная оценка по фото, а не диагноз.
                                    Проверяйте грунт и состояние листьев.
                                </p>
                                <div className='plantDialogActions'>
                                    <button type='button' onClick={closeHealthDialog}>Понятно</button>
                                </div>
                            </>
                        )}
                    </section>
                </div>
            )}

            {growthDialog && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeGrowthDialog()
                    }}
                >
                    <section
                        className='plantDialog plantGrowthDialog'
                        role='dialog'
                        aria-modal='true'
                        aria-labelledby='plantGrowthTitle'
                    >
                        <header className='plantDialogHeader'>
                            <h2 id='plantGrowthTitle'>Снимки роста</h2>
                            <button
                                type='button'
                                onClick={closeGrowthDialog}
                                aria-label='Закрыть снимки роста'
                            >
                                ×
                            </button>
                        </header>
                        <p className='plantHealthPlant'>«{growthDialog.plant.name}»</p>
                        {growthDialog.loading && (
                            <p className='plantHealthStatus' role='status'>Загружаем снимки…</p>
                        )}
                        <ol className='plantGrowthList'>
                            {sortPhotosByDate(growthDialog.photos).map((photo, index, list) => (
                                <li key={photo.url}>
                                    <PlantPhoto
                                        className='plantGrowthListPhoto'
                                        src={photo.url}
                                        alt={`Снимок ${index + 1}`}
                                        loading='lazy'
                                        decoding='async'
                                    />
                                    <span className='plantGrowthListDate'>
                                        {formatDayMonth(photo.createdAt) || 'без даты'}
                                    </span>
                                    {index === 0 && <span className='plantGrowthTag'>до</span>}
                                    {index === list.length - 1 && list.length > 1 && (
                                        <span className='plantGrowthTag plantGrowthTag--after'>после</span>
                                    )}
                                </li>
                            ))}
                        </ol>
                        {growthDialog.fetchFailed && (
                            <p className='plantGrowthHint'>
                                Не удалось загрузить все снимки — показаны сохранённые на карточке.
                            </p>
                        )}
                    </section>
                </div>
            )}

            {deleteTarget && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget && !isDeleting) {
                            setDeleteTarget(null)
                            setDeleteError('')
                        }
                    }}
                >
                    <section
                        className='plantDialog plantDeleteDialog'
                        role='alertdialog'
                        aria-modal='true'
                        aria-labelledby='deletePlantTitle'
                        aria-describedby='deletePlantDescription'
                    >
                        <h2 id='deletePlantTitle'>Удалить растение?</h2>
                        <p id='deletePlantDescription'>
                            «{deleteTarget.name}» и история полива будут удалены без возможности восстановления.
                        </p>
                        {deleteError && <p className='plantDialogError' role='alert'>{deleteError}</p>}
                        <div className='plantDialogActions'>
                            <button
                                type='button'
                                onClick={() => {
                                    setDeleteTarget(null)
                                    setDeleteError('')
                                }}
                                disabled={isDeleting}
                            >
                                Отмена
                            </button>
                            <button
                                type='button'
                                className='confirmPlantDelete'
                                onClick={confirmDeletePlant}
                                disabled={isDeleting}
                            >
                                {isDeleting ? 'Удаляем…' : 'Удалить'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
            <CareActionSheet
                open={Boolean(careSheetPlant)}
                plantId={careSheetPlant?.id ?? null}
                plants={plant}
                initialAction='fertilize'
                onClose={() => setCareSheetPlant(null)}
                onSaved={savedItem => {
                    const savedPlantId = savedItem?.plant_id ??
                        savedItem?.plantId ??
                        careSheetPlant?.id
                    if (savedPlantId === null || savedPlantId === undefined) {
                        void loadLatestCare()
                        return
                    }
                    if (!savedItem || typeof savedItem !== 'object') {
                        void loadLatestCare()
                        return
                    }
                    setLatestCare(current => ({
                        ...current,
                        [savedPlantId]: savedItem
                    }))
                }}
            />
        </main>
    )
}

export default MyPlant
