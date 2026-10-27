import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './MultiAddPlants.css'
import check from '../../assets/check.svg'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { reminderWeekdaysForInterval } from '../../utils/date.js'
import { guidePlants } from '../../utils/plantConditions.js'
import { trackEvent } from '../../utils/productEvents.js'

const PLURAL_FORMS = ['растение', 'растения', 'растений']

function plural(count, forms) {
    const value = Math.abs(Number(count))
    if (!Number.isFinite(value)) return forms[2]
    const mod10 = value % 10
    const mod100 = value % 100
    if (mod10 === 1 && mod100 !== 11) return forms[0]
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
    return forms[2]
}

function plantsWord(count) {
    return plural(count, PLURAL_FORMS)
}

async function createPlantFromGuide(plant) {
    const intervalDays = plant.intervalDays
    const response = await fetchWithTimeout(`${API_URL}/plants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            name: plant.name,
            species: plant.species,
            watering_interval_days: intervalDays,
            watering_time_of_day: 'morning',
            notify_morning: true,
            notify_day_before: false,
            reminder_weekdays: reminderWeekdaysForInterval(intervalDays)
        })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.message || `HTTP ${response.status}`)
    }
    return data
}

function MultiAddDialog({ onClose }) {
    const navigate = useNavigate()
    const plants = useMemo(() => guidePlants(), [])
    const [selected, setSelected] = useState([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [progress, setProgress] = useState({ done: 0, total: 0 })
    const [failures, setFailures] = useState([])
    const [submitError, setSubmitError] = useState('')
    const dialogRef = useRef(null)
    const previousFocusRef = useRef(null)
    const closeButtonRef = useRef(null)

    useEffect(() => {
        previousFocusRef.current = typeof document === 'undefined' ? null : document.activeElement
        const frame = window.requestAnimationFrame(() => {
            closeButtonRef.current?.focus({ preventScroll: true })
        })
        return () => window.cancelAnimationFrame(frame)
    }, [])

    const handleClose = useCallback(() => {
        if (isSubmitting) return
        const previous = previousFocusRef.current
        previousFocusRef.current = null
        onClose?.()
        if (previous && typeof previous.focus === 'function') {
            window.requestAnimationFrame(() => previous.focus({ preventScroll: true }))
        }
    }, [isSubmitting, onClose])

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault()
                handleClose()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleClose])

    const togglePlant = slug => {
        setSubmitError('')
        setFailures([])
        setSelected(current =>
            current.includes(slug)
                ? current.filter(value => value !== slug)
                : [...current, slug]
        )
    }

    const handleSubmit = async () => {
        if (isSubmitting || !selected.length) return

        const chosen = plants.filter(plant => selected.includes(plant.slug))
        setIsSubmitting(true)
        setSubmitError('')
        setFailures([])
        setProgress({ done: 0, total: chosen.length })

        const failed = []
        let created = 0

        for (const plant of chosen) {
            try {
                await createPlantFromGuide(plant)
                created += 1
            } catch (error) {
                console.error('Ошибка добавления растения из справочника:', error)
                failed.push(plant.name)
            }
            setProgress(current => ({ ...current, done: current.done + 1 }))
        }

        setIsSubmitting(false)

        if (!created) {
            setFailures(failed)
            setSubmitError('Не удалось добавить растения. Проверьте подключение и попробуйте ещё раз.')
            return
        }

        trackEvent('plant_created', {
            hasPhoto: false,
            hasSpecies: true,
            intervalDays: chosen[0]?.intervalDays ?? 0,
            bulkCount: created
        })

        onClose?.()
        navigate('/my-plants', {
            replace: true,
            state: { addedPlants: created, addedPlantsFailed: failed }
        })
    }

    const total = selected.length
    const progressLabel = isSubmitting
        ? `Добавляем ${Math.min(progress.done + 1, progress.total)} из ${progress.total}…`
        : ''

    return (
        <div
            className='multiAddOverlay'
            onMouseDown={event => {
                if (event.target === event.currentTarget) handleClose()
            }}
        >
            <section
                className='multiAddDialog'
                role='dialog'
                aria-modal='true'
                aria-labelledby='multiAddTitle'
                aria-describedby='multiAddDescription'
                ref={dialogRef}
                tabIndex={-1}
            >
                <header className='multiAddHeader'>
                    <div>
                        <h2 id='multiAddTitle'>Добавить сразу несколько</h2>
                        <p id='multiAddDescription'>
                            Отметьте растения из справочника — интервал полива подставим готовый,
                            потом его можно поправить в карточке.
                        </p>
                    </div>
                    <button
                        type='button'
                        ref={closeButtonRef}
                        className='multiAddClose'
                        onClick={handleClose}
                        disabled={isSubmitting}
                        aria-label='Закрыть добавление нескольких растений'
                    >
                        ×
                    </button>
                </header>

                <ul className='multiAddList' aria-label='Растения из справочника'>
                    {plants.map(plant => {
                        const isSelected = selected.includes(plant.slug)
                        return (
                            <li key={plant.slug}>
                                <label className={`multiAddItem ${isSelected ? 'isSelected' : ''}`}>
                                    <input
                                        type='checkbox'
                                        checked={isSelected}
                                        disabled={isSubmitting}
                                        onChange={() => togglePlant(plant.slug)}
                                    />
                                    <span className='multiAddItemText'>
                                        <span className='multiAddItemName'>{plant.name}</span>
                                        <span className='multiAddItemLatin'>{plant.latin}</span>
                                        <span className='multiAddItemInterval'>
                                            {plant.intervalLabel || `полив каждые ${plant.intervalDays} дн.`}
                                        </span>
                                    </span>
                                    <span className='multiAddItemCheck' aria-hidden='true'>
                                        <img src={check} alt='' />
                                    </span>
                                </label>
                            </li>
                        )
                    })}
                </ul>

                {isSubmitting && (
                    <p className='multiAddProgress' role='status' aria-live='polite'>{progressLabel}</p>
                )}
                {submitError && <p className='multiAddError' role='alert'>{submitError}</p>}
                {failures.length > 0 && (
                    <p className='multiAddError'>
                        Не добавлены: {failures.join(', ')}. Попробуйте добавить их отдельно.
                    </p>
                )}

                <footer className='multiAddActions'>
                    <p className='multiAddCount'>
                        {total > 0
                            ? `Выбрано: ${total} ${plantsWord(total)}`
                            : 'Пока ничего не выбрано'}
                    </p>
                    <div>
                        <button
                            type='button'
                            className='multiAddCancel'
                            onClick={handleClose}
                            disabled={isSubmitting}
                        >
                            Отмена
                        </button>
                        <button
                            type='button'
                            className='multiAddSubmit'
                            onClick={handleSubmit}
                            disabled={isSubmitting || total === 0}
                        >
                            {isSubmitting
                                ? 'Добавляем…'
                                : total > 0
                                    ? `Добавить ${total} ${plantsWord(total)}`
                                    : 'Добавить'}
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    )
}

function MultiAddPlants({ open, onClose }) {
    if (!open) return null
    return <MultiAddDialog onClose={onClose} />
}

export default MultiAddPlants
