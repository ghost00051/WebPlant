import { Link } from 'react-router-dom'
import checkIcon from '../../assets/check.svg'
import './onboarding.css'
import './dark-theme.css'

function stepStatusLabel(step) {
  if (step.status === 'done') return 'Готово'
  if (step.status === 'current') return 'Сейчас'
  if (step.status === 'unavailable') return 'Недоступно'
  return 'Дальше'
}

function QuickAddPlantCard({ plant, busy, disabled, onCreate }) {
  return (
    <li className='onboardingPlantItem'>
      <button
        type='button'
        className={`onboardingPlantCard${busy ? ' is-busy' : ''}`}
        onClick={() => onCreate(plant)}
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-label={`Добавить «${plant.name}» — полив раз в ${plant.intervalDays} дней`}
      >
        <span className='onboardingPlantPhoto' aria-hidden='true'>
          {plant.image ? (
            <img src={plant.image} alt='' loading='lazy' decoding='async' />
          ) : (
            <span className='onboardingPlantPhotoFallback'>🌱</span>
          )}
        </span>
        <span className='onboardingPlantName'>{plant.name}</span>
        <span className='onboardingPlantMeta'>
          {plant.intervalLabel || `Полив раз в ${plant.intervalDays} дней`}
        </span>
        <span className='onboardingPlantCta'>
          {busy ? 'Добавляем…' : '+ Добавить'}
        </span>
      </button>
    </li>
  )
}

export function FirstPlantQuickAdd({ plants, creatingSlug, error, onCreate }) {
  const items = Array.isArray(plants) ? plants : []
  const isCreating = Boolean(creatingSlug)

  return (
    <section className='onboardingQuickAdd' aria-labelledby='onboardingQuickAddTitle'>
      <div className='onboardingQuickAddHeader'>
        <p className='onboardingEyebrow'>Первый шаг</p>
        <h2 id='onboardingQuickAddTitle'>Добавьте первое растение за 2 тапа</h2>
        <p className='onboardingLead'>
          Выберите популярное растение — интервал полива и расписание настроятся
          сами. Один тап на карточку сразу создаёт растение.
        </p>
      </div>

      {error && (
        <p className='onboardingError' role='alert'>
          {error}
        </p>
      )}

      {items.length > 0 ? (
        <ul className='onboardingPlantGrid' aria-label='Популярные растения'>
          {items.map(plant => (
            <QuickAddPlantCard
              key={plant.slug}
              plant={plant}
              busy={creatingSlug === plant.slug}
              disabled={isCreating}
              onCreate={onCreate}
            />
          ))}
        </ul>
      ) : (
        <p className='onboardingLead' role='status'>
          Подборка популярных растений недоступна. Добавьте растение вручную.
        </p>
      )}

      <div className='onboardingQuickAddFooter'>
        <span>Нужно другое растение или есть фото?</span>
        <Link to='/add-plant' className='onboardingManualLink'>
          Добавить вручную
        </Link>
      </div>
    </section>
  )
}

export function OnboardingChecklist({ checklist, onAction, onDismiss, notice = '' }) {
  if (!checklist || !Array.isArray(checklist.steps)) return null

  return (
    <section className='onboardingChecklist' aria-labelledby='onboardingChecklistTitle'>
      <div className='onboardingChecklistHeader'>
        <div className='onboardingChecklistHeading'>
          <p className='onboardingEyebrow'>Первый цикл ухода</p>
          <h2 id='onboardingChecklistTitle'>Растение, напоминание, первый полив</h2>
          <p className='onboardingChecklistProgress'>
            Готово {checklist.completedCount} из {checklist.totalCount} шагов
          </p>
        </div>
        {typeof onDismiss === 'function' && (
          <button
            type='button'
            className='onboardingChecklistDismiss'
            onClick={onDismiss}
            aria-label='Скрыть чек-лист первого цикла'
          >
            <span aria-hidden='true'>×</span>
          </button>
        )}
      </div>

      <ol className='onboardingChecklistSteps'>
        {checklist.steps.map((step, index) => (
          <li
            key={step.id}
            className={`onboardingStep is-${step.status}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className='onboardingStepMark' aria-hidden='true'>
              {step.status === 'done' ? (
                <img src={checkIcon} alt='' />
              ) : (
                index + 1
              )}
            </span>
            <span className='onboardingStepBody'>
              <span className='onboardingStepTitle'>{step.title}</span>
              {step.description && (
                <span className='onboardingStepDescription'>{step.description}</span>
              )}
            </span>
            <span className='onboardingStepSide'>
              <span className='onboardingStepStatus'>{stepStatusLabel(step)}</span>
              {step.action && typeof onAction === 'function' && (
                <button
                  type='button'
                  className='onboardingStepAction'
                  onClick={() => onAction(step.action.type)}
                >
                  {step.action.label}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>

      {notice && (
        <p className='onboardingNotice' role='status'>
          {notice}
        </p>
      )}
    </section>
  )
}

export default FirstPlantQuickAdd
