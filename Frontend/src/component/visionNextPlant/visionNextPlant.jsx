import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import EmptyIcon from '../../assets/EmptyIcon.svg'
import chevronRight from '../../assets/chevron-right.svg'
import plantPlaceholder from '../../assets/PlantTile.svg'
import './visionNextPlant.css'
import './adaptiv.css'
import './dark-theme.css'
import IconCircle from '../../assets/IconCircle.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import PlantPhoto from '../PlantPhoto/PlantPhoto'
import {
  careEventSummary,
  careGroupFor,
  careTitleFor
} from '../../utils/careEvents.js'

const CARE_GROUP_ICONS = {
  feed: '🌱',
  spray: '💦',
  other: '🍃'
}

function careIconFor (actionCode) {
  return CARE_GROUP_ICONS[careGroupFor(actionCode)] ?? '🍃'
}

function careGroupClass (actionCode) {
  return careGroupFor(actionCode) ?? 'other'
}

function pluralizeCare (n) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'уходов'
  if (last === 1) return 'уход'
  if (last >= 2 && last <= 4) return 'ухода'
  return 'уходов'
}

function getCareTimeLabel (event) {
  const raw = event?.done_at ?? event?.created_at ?? event?.performed_at
  if (typeof raw !== 'string' || !raw.includes('T')) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return getPastTime(date)
}

function pluralizePlants (n) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'растений'
  if (last === 1) return 'растение'
  if (last >= 2 && last <= 4) return 'растения'
  return 'растений'
}

function pluralizeDays (n) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'дней'
  if (last === 1) return 'день'
  if (last >= 2 && last <= 4) return 'дня'
  return 'дней'
}

function getWateringTime (timeOfDay) {
  switch (timeOfDay) {
    case 'morning':
      return '9:00'
    case 'day':
      return '14:00'
    case 'evening':
      return '19:00'
    default:
      return null
  }
}

function getPastTime (iso) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getPlantPhoto (plant) {
  if (plant?.photo_url) return plant.photo_url
  if (Array.isArray(plant?.photos) && plant.photos.length > 0) {
    const first = plant.photos[0]
    return typeof first === 'string' ? first : first?.url
  }
  return plantPlaceholder
}

function formatWateringCycle (days) {
  if (!days || days <= 0) return null
  if (days === 1) return 'Ежедневно'
  return `каждые ${days} ${pluralizeDays(days)}`
}

function getMissedTimeLabel (event) {
  if (Number.isFinite(event?.days_late) && event.days_late > 0) {
    return `${event.days_late} ${pluralizeDays(event.days_late)}`
  }
  if (Number.isFinite(event?.hours_late) && event.hours_late > 0) {
    return `${event.hours_late} ч`
  }
  if (event?.scheduled_for) {
    return getPastTime(event.scheduled_for)
  }
  return '—'
}

