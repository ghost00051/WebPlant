import { useEffect, useState } from 'react'
import EmptyIcon from '../../assets/EmptyIcon.svg'
import chevronRight from '../../assets/chevron-right.svg'
import plantPlaceholder from '../../assets/PlantTile.svg'
import './visionNextPlant.css'
import './adaptiv.css'
import './dark-theme.css'
import IconCircle from '../../assets/IconCircle.svg'

function pluralizePlants(n) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'растений'
  if (last === 1) return 'растение'
  if (last >= 2 && last <= 4) return 'растения'
  return 'растений'
}

function pluralizeDays(n) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'дней'
  if (last === 1) return 'день'
  if (last >= 2 && last <= 4) return 'дня'
  return 'дней'
}

function getWateringTime(timeOfDay) {
  switch (timeOfDay) {
    case 'morning': return '9:00'
    case 'day': return '14:00'
    case 'evening': return '19:00'
    default: return null
  }
}

function getPastTime(iso) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getPlantPhoto(plant) {
  if (plant?.photo_url) return plant.photo_url
  if (Array.isArray(plant?.photos) && plant.photos.length > 0) {
    const first = plant.photos[0]
    return typeof first === 'string' ? first : first?.url
  }
  return plantPlaceholder
}

function formatWateringCycle(days) {
  if (!days || days <= 0) return null
  if (days === 1) return 'Ежедневно'
  return `каждые ${days} ${pluralizeDays(days)}`
}

