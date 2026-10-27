import CalendarIcon from '../../assets/CalendarIcon.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { pluralRu } from '../../utils/weekSummary.js'

function WeekSummary ({ summary, loading, error }) {
  const hasPlan = Boolean(summary && summary.total > 0)
  const stats = summary
    ? [
        {
          id: 'waterings',
          value: summary.waterings,
          label: pluralRu(summary.waterings, ['полив', 'полива', 'поливов'])
        },
        {
          id: 'feedings',
          value: summary.feedings,
          label: pluralRu(summary.feedings, ['подкормка', 'подкормки', 'подкормок'])
        },
        {
          id: 'inspections',
          value: summary.inspections,
          label: pluralRu(summary.inspections, ['осмотр', 'осмотра', 'осмотров'])
        }
      ]
    : []

  return (
    <section className='weekSummaryCard' aria-labelledby='weekSummaryTitle' aria-busy={loading || undefined}>
      <header className='weekSummaryHeader'>
        <div>
          <h2 id='weekSummaryTitle'>На неделю</h2>
          {summary?.dateLabel && (
            <p className='weekSummaryDates'>{summary.dateLabel}</p>
          )}
        </div>
        <ThemedIcon className='weekSummaryIcon' src={CalendarIcon} alt='' />
      </header>

      {loading ? (
        <p className='weekSummaryStatus' role='status'>Считаем неделю…</p>
      ) : error ? (
        <p className='weekSummaryStatus' role='status'>
          Не удалось посчитать задачи. Обновите страницу.
        </p>
      ) : hasPlan ? (
        <>
          <ul
            className='weekSummaryStats'
            aria-label={summary.summaryText}
          >
            {stats.map(item => (
              <li key={item.id} className='weekSummaryStat'>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          {summary.extraText && (
            <p className='weekSummaryExtra'>{summary.extraText}</p>
          )}
        </>
      ) : (
        <p className='weekSummaryStatus'>
          Планов нет — просто наблюдайте за растениями и проверяйте грунт.
        </p>
      )}
    </section>
  )
}

export default WeekSummary