function VisionNextPlant ({
  active,
  day,
  nextWatering,
  onGoToDate,
  onWater,
  onDeleteWatering,
  onDeleteCareAction,
  wateringPlantId,
  deletingWateringId,
  onClose
}) {
  useEffect(() => {
    document.body.classList.toggle('vision-open', active)
    return () => document.body.classList.remove('vision-open')
  }, [active])

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [waterError, setWaterError] = useState(null)
  const [careBusyId, setCareBusyId] = useState(null)
  const [careError, setCareError] = useState(null)
  const kind = day?.kind ?? 'empty'

  const isPast = kind === 'past'
  const isEmpty = kind === 'empty'

  const pendingPlants = day?.plants ?? []
  const localEvents = day?.events ?? []
  const wateredEvents = localEvents.filter(e => e.kind === 'watered')
  const overdueEvents = localEvents.filter(e => e.kind === 'overdue')
  const skippedEvents = localEvents.filter(e => e.kind === 'skipped')
  const careEvents = localEvents.filter(e => e.kind === 'care')
  const pendingCount = pendingPlants.length
  const hasRows = pendingCount > 0 || localEvents.length > 0

  const dayIso = day?.iso ?? null
  const waterErrorMessage =
    waterError && waterError.iso === dayIso ? waterError.message : ''
  const careErrorMessage =
    careError && careError.iso === dayIso ? careError.message : ''

  const handleWaterPlant = async (plantId, scheduledFor) => {
    if (!plantId || wateringPlantId) return

    setWaterError(null)
    try {
      const result = await onWater?.(plantId, scheduledFor)
      if (result && result.ok === false && result.message) {
        setWaterError({ iso: dayIso, message: result.message })
      }
    } catch (error) {
      console.error('Ошибка отметки просроченного полива:', error)
      setWaterError({
        iso: dayIso,
        message: 'Не удалось отметить полив. Попробуйте ещё раз.'
      })
    }
  }

  const handleCancelCare = async event => {
    const logId = event?.log_id ?? event?.id
    const plantId = event?.plant?.id
    if (logId === null || logId === undefined) return
    if (plantId === null || plantId === undefined) return
    if (careBusyId !== null) return

    setCareError(null)
    setCareBusyId(logId)
    try {
      const result = await onDeleteCareAction?.(plantId, logId)
      if (result && result.ok === false) {
        setCareError({
          iso: dayIso,
          message:
            result.message || 'Не удалось отменить действие ухода. Попробуйте ещё раз.'
        })
      }
    } catch (error) {
      console.error('Ошибка отмены действия ухода:', error)
      setCareError({
        iso: dayIso,
        message: 'Не удалось отменить действие ухода. Попробуйте ещё раз.'
      })
    } finally {
      setCareBusyId(null)
    }
  }

  const counterParts = []
  if (wateredEvents.length) {
    counterParts.push(
      wateredEvents.length === 1
        ? '1 полито'
        : `${wateredEvents.length} полито`
    )
  }
  if (overdueEvents.length) {
    counterParts.push(
      overdueEvents.length === 1
        ? '1 просрочено'
        : `${overdueEvents.length} просрочено`
    )
  }
  if (skippedEvents.length) {
    counterParts.push(
      skippedEvents.length === 1
        ? '1 пропущено'
        : `${skippedEvents.length} пропущено`
    )
  }
  if (careEvents.length) {
    counterParts.push(
      `${careEvents.length} ${pluralizeCare(careEvents.length)}`
    )
  }
  if (pendingCount) {
    counterParts.push(
      pendingCount === 1
        ? '1 растение ждёт полива'
        : `${pendingCount} ${pluralizePlants(pendingCount)} ждут полива`
    )
  }

  const counterLabel = counterParts.join(' · ')

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

  const renderPlantRow = (
    plant,
    { variant, timeLabel, scheduledFor, key, wateringLogId }
  ) => {
    const isOverdue = variant === 'overdue'
    const isSkipped = variant === 'skipped'
    const isWatered = variant === 'watered'
    const isFutureRow = variant === 'future'
    const isMissed = isOverdue || isSkipped
    const isWatering = wateringPlantId === plant.id

    return (
      <li key={key} className='plantsPreview__item'>
        <div className='plantsPreview__photoWrap'>
          <div>
            <PlantPhoto
              src={getPlantPhoto(plant)}
              alt={plant.name}
              className='plantsPreview__photo'
              loading='lazy'
              decoding='async'
            />
          </div>
          <div>
            <span className='plantsPreview__name'>{plant.name}</span>
            <div className='descriptionOfplantsPreview__name'>
              {isWatered && (
                <>
                  <p>Полито</p>
                </>
              )}
              {isMissed && (
                <>
                  <p className='descriptionOfplantsPreview__name--overdue'>
                    {isSkipped ? 'Пропущено' : 'Просрочено'}
                  </p>
                  {plant.species && <p>{plant.species}</p>}
                </>
              )}
              {isFutureRow && (
                <>
                  <p>Цикл:</p>
                  <p>{formatWateringCycle(plant.watering_interval_days)}</p>
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
              isMissed && 'classOfgetWateringTime--overdue'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {timeLabel}
          </p>
          {isMissed && (
            <button
              type='button'
              className='plantsPreview__water'
              disabled={Boolean(wateringPlantId)}
              aria-busy={isWatering}
              aria-label={`Отметить полив растения «${plant.name}»`}
              onClick={() => handleWaterPlant(plant.id, scheduledFor)}
            >
              {isWatering && (
                <span className='plantsPreview__waterSpinner' aria-hidden='true' />
              )}
              {isWatering ? 'Поливаем…' : 'Полить'}
            </button>
          )}
          {isWatered && Number.isInteger(wateringLogId) && (
            <button
              type='button'
              className='plantsPreview__delete'
              aria-label={`Удалить запись о поливе растения «${plant.name}»`}
              onClick={() =>
                setDeleteTarget({
                  plantId: plant.id,
                  wateringLogId,
                  plantName: plant.name
                })
              }
            >
              Удалить
            </button>
          )}
        </div>
      </li>
    )
  }

  const renderCareRow = (event, index) => {
    const plant = event?.plant ?? null
    const actionCode = event?.action_code ?? event?.actionCode
    const group = careGroupClass(actionCode)
    const title = event?.title || careTitleFor(actionCode) || 'Уход'
    const summary = careEventSummary(event)
    const timeLabel = getCareTimeLabel(event)
    const logId = event?.log_id ?? event?.id ?? null
    const plantName = plant?.name ?? 'Растение'
    const isBusy = careBusyId !== null && careBusyId === logId

    return (
      <li
        key={`care-${logId ?? index}`}
        className='plantsPreview__item plantsPreview__item--care'
      >
        <div className='plantsPreview__photoWrap'>
          <div>
            <span
              className={`careRowIcon careRowIcon--${group}`}
              aria-hidden='true'
            >
              {careIconFor(actionCode)}
            </span>
          </div>
          <div className='careRowText'>
            <span className='careRowTitle'>{title}</span>
            <p className='careRowMeta'>{plantName}</p>
            {summary && <p className='careRowMeta'>{summary}</p>}
          </div>
        </div>
        <div className='plantsPreview__actions'>
          {timeLabel && (
            <p className='classOfgetWateringTime classOfgetWateringTime--care'>
              {timeLabel}
            </p>
          )}
          {logId !== null && (
            <button
              type='button'
              className='plantsPreview__delete'
              disabled={careBusyId !== null}
              aria-busy={isBusy}
              aria-label={`Отменить ${title.toLowerCase()} растения «${plantName}»`}
              onClick={() => handleCancelCare(event)}
            >
              {isBusy ? 'Отменяем…' : 'Отменить'}
            </button>
          )}
        </div>
      </li>
    )
  }

  return createPortal(
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
            {waterErrorMessage && (
              <p className='wateringNote wateringNote--error' role='alert'>
                {waterErrorMessage}
              </p>
            )}
            {careErrorMessage && (
              <p className='wateringNote wateringNote--error' role='alert'>
                {careErrorMessage}
              </p>
            )}
            {day && isEmpty && (
              <div className='selectDayEmpty'>
                <ThemedIcon
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
            {day && hasRows && (
              <ul className='plantsPreview'>
                {overdueEvents.map((ev, i) =>
                  renderPlantRow(ev.plant, {
                    variant: 'overdue',
                    timeLabel: getMissedTimeLabel(ev),
                    scheduledFor: ev.scheduled_for ?? day.iso,
                    key: `overdue-${ev.plant.id}-${i}`
                  })
                )}
                {skippedEvents.map((ev, i) =>
                  renderPlantRow(ev.plant, {
                    variant: 'skipped',
                    timeLabel: getMissedTimeLabel(ev),
                    scheduledFor: ev.scheduled_for ?? day.iso,
                    key: `skipped-${ev.plant.id}-${i}`
                  })
                )}
                {pendingPlants.map(p =>
                  renderPlantRow(p, {
                    variant: 'future',
                    timeLabel: getWateringTime(p.watering_time_of_day),
                    key: `plan-${p.id}`
                  })
                )}
                {wateredEvents.map((ev, i) =>
                  renderPlantRow(ev.plant, {
                    variant: 'watered',
                    timeLabel: getPastTime(ev.watered_at),
                    wateringLogId: ev.id,
                    key: `watered-${ev.plant.id}-${i}`
                  })
                )}
                {careEvents.map((ev, i) => renderCareRow(ev, i))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {deleteTarget && (
        <div
          className='wateringDeleteDialog'
          onClick={event => event.stopPropagation()}
        >
          <section
            className='wateringDeleteDialog__card'
            role='dialog'
            aria-modal='true'
            aria-labelledby='watering-delete-title'
            aria-describedby='watering-delete-description'
          >
            <ThemedIcon
              src={IconCircle}
              alt=''
              className='wateringDeleteDialog__icon'
            />
            <h2 id='watering-delete-title'>Удалить запись о поливе?</h2>
            <p id='watering-delete-description'>
              Полив растения «{deleteTarget.plantName}» будет удалён. Это
              действие нельзя отменить. Полив будет удален.
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
    </div>,
    document.body
  )
}

export default VisionNextPlant
