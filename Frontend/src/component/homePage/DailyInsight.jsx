import sparkles from '../../assets/sparkles.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'

export function InsightButton ({ hasNews, expanded, className = '', onClick }) {
  return (
    <button
      type='button'
      className={`insightButton${expanded ? ' is-open' : ''}${
        className ? ` ${className}` : ''
      }`}
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls='homeInsightPanel'
      aria-label={
        hasNews
          ? 'Что нового: есть совет на сегодня'
          : 'Что нового: советы по вашим растениям'
      }
    >
      <ThemedIcon src={sparkles} alt='' />
      <span className='insightButtonLabel'>Что нового</span>
      {hasNews && <span className='insightBadge' aria-hidden='true' />}
    </button>
  )
}

export function InsightPanel ({ insight, onClose }) {
  if (!insight || !Array.isArray(insight.items) || insight.items.length === 0) {
    return null
  }

  return (
    <section
      className='homeInsightPanel'
      id='homeInsightPanel'
      role='region'
      aria-labelledby='homeInsightTitle'
    >
      <header className='homeInsightHeader'>
        <div>
          <p className='homeInsightEyebrow'>Совет дня</p>
          <h2 id='homeInsightTitle'>{insight.title}</h2>
        </div>
        <div className='homeInsightHeaderSide'>
          {insight.dateLabel && (
            <time className='homeInsightDate'>{insight.dateLabel}</time>
          )}
          <button
            type='button'
            className='homeInsightClose'
            onClick={onClose}
            aria-label='Закрыть советы дня'
          >
            <span aria-hidden='true'>×</span>
          </button>
        </div>
      </header>
      <ul className='homeInsightList'>
        {insight.items.map(item => (
          <li key={item.id} className='homeInsightItem'>
            <span className='homeInsightItemTitle'>{item.title}</span>
            <span className='homeInsightItemText'>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
