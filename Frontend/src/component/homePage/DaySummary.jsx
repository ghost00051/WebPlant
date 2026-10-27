import droplets from '../../assets/droplets.svg'

function DaySummary ({ title, summaryText, hint, busy, disabled, onWaterAll }) {
  return (
    <section
      className='daySummary'
      aria-labelledby='homeDaySummaryTitle'
      aria-busy={busy || undefined}
    >
      <span className='daySummaryIcon' aria-hidden='true'>
        <img src={droplets} alt='' />
      </span>
      <div className='daySummaryText'>
        <h2 id='homeDaySummaryTitle'>{title}</h2>
        <p>{summaryText}</p>
        {hint && <p className='daySummaryHint'>{hint}</p>}
      </div>
      <button
        type='button'
        className='daySummaryButton'
        onClick={onWaterAll}
        disabled={busy || disabled}
        aria-busy={busy || undefined}
        aria-label={busy ? 'Отмечаем полив' : 'Полить все растения из сводки дня'}
      >
        {busy ? 'Поливаем…' : 'Полить'}
      </button>
    </section>
  )
}

export default DaySummary
