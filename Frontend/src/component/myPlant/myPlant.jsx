import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackBtn from '../../assets/BackBtn.svg'
import './myPlant.css'
import './dark-theme.css'
import search from '../../assets/search.svg'
import xcircle from '../../assets/x-circle.svg'
import { API_URL } from '../../utils/api.js'

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

async function readResponse(response) {
    return response.json().catch(() => ({}))
}

function MyPlant() {
    const navigate = useNavigate()
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

    const getAllPlant = useCallback(async () => {
        setIsLoading(true)
        setListError('')
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
            setListError('Не удалось загрузить растения. Проверьте подключение и попробуйте ещё раз.')
        } finally {
            setIsLoading(false)
        }
    }, [navigate])

    useEffect(() => {
        const loadPlants = async () => getAllPlant()
        loadPlants()
    }, [getAllPlant])

    useEffect(() => {
        if (!editingPlant && !deleteTarget) return undefined

        const handleKeyDown = event => {
            if (event.key === 'Escape' && !isSaving && !isDeleting) {
                setEditingPlant(null)
                setEditError('')
                setDeleteTarget(null)
                setDeleteError('')
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [editingPlant, deleteTarget, isSaving, isDeleting])

    const openEditor = selectedPlant => {
        setEditingPlant(selectedPlant)
        setEditForm({
            name: selectedPlant.name ?? '',
            species: selectedPlant.species ?? '',
            watering_interval_days: String(selectedPlant.watering_interval_days || 7),
            watering_time_of_day: selectedPlant.watering_time_of_day || 'morning',
            notify_morning: selectedPlant.notify_morning !== false,
            notify_day_before: selectedPlant.notify_day_before === true,
            reminder_weekdays: Array.isArray(selectedPlant.reminder_weekdays)
                ? selectedPlant.reminder_weekdays
                : []
        })
        setEditError('')
    }

    const closeEditor = () => {
        if (isSaving) return
        setEditingPlant(null)
        setEditForm(null)
        setEditError('')
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

        setIsSaving(true)
        setEditError('')
        try {
            const response = await fetch(`${API_URL}/plants/${editingPlant.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: editForm.name.trim(),
                    species: editForm.species.trim() || null,
                    watering_interval_days: intervalDays,
                    watering_time_of_day: editForm.watering_time_of_day,
                    notify_morning: editForm.notify_morning,
                    notify_day_before: editForm.notify_day_before,
                    reminder_weekdays: editForm.reminder_weekdays
                })
            })
            const data = await readResponse(response)
            if (!response.ok) {
                throw new Error(data.message || `Не удалось сохранить изменения: HTTP ${response.status}`)
            }

            setPlant(current =>
                current.map(item => item.id === data.id ? data : item)
            )
            setEditingPlant(null)
            setEditForm(null)
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
        setEditForm(current => ({
            ...current,
            reminder_weekdays: current.reminder_weekdays.includes(day)
                ? current.reminder_weekdays.filter(value => value !== day)
                : [...current.reminder_weekdays, day]
        }))
    }

    const filteredPlants = plant.filter(item =>
        item.name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )

    return (
        <main className='gofOfMyplants'>
            <header className='headerOfPlants'>
                <button
                    type='button'
                    className='myPlantsBackButton'
                    onClick={() => navigate(-1)}
                    aria-label='Назад'
                >
                    <img src={BackBtn} alt='' />
                </button>
                <h1>Мои растения</h1>
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

            {listError && (
                <div className='plantListMessage' role='alert'>
                    <p>{listError}</p>
                    <button type='button' onClick={getAllPlant}>Попробовать ещё раз</button>
                </div>
            )}
            {isLoading && <p className='plantListMessage' role='status'>Загружаем растения…</p>}
            {!isLoading && !listError && plant.length === 0 && (
                <div className='plantListMessage'>
                    <p>Пока здесь нет растений.</p>
                    <button type='button' onClick={() => navigate('/add-plant')}>
                        Добавить растение
                    </button>
                </div>
            )}

            {!isLoading && !listError && plant.length > 0 && (
                <div className='gridBlocksOfPlant'>
                    {filteredPlants.map(item => (
                        <article key={item.id} className='plantRenderOfPants'>
                            <p>{item.name}</p>
                            <p>{item.species || 'Вид не указан'}</p>
                            <div className='buttonEditPlants'>
                                <button type='button' onClick={() => openEditor(item)}>
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
                    ))}
                    {filteredPlants.length === 0 && (
                        <p className='plantListMessage' role='status'>
                            По запросу «{searchQuery}» ничего не найдено.
                        </p>
                    )}
                </div>
            )}

            {editingPlant && editForm && (
                <div
                    className='plantDialogOverlay'
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeEditor()
                    }}
                >
                    <section
                        className='plantDialog'
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
                                    autoFocus
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
                            <div className='plantEditorFields'>
                                <label>
                                    Интервал, дней
                                    <input
                                        type='number'
                                        min='1'
                                        max='365'
                                        step='1'
                                        value={editForm.watering_interval_days}
                                        onChange={event => setEditForm(current => ({
                                            ...current,
                                            watering_interval_days: event.target.value
                                        }))}
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
                                    {WEEKDAYS.map(day => (
                                        <button
                                            key={day.id}
                                            type='button'
                                            className={editForm.reminder_weekdays.includes(day.id) ? 'active' : ''}
                                            aria-pressed={editForm.reminder_weekdays.includes(day.id)}
                                            onClick={() => toggleReminderWeekday(day.id)}
                                        >
                                            {day.label}
                                        </button>
                                    ))}
                                </div>
                                <small>Если не выбирать дни, напоминания будут приходить по графику.</small>
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
        </main>
    )
}

export default MyPlant
