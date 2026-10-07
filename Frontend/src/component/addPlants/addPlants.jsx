import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './addPlants.css'
import './dark-theme.css'
import './adaptiv.css'
import camera from '../../assets/camera.svg'
import leaf from '../../assets/leaf.svg'
import sparkles from '../../assets/sparkles.svg'
import plus from '../../assets/plus.svg'
import minus from '../../assets/minus.svg'
import { API_URL } from '../../utils/api.js'

const MAX_PHOTOS = 2

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

const getReminderWeekdays = (intervalDays, startDate = new Date()) => {
    const weekdays = new Set()
    let weekday = startDate.getDay()

    while (!weekdays.has(weekday)) {
        weekdays.add(weekday)
        weekday = (weekday + intervalDays) % 7
    }

    return [...weekdays]
}

function AddPlants() {
    const navigate = useNavigate()
    const [previews, setPreviews] = useState([])
    const filesRef = useRef([])
    const urlsRef = useRef([])
    const timeoutRef = useRef(null)

    const [step, setStep] = useState(1)
    const [leaving, setLeaving] = useState(null)
    const [days, setDays] = useState(7)
    const [selectedPreset, setSelectedPreset] = useState('custom')
    const [selectedWatering, setSelectedWatering] = useState('morning')
    const [selectedDays, setSelectedDays] = useState(() => getReminderWeekdays(7))
    const [notifyMorning, setNotifyMorning] = useState(true)
    const [notifyDayBefore, setNotifyDayBefore] = useState(false)
    const [name, setName] = useState('')
    const [species, setSpecies] = useState('')
    const [isSuggestingSpecies, setIsSuggestingSpecies] = useState(false)
    const [speciesSuggestionError, setSpeciesSuggestionError] = useState('')
    const [isWateringDialogOpen, setIsWateringDialogOpen] = useState(false)
    const [wateringAnswers, setWateringAnswers] = useState([])
    const [wateringMessages, setWateringMessages] = useState([])
    const [wateringAnswer, setWateringAnswer] = useState('')
    const [wateringRecommendation, setWateringRecommendation] = useState(null)
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

    const goToStep = (next) => {
        setLeaving(step)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
            setStep(next)
            setLeaving(null)
            window.scrollTo({ top: 0, behavior: 'smooth' })
        }, 350)
    }

    const goNextFromStep1 = () => {
        if (!name.trim()) {
            setSubmitError('Введите название растения')
            return
        }
        if (name.trim().length > 255) {
            setSubmitError('Название должно содержать не более 255 символов')
            return
        }
        setSubmitError('')
        goToStep(2)
    }

    const handleSuggestSpecies = async () => {
        const plantName = name.trim()
        if (!plantName || isSuggestingSpecies) return

        setIsSuggestingSpecies(true)
        setSpeciesSuggestionError('')
        try {
            const response = await fetch(`${API_URL}/plants/suggest-species`, {
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
            setSpeciesSuggestionError(error.message || 'Не удалось определить вид растения')
        } finally {
            setIsSuggestingSpecies(false)
        }
    }

    const requestWateringAdvice = async (answers, sessionId) => {
        setIsAskingWateringAdvice(true)
        setWateringAdviceError('')
        try {
            const response = await fetch(`${API_URL}/plants/watering-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: name.trim(),
                    species: species.trim(),
                    answers
                })
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || 'Не удалось получить рекомендацию')
            }
            if (wateringDialogSessionRef.current !== sessionId) return

            if (data.type === 'question' && typeof data.question === 'string') {
                setWateringMessages(messages => [...messages, {
                    role: 'assistant',
                    text: data.question
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
            setWateringAdviceError(error.message || 'Не удалось получить рекомендацию')
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
            const response = await fetch(`${API_URL}/plants/watering-time-advice`, {
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
            setWateringTimeAdviceError(error.message || 'Не удалось подобрать время полива')
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

    const submitWateringAnswer = event => {
        event.preventDefault()
        const answer = wateringAnswer.trim()
        const lastQuestion = [...wateringMessages].reverse().find(
            message => message.role === 'assistant'
        )?.text
        if (!answer || !lastQuestion || isAskingWateringAdvice) return

        const nextAnswers = [...wateringAnswers, {
            question: lastQuestion,
            answer
        }]
        const sessionId = wateringDialogSessionRef.current
        setWateringAnswers(nextAnswers)
        setWateringMessages(messages => [...messages, { role: 'user', text: answer }])
        setWateringAnswer('')
        setWateringAdviceError('')
        requestWateringAdvice(nextAnswers, sessionId)
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
    const addPlant = async (event) => {
        event.preventDefault()
        if (isSubmitting) return

        if (!name.trim()) {
            setSubmitError('Введите название растения')
            return
        }
        if (name.trim().length > 255) {
            setSubmitError('Название должно содержать не более 255 символов')
            return
        }

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
                    reminder_weekdays: selectedDays
                }),
                credentials: 'include'
            })

            const responseData = await response.json().catch(() => ({}))

            if (response.ok) {
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
                <form onSubmit={addPlant}>
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
                                    type="text"
                                    placeholder='Монстера Анна'
                                    maxLength={255}
                                    aria-label="Название растения"
                                    disabled={isSuggestingSpecies}
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value)
                                        setSubmitError('')
                                    }}
                                    required
                                />
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
                                            <p>Поливать каждые {days} дней</p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button type='button' className='counterBtn' onClick={dec} aria-label="Уменьшить">
                                                <img src={minus} alt="" aria-hidden="true" />
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
                                Дни выбраны по частоте полива. При необходимости измените их вручную.
                            </p>
                            <div className='buttonHoldWeekday'>
                                {WEEKDAY.map(w => (
                                    <button
                                        key={w.id}
                                        type='button'
                                        className={`wateringWeekday ${selectedDays.includes(w.id) ? 'active' : ''}`}
                                        onClick={() => toggleDay(w.id)}
                                        aria-pressed={selectedDays.includes(w.id)}
                                    >
                                        {w.label}
                                    </button>
                                ))}
                            </div>
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
                                    {' · полив каждые '}{days}{' дн.'}
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
                                                    ? 'высокая'
                                                    : wateringRecommendation.confidence === 'medium'
                                                        ? 'средняя'
                                                        : 'низкая'
                                            }. Проверяйте, просох ли грунт, и корректируйте график.
                                        </p>
                                        <button
                                            type='button'
                                            className='wateringRecommendationApply'
                                            onClick={applyWateringRecommendation}
                                        >
                                            Применить интервал
                                        </button>
                                    </div>
                                )}
                                <div ref={wateringMessagesEndRef} />
                            </div>
                            {wateringAdviceError && (
                                <div className='wateringAdviceError' role='alert'>
                                    <p>{wateringAdviceError}</p>
                                    <button
                                        type='button'
                                        onClick={() => requestWateringAdvice(wateringAnswers, wateringDialogSessionRef.current)}
                                        disabled={isAskingWateringAdvice}
                                    >
                                        Попробовать ещё раз
                                    </button>
                                </div>
                            )}
                            {!wateringRecommendation && (
                                <form className='wateringAdviceReply' onSubmit={submitWateringAnswer}>
                                    <label htmlFor='wateringAdviceAnswer'>
                                        {wateringAnswers.length >= 4
                                            ? 'Получаем осторожную рекомендацию'
                                            : 'Ваш ответ'}
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
                                            wateringAnswers.length >= 4 ||
                                            !wateringMessages.some(message => message.role === 'assistant')
                                        }
                                    />
                                    <div className='wateringAdviceFooter'>
                                        <span>{wateringAnswers.length}/4 уточнений</span>
                                        <button
                                            type='submit'
                                            disabled={
                                                !wateringAnswer.trim() ||
                                                isAskingWateringAdvice ||
                                                Boolean(wateringAdviceError) ||
                                                wateringAnswers.length >= 4
                                            }
                                        >
                                            Ответить
                                        </button>
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