function VisionNextPlant({
  active,
  day,
  nextWatering,
  onGoToDate,
  onDeleteWatering,
  deletingWateringId,
  onClose
}) {
  useEffect(() => {
    document.body.classList.toggle('vision-open', active)
    return () => document.body.classList.remove('vision-open')
  }, [active])

  const [deleteTarget, setDeleteTarget] = useState(null)

  const kind = day?.kind ?? 'empty'

  const isFuture = kind === 'future'
  const isPast = kind === 'past'
  const isEmpty = kind === 'empty'

  const futureCount = day?.plants?.length ?? 0
  const pastEvents = day?.events ?? []

  const localEvents = day?.events ?? []
  const wateredEvents = localEvents.filter(e => e.kind === 'watered')
  const overdueEvents = localEvents.filter(e => e.kind === 'overdue')

  let counterLabel = ''
  if (isFuture) {
    counterLabel = futureCount === 1
      ? '1 растение ждёт полива'
      : `${futureCount} ${pluralizePlants(futureCount)} ждут полива`
  } else if (isPast) {
    const parts = []
    if (wateredEvents.length) {
      parts.push(
        wateredEvents.length === 1
          ? '1 полито'
          : `${wateredEvents.length} полито`
      )
    }
    if (overdueEvents.length) {
      parts.push(
        overdueEvents.length === 1
          ? '1 пропущено'
          : `${overdueEvents.length} пропущено`
      )
    }
    counterLabel = parts.join(' · ') || 'Событий нет'
  }

  useEffect(() => {
    if (!deleteTarget) return undefined

    const handleKeyDown = event => {
      if (event.key === 'Escape' && !deletingWateringId) {
        setDeleteTarget(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [deleteTarget, deletingWateringId])

  const handleNextClick = () => {
    if (!nextWatering?.iso) return
    onGoToDate?.(nextWatering.iso)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deletingWateringId) return

    const wasDeleted = await onDeleteWatering?.(
      deleteTarget.plantId,
      deleteTarget.wateringLogId
    )
    if (wasDeleted !== false) setDeleteTarget(null)
  }

  const handleOverlayClick = () => {
    if (deleteTarget) {
      if (!deletingWateringId) setDeleteTarget(null)
      return
    }
    setDeleteTarget(null)
    onClose?.()
  }

  const renderPlantRow = (plant, {
    variant,
    timeLabel,
    key,
    wateringLogId
  }) => {
    const isOverdue = variant === 'overdue'
    const isWatered = variant === 'watered'
    const isFutureRow = variant === 'future'

    return (
      <li key={key} className='plantsPreview__item' >
        <div className='plantsPreview__photoWrap'>
          <div>
            <img
              src={getPlantPhoto(plant)}
              alt={plant.name}
              className='plantsPreview__photo'
              loading='lazy'
              decoding='async'
              onError={e => { e.currentTarget.src = plantPlaceholder }}
            />
          </div>
          <div>
            <span className='plantsPreview__name'>{plant.name}</span>
            <div className='descriptionOfplantsPreview__name'>
              {isWatered && (
                <>
                  <p>Полито</p>
                  {plant.species && <p>{plant.species}</p>}
                </>
              )}
              {isOverdue && (
                <>
                  <p className='descriptionOfplantsPreview__name--overdue'>
                    Пропущено
                  </p>
                  {plant.species && <p>{plant.species}</p>}
                </>
              )}
              {isFutureRow && (
                <>
                  <p>Цикл:</p>
                  <p>{formatWateringCycle(plant.watering_interval_days)}</p>
                  {/* <span />
                  <p>{plant.species}</p> */}
                </>
              )}
            </div>
          </div>
        </div>
        <div className='plantsPreview__actions'>
          <p
            className={[
              'classOfgetWateringTime',
              isWatered && 'classOfgetWateringTime--past',
              isOverdue && 'classOfgetWateringTime--overdue',
            ].filter(Boolean).join(' ')}
          >
            {timeLabel}
          </p>
          {isWatered && Number.isInteger(wateringLogId) && (
            <button
              type='button'
              className='plantsPreview__delete'
              aria-label={`Удалить запись о поливе растения «${plant.name}»`}
              onClick={() => setDeleteTarget({
                plantId: plant.id,
                wateringLogId,
                plantName: plant.name
              })}
            >
              Удалить
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div
      className={`vision-overlay ${active ? 'is-active' : ''}`}
      onClick={handleOverlayClick}
    >
      <div
        className={`visiibleVareingPlant ${active ? 'active' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className='childOfBlockvisiibleVareingPlant'>
          <div>
            <span />
          </div>
          <div>
            <div>
              {day ? (
                <>
                  <p className='selectDayCheck'>{day.full}</p>
                  <div className='selectDayHeader'>
                    <p className='selectDayRelative'>{day.relative}</p>
                    <span />
                    {isEmpty ? (
                      <p className='selectDayPlants selectDayPlants--empty'>
                        Событий нет
                      </p>
                    ) : isPast ? (
                      <p className='selectDayPlants selectDayPlants--past'>
                        {counterLabel}
                      </p>
                    ) : (
                      <p className='selectDayPlants'>{counterLabel}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className='selectDayCheck'>Выберите день</p>
              )}
            </div>

            {day && isEmpty && (
              <div className='selectDayEmpty'>
                <img
                  src={EmptyIcon}
                  alt=''
                  className='headerImgOfselectDayEmpty'
                />
                <p className='headerselectDayEmpty'>
                  В этот день ничего не произошло
                </p>
                <p>
                  Здесь появятся поливы и добавленные растения. Можно добавить
                  запись вручную или посмотреть другую дату.
                </p>
                {nextWatering && (
                  <button
                    type='button'
                    className='selectDayEmptyNext'
                    onClick={handleNextClick}
                  >
                    <div>
                      <p className='selectDayEmptyNext__label'>
                        Ближайший полив:
                      </p>
                      <p className='selectDayEmptyNext__date'>
                        {nextWatering.label}
                      </p>
                    </div>
                    <img src={chevronRight} alt='' />
                  </button>
                )}
              </div>
            )}

            {day && isFuture && futureCount > 0 && (
              <ul className='plantsPreview'>
                {day.plants.map(p => renderPlantRow(p, {
                  variant: 'future',
                  timeLabel: getWateringTime(p.watering_time_of_day),
                  key: p.id,
                }))}
              </ul>
            )}

            {day && isPast && pastEvents.length > 0 && (
              <ul className='plantsPreview'>
                {overdueEvents.map((ev, i) => renderPlantRow(ev.plant, {
                  variant: 'overdue',
                  timeLabel: ev.days_late > 0
                    ? `${ev.days_late} ${pluralizeDays(ev.days_late)}`
                    : '—',
                  key: `overdue-${ev.plant.id}-${i}`,
                }))}
                {wateredEvents.map((ev, i) => renderPlantRow(ev.plant, {
                  variant: 'watered',
                  timeLabel: getPastTime(ev.watered_at),
                  wateringLogId: ev.id,
                  key: `watered-${ev.plant.id}-${i}`,
                }))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {deleteTarget && (
        <div className='wateringDeleteDialog' onClick={event => event.stopPropagation()}>
          <section
            className='wateringDeleteDialog__card'
            role='dialog'
            aria-modal='true'
            aria-labelledby='watering-delete-title'
            aria-describedby='watering-delete-description'
          >
            <img src={IconCircle} alt='' className='wateringDeleteDialog__icon' />
            <h2 id='watering-delete-title'>Удалить запись о поливе?</h2>
            <p id='watering-delete-description'>
              Полив растения «{deleteTarget.plantName}» будет удалён. Это действие нельзя отменить. Полив будет удален.
            </p>
            <div className='wateringDeleteDialog__actions'>
              <button
                type='button'
                className='wateringDeleteDialog__cancel'
                disabled={Boolean(deletingWateringId)}
                onClick={() => setDeleteTarget(null)}
              >
                Отмена
              </button>
              <button
                type='button'
                className='wateringDeleteDialog__confirm'
                disabled={Boolean(deletingWateringId)}
                onClick={handleConfirmDelete}
              >
                {deletingWateringId ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default VisionNextPlant