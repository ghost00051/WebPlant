import { useEffect } from 'react'
import EmptyIcon from '../../assets/EmptyIcon.svg'
import chevronRight from '../../assets/chevron-right.svg'
import plantPlaceholder from '../../assets/PlantTile.svg'
import PlantDot from '../../assets/PlanDot.svg'
import './visionNextPlant.css'

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

function VisionNextPlant({ active, day, nextWatering, onGoToDate, onClose }) {
  useEffect(() => {
    document.body.classList.toggle('vision-open', active)
    return () => document.body.classList.remove('vision-open')
  }, [active])

  const kind = day?.kind ?? 'empty'
  const plantsCount = day?.plants?.length ?? 0

  const showFuture = kind === 'future'
  const showPast = kind === 'past'
  const showEmpty = kind === 'empty'

  const plantsLabel = showPast
    ? (plantsCount === 1
      ? '1 растение полито'
      : `${plantsCount} ${pluralizePlants(plantsCount)} политы`)
    : (plantsCount === 1
      ? '1 растение ждёт полива'
      : `${plantsCount} ${pluralizePlants(plantsCount)} ждут полива`)

  const handleNextClick = () => {
    if (!nextWatering?.iso) return
    onGoToDate?.(nextWatering.iso)
  }

  return (
    <div
      className={`vision-overlay ${active ? 'is-active' : ''}`}
      onClick={onClose}
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
                    {showEmpty ? (
                      <p className='selectDayPlants selectDayPlants--empty'>
                        Событий нет
                      </p>
                    ) : showPast ? (
                      <p className='selectDayPlants selectDayPlants--past'>
                        {plantsLabel}
                      </p>
                    ) : (
                      <p className='selectDayPlants'>{plantsLabel}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className='selectDayCheck'>Выберите день</p>
              )}
            </div>

            {day && showEmpty && (
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
            {day && (showFuture || showPast) && (
              <ul className='plantsPreview'>
                {day.plants.map(p => {
                  const timeLabel = showPast
                    ? getPastTime(p.watered_at)
                    : getWateringTime(p.watering_time_of_day)

                  return (
                    <li key={p.id} className='plantsPreview__item'>
                      <div className='plantsPreview__photoWrap'>
                        <div>
                          <img
                            src={getPlantPhoto(p)}
                            alt={p.name}
                            className='plantsPreview__photo'
                            onError={e => { e.currentTarget.src = plantPlaceholder }}
                          />
                        </div>
                        <div>
                          <span className='plantsPreview__name'>{p.name}</span>
                          <div className='descriptionOfplantsPreview__name'>
                            {showPast ? (
                              <>
                                <p>Полито</p>
                                <p>{p.species}</p>
                              </>
                            ) : (
                              <>
                                <p>Цикл:</p>
                                <p>{formatWateringCycle(p.watering_interval_days)}</p>
                                <span />
                                <p>{p.species}</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div>
                          <p
                            className={`classOfgetWateringTime ${showPast ? 'classOfgetWateringTime--past' : ''
                              }`}
                          >
                            {timeLabel}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div />
        </div>
      </div>
    </div>
  )
}

export default VisionNextPlant