import { Link } from 'react-router-dom'
import PlantPhoto from '../PlantPhoto/PlantPhoto'

function FirstDayCard ({ plantName, photoUrl, facts, onDismiss }) {
  if (!Array.isArray(facts) || facts.length === 0) return null

  return (
    <section className='firstDayCard' aria-labelledby='firstDayTitle'>
      <header className='firstDayHeader'>
        <div className='firstDayHeading'>
          <p className='firstDayEyebrow'>Первый день</p>
          <h2 id='firstDayTitle'>{plantName}</h2>
        </div>
        <button
          type='button'
          className='firstDayDismiss'
          onClick={onDismiss}
          aria-label='Скрыть блок «Первый день»'
        >
          <span aria-hidden='true'>×</span>
        </button>
      </header>

      <div className='firstDayBody'>
        {photoUrl ? (
          <PlantPhoto src={photoUrl} alt={plantName} />
        ) : (
          <span className='firstDayPhotoFallback' aria-hidden='true' />
        )}
        <ul className='firstDayFacts'>
          {facts.map(fact => (
            <li key={fact.id} className='firstDayFact'>
              <span className='firstDayFactTitle'>{fact.title}</span>
              <span className='firstDayFactText'>{fact.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link to='/my-plants' className='firstDayLink'>
        Открыть карточку растения
      </Link>
    </section>
  )
}

export default FirstDayCard
