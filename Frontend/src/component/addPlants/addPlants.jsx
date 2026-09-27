import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './addPlants.css'
import './adaptiv.css'
import camera from '../../assets/camera.svg'
import leaf from '../../assets/leaf.svg'
import sparkles from '../../assets/sparkles.svg'
import plus from '../../assets/plus.svg'
import minus from '../../assets/minus.svg'

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
    { id: 'mon', label: 'Пн' },
    { id: 'tue', label: 'Вт' },
    { id: 'wed', label: 'Ср' },
    { id: 'thu', label: 'Чт' },
    { id: 'fri', label: 'Пт' },
    { id: 'sat', label: 'Сб' },
    { id: 'sun', label: 'Вс' },
]

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
    const [selectedDays, setSelectedDays] = useState([])
    const [notifyMorning, setNotifyMorning] = useState(true)
    const [notifyDayBefore, setNotifyDayBefore] = useState(false)
    const [name, setName] = useState('')
    const [species, setSpecies] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [toast, setToast] = useState(null)
    const [toastLeaving, setToastLeaving] = useState(false)
    const toastTimerRef = useRef(null)
    const navigateTimerRef = useRef(null)

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

    const dec = () => {
        setSelectedPreset('custom')
        setDays(d => Math.max(1, d - 1))
    }

    const inc = () => {
        setSelectedPreset('custom')
        setDays(d => d + 1)
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
            alert('Введите название растения')
            return
        }
        goToStep(2)
    }

    const handleFileChange = (e) => {
        const newFiles = Array.from(e.target.files)
        if (!newFiles.length) return

        const freeSlots = MAX_PHOTOS - filesRef.current.length
        if (freeSlots <= 0) {
            e.target.value = ''
            return
        }

        const toAdd = newFiles.slice(0, freeSlots)
        const newUrls = toAdd.map(file => URL.createObjectURL(file))

        filesRef.current = [...filesRef.current, ...toAdd]
        urlsRef.current = [...urlsRef.current, ...newUrls]
        setPreviews([...urlsRef.current])

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
            alert('Введите название растения')
            return
        }

        setIsSubmitting(true)

        try {
            let uploadedUrls = []
            if (filesRef.current.length > 0) {
                const formData = new FormData()
                filesRef.current.forEach(file => formData.append('photos', file))

                const uploadRes = await fetch('https://server.checktheplants.ru/api/upload', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                })

                if (!uploadRes.ok) throw new Error('Не удалось загрузить фото')
                const uploadData = await uploadRes.json()
                uploadedUrls = Array.isArray(uploadData.urls) ? uploadData.urls : []
            }

            const response = await fetch('https://server.checktheplants.ru/api/plants', {
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

            let responseData = null
            try {
                responseData = await response.json()
            } catch {
                responseData = null
            }

            if (response.ok) {
                urlsRef.current.forEach(url => URL.revokeObjectURL(url))
                urlsRef.current = []
                filesRef.current = []

                setToast({
                    title: 'Растение добавлено',
                    subtitle: name.trim(),
                })

                navigateTimerRef.current = setTimeout(() => {
                    navigate('/home')
                }, 1600)
            } else {
                alert(responseData?.message || 'Не удалось сохранить растение')
            }
        } catch (error) {
            console.error('Add plant error:', error)
            alert('Ошибка при сохранении. Попробуйте ещё раз.')
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
                                        accept="image/*"
                                        multiple
                                        className="addPhotoPlantInput"
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
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                            <div className='speciesName'>
                                <div>
                                    <p>Вид растения</p>
                                    <div>
                                        <img src={sparkles} alt="" aria-hidden="true" />
                                        <button type="button">Спросить у ИИ</button>
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    placeholder='Monstera deliciosa'
                                    value={species}
                                    onChange={(e) => setSpecies(e.target.value)}
                                />
                            </div>
                            <div className='popularTypes'>
                                <p>Популярные виды — подставим уход автоматически</p>
                                <div>
                                    <button type="button">Монстера</button>
                                    <button type="button">Фикус</button>
                                    <button type="button">Суккулент</button>
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
                                        <div className='askAI'>
                                            <img src={sparkles} alt="" aria-hidden="true" />
                                            <button type="button">Спросить у ИИ</button>
                                        </div>
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
                                                    setDays(p.days)
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
                                        <div className='askAI'>
                                            <img src={sparkles} alt="" aria-hidden="true" />
                                            <button type="button">Спросить у ИИ</button>
                                        </div>
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
                                    <p className='commentOfPreset'>Утром вода усваивается лучше, вечером — меньше испаряется</p>
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
                                <div className='askAI'>
                                    <img src={sparkles} alt="" aria-hidden="true" />
                                    <button type="button">Спросить у ИИ</button>
                                </div>
                            </div>
                            <div className='godblocksOfNotification'>
                                <div className='blocksOfNotification'>
                                    <p>Утреннее напоминание</p>
                                    <p>Каждый день в 9:00</p>
                                </div>
                                <label className="apple-switch">
                                    <input
                                        type="checkbox"
                                        checked={notifyMorning}
                                        onChange={(e) => setNotifyMorning(e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            <div className='godblocksOfNotification'>
                                <div className='blocksOfNotification'>
                                    <p>Напоминать за день</p>
                                    <p>Вечером в 19:00</p>
                                </div>
                                <label className="apple-switch">
                                    <input
                                        type="checkbox"
                                        checked={notifyDayBefore}
                                        onChange={(e) => setNotifyDayBefore(e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className='buttonHoldWeekday'>
                                {WEEKDAY.map(w => (
                                    <button
                                        key={w.id}
                                        type='button'
                                        className={`wateringWeekday ${selectedDays.includes(w.id) ? 'active' : ''}`}
                                        onClick={() => toggleDay(w.id)}
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
                </form>
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
                            ×
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AddPlants