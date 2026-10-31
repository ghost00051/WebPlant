import { Link } from 'react-router-dom'
import PlantPhoto from '../PlantPhoto/PlantPhoto'
import droplets from '../../assets/droplets.svg'

function MissedWateringCard ({
  plant,
  dueLabel,
  scheduledFor,
  daysLate,
  photoUrl,
  busy,
  onWaterLater
}) {
  const name = plant?.name || 'Растение'
  const question = dueLabel
    ? `Полив ${dueLabel} не отмечен — он ещё нужен?`
    : 'Полив не отмечен — он ещё нужен?'

  return (
    <article className='missedCard'>
      <Link
        to='/my-plants'
        className='missedCardLink'
        aria-label={`Открыть «${name}» в списке растений`}
      >
        {photoUrl ? (
          <PlantPhoto src={photoUrl} alt={name} />
        ) : (
          <span className='missedCardPhotoFallback' aria-hidden='true' />
        )}
        <span className='missedCardText'>
          <span className='missedCardName'>{name}</span>
          <span className='missedCardQuestion'>{question}</span>
          {daysLate > 0 && (
            <span className='missedCardBadge'>
              <img src={droplets} alt='' />
              Просрочен на {daysLate} {daysLate === 1 ? 'день' : daysLate < 5 ? 'дня' : 'дней'}
            </span>
          )}
        </span>
      </Link>
      <div className='missedCardActions'>
        <button
          type='button'
          className='missedCardWaterLater'
          onClick={() => onWaterLater(plant.id, scheduledFor)}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label={`Отметить, что «${name}» полит позже графика`}
        >
          {busy ? 'Отмечаем…' : 'Полил(а) позже'}
        </button>
      </div>
    </article>
  )
}

export default MissedWateringCard
