import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import PlantPhoto from '../PlantPhoto/PlantPhoto'
import { buildPlantDaySheetTitle } from '../../utils/plantDayTasks.js'

function PlantDaySheet ({
  open,
  plant,
  iso = '',
  photoUrl,
  tasks = [],
  waterBusy = false,
  busyKey = '',
  notice = '',
  onClose,
  onWater,
  onWaterLater,
  onMarkCare,
  onOpenCareSheet
}) {
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined

    const previouslyFocused = document.activeElement
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus?.())

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = bodyOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open || !plant) return null

  const name = plant.name || 'Растение'
  const title = buildPlantDaySheetTitle(plant)
  const hasTasks = Array.isArray(tasks) && tasks.length > 0
  const careBusyId = busyKey

  return (
    <div
      className='plantDaySheetOverlay'
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <section
        className='plantDaySheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='plantDaySheetTitle'
        aria-describedby='plantDaySheetSubtitle'
      >
        <header className='plantDaySheetHeader'>
          <div className='plantDaySheetHeading'>
            {photoUrl ? (
              <PlantPhoto src={photoUrl} alt={name} />
            ) : (
              <span className='plantDaySheetPhotoFallback' aria-hidden='true' />
            )}
            <div>
              <p className='plantDaySheetEyebrow'>Задачи на сегодня</p>
              <h2 id='plantDaySheetTitle'>{title}</h2>
              <p id='plantDaySheetSubtitle' className='plantDaySheetSubtitle'>
                Полив и уход в одном списке — отмечайте в один тап.
              </p>
            </div>
          </div>
          <button
            type='button'
            ref={closeRef}
            className='plantDaySheetClose'
            onClick={onClose}
            aria-label='Закрыть задачи растения'
          >
            <span aria-hidden='true'>×</span>
          </button>
        </header>

        {hasTasks ? (
          <ul className='plantDaySheetTasks' aria-label={`Задачи: ${name}`}>
            {tasks.map(task => {
              const isWater = task.kind === 'water'
              const careId = `${plant.id}:${task.actionCode}:${iso}`
              const busy = isWater ? waterBusy : careBusyId === careId
              const disabled = isWater ? waterBusy : Boolean(busyKey)

              return (
                <li key={`${task.kind}-${task.actionCode}-${task.scheduledFor || iso}`} className='plantDayTask'>
                  <div className='plantDayTaskText'>
                    <p className='plantDayTaskTitle'>{task.title}</p>
                    <p className='plantDayTaskDescription'>{task.description}</p>
                  </div>
                  <button
                    type='button'
                    className='plantDayTaskAction'
                    onClick={() => {
                      if (isWater) {
                        if (task.scheduledFor) onWaterLater(plant.id, task.scheduledFor)
                        else onWater(plant.id)
                        return
                      }
                      if (task.actionCode === 'fertilize') {
                        onOpenCareSheet(plant.id, 'fertilize')
                        return
                      }
                      onMarkCare(task)
                    }}
                    disabled={disabled}
                    aria-busy={busy || undefined}
                  >
                    {busy
                      ? 'Отмечаем…'
                      : isWater
                        ? task.scheduledFor
                          ? 'Полил(а) позже'
                          : 'Полить'
                        : task.actionCode === 'fertilize'
                          ? 'Записать'
                          : 'Отметить'}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className='plantDaySheetEmpty' role='status'>
            На сегодня задач нет. Можно добавить уход вручную.
          </p>
        )}

        {notice && (
          <p className='plantDaySheetNotice' role='status' aria-live='polite'>
            {notice}
          </p>
        )}

        <div className='plantDaySheetFooter'>
          <button
            type='button'
            className='plantDaySheetMore'
            onClick={() => onOpenCareSheet(plant.id, 'leaf_clean')}
          >
            Другой уход
          </button>
          <Link to='/my-plants' className='plantDaySheetLink'>
            Открыть растение
          </Link>
        </div>
      </section>
    </div>
  )
}

export default PlantDaySheet
