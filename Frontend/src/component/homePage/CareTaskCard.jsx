import { useState } from 'react'
import { PRODUCT_SUGGESTIONS } from '../../utils/careActionForm.js'

function CareTaskCard ({ item, busy, onMark, onOpenSheet }) {
  const [product, setProduct] = useState('')
  const [dose, setDose] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const needsProduct = item.action_code === 'fertilize'
  const plantName = item.plant_name || 'Растение'
  const title = item.title || 'Уход'

  const submit = event => {
    if (event) event.preventDefault()
    if (busy) return
    if (needsProduct && !product.trim()) return
    onMark(item, { product, dose })
  }

  return (
    <li className='careTaskCard'>
      <div className='careTaskMain'>
        <p className='careTaskTitle'>{title}</p>
        <p className='careTaskMeta'>{plantName} · сегодня</p>
      </div>

      <div className='careTaskActions'>
        <button
          type='button'
          className='careTaskSheetButton'
          onClick={() => onOpenSheet(item)}
          aria-label={`Все задачи на сегодня: «${plantName}»`}
        >
          Уход
        </button>

        {needsProduct && formOpen ? (
          <form className='careTaskForm' onSubmit={submit}>
            <label className='careTaskField'>
              Чем подкармливали
              <input
                type='text'
                value={product}
                maxLength={160}
                onChange={event => setProduct(event.target.value)}
                placeholder='Например, Покон'
                disabled={busy}
              />
            </label>
            <div className='careTaskChips' role='group' aria-label='Популярные средства'>
              {PRODUCT_SUGGESTIONS.map(name => (
                <button
                  key={name}
                  type='button'
                  className={product === name ? 'is-active' : ''}
                  onClick={() => setProduct(name)}
                  disabled={busy}
                >
                  {name}
                </button>
              ))}
            </div>
            <label className='careTaskField'>
              Дозировка
              <input
                type='text'
                value={dose}
                maxLength={120}
                onChange={event => setDose(event.target.value)}
                placeholder='Например, 1 колпачок на 1 л'
                disabled={busy}
              />
            </label>
            <div className='careTaskFormActions'>
              <button
                type='button'
                className='careTaskCancel'
                onClick={() => setFormOpen(false)}
                disabled={busy}
              >
                Отмена
              </button>
              <button
                type='submit'
                className='careTaskMark'
                disabled={busy || !product.trim()}
                aria-busy={busy || undefined}
              >
                {busy ? 'Сохраняем…' : 'Отметить'}
              </button>
            </div>
          </form>
        ) : (
          <button
            type='button'
            className='careTaskMark'
            onClick={needsProduct ? () => setFormOpen(true) : submit}
            disabled={busy}
            aria-busy={busy || undefined}
            aria-label={
              needsProduct
                ? `Записать подкормку: «${plantName}»`
                : `Отметить «${title}»: «${plantName}»`
            }
          >
            {busy ? 'Отмечаем…' : 'Отметить'}
          </button>
        )}
      </div>
    </li>
  )
}

export default CareTaskCard
