import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../../utils/api.js'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js'
import { CARE_ACTION_CODES } from '../../utils/careEvents.js'
import {
  OTHER_CARE_ACTIONS,
  PRODUCT_SUGGESTIONS,
  buildCareActionPayload,
  buildPerformedAt,
  careActionTabs,
  careDateValue,
  recentProductsFromLatest
} from '../../utils/careActionForm.js'
import './careActions.css'
import './dark-theme.css'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function mergeSuggestions(recentProducts) {
  const seen = new Set()
  const result = []
  for (const name of [...recentProducts, ...PRODUCT_SUGGESTIONS]) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

function CareActionSheet({
  open,
  plantId = null,
  plants = null,
  initialAction = 'fertilize',
  notificationId = null,
  onClose,
  onSaved
}) {
  const navigate = useNavigate()
  const [loadedPlants, setLoadedPlants] = useState(null)
  const [plantsLoading, setPlantsLoading] = useState(false)
  const [plantsError, setPlantsError] = useState('')
  const [plantsRetry, setPlantsRetry] = useState(0)
  const [recentProducts, setRecentProducts] = useState([])
  const [selectedPlantId, setSelectedPlantId] = useState('')
  const [tab, setTab] = useState('fertilize')
  const [otherCode, setOtherCode] = useState('leaf_clean')
  const [product, setProduct] = useState('')
  const [dose, setDose] = useState('')
  const [note, setNote] = useState('')
  const [methodBottle, setMethodBottle] = useState(false)
  const [dateValue, setDateValue] = useState(() => careDateValue(new Date()))
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const sheetRef = useRef(null)
  const plantSelectRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const isSavingRef = useRef(false)
  const wasOpenRef = useRef(false)

  const effectivePlants = Array.isArray(plants) ? plants : loadedPlants

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    isSavingRef.current = isSaving
  }, [isSaving])

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true

    const requested = CARE_ACTION_CODES.includes(initialAction) ? initialAction : 'fertilize'
    setTab(requested === 'fertilize' || requested === 'spray' ? requested : 'other')
    setOtherCode(requested === 'fertilize' || requested === 'spray' ? 'leaf_clean' : requested)
    setProduct('')
    setDose('')
    setNote('')
    setMethodBottle(false)
    setDateValue(careDateValue(new Date()))
    setError('')
    setIsSaving(false)
    setRecentProducts([])
    setSelectedPlantId(plantId !== null && plantId !== undefined ? String(plantId) : '')
  }, [open, initialAction, plantId])

  useEffect(() => {
    if (!open || Array.isArray(plants)) return undefined
    let cancelled = false

    const run = async () => {
      setPlantsLoading(true)
      setPlantsError('')
      try {
        const response = await fetchWithTimeout(`${API_URL}/plants`, {
          method: 'GET',
          credentials: 'include'
        })
        if (response.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json().catch(() => ({}))
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : null
        if (!list) throw new Error('Сервер вернул некорректный список растений')
        if (!cancelled) setLoadedPlants(list)
      } catch (loadError) {
        if (cancelled) return
        console.warn('Не удалось загрузить растения для отметки ухода:', loadError)
        setPlantsError('Не удалось загрузить растения. Попробуйте ещё раз.')
      } finally {
        if (!cancelled) setPlantsLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open, plants, plantsRetry, navigate])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false

    const run = async () => {
      try {
        const response = await fetchWithTimeout(`${API_URL}/plants/care-actions/latest`, {
          method: 'GET',
          credentials: 'include'
        })
        if (!response.ok) return
        const data = await response.json().catch(() => ({}))
        if (!cancelled) setRecentProducts(recentProductsFromLatest(data?.items))
      } catch (latestError) {
        console.warn('Не удалось загрузить последние средства ухода:', latestError)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open])

  const suggestions = useMemo(
    () => mergeSuggestions(recentProducts),
    [recentProducts]
  )

  const availablePlants = useMemo(
    () => (Array.isArray(effectivePlants) ? effectivePlants : []),
    [effectivePlants]
  )

  const activePlantId = useMemo(() => {
    const hasPlant = id => availablePlants.some(item => String(item?.id) === id)
    if (selectedPlantId && hasPlant(selectedPlantId)) return selectedPlantId
    const requestedId = plantId !== null && plantId !== undefined ? String(plantId) : ''
    if (requestedId && hasPlant(requestedId)) return requestedId
    return availablePlants.length > 0 ? String(availablePlants[0]?.id ?? '') : ''
  }, [availablePlants, plantId, selectedPlantId])

  useEffect(() => {
    if (!open) return undefined

    const previouslyFocused = document.activeElement
    const container = sheetRef.current
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const getFocusable = () =>
      Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) ?? [])
        .filter(element => element.offsetParent !== null)

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!isSavingRef.current) onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return

      const items = getFocusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const frame = window.requestAnimationFrame(() => {
      const target = plantSelectRef.current ?? getFocusable()[0]
      target?.focus?.()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = bodyOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  const handleClose = useCallback(() => {
    if (isSavingRef.current) return
    onCloseRef.current?.()
  }, [])

  const handleSubmit = async event => {
    event.preventDefault()
    if (isSaving) return

    const actionCode = tab === 'other' ? otherCode : tab
    const result = buildCareActionPayload({
      actionCode,
      plantId: activePlantId,
      product,
      dose,
      note,
      method: methodBottle ? 'spray_bottle' : null,
      performedAt: buildPerformedAt(dateValue),
      notificationId
    })

    if (!result.ok) {
      setError(result.error)
      return
    }

    setError('')
    setIsSaving(true)
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/plants/${result.value.plant_id}/care-actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(result.value)
        }
      )

      if (response.status === 401) {
        navigate('/login', { replace: true })
        return
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          throw new Error('Отметка ухода пока недоступна. Попробуйте позже.')
        }
        throw new Error(data.message || `Не удалось сохранить уход: HTTP ${response.status}`)
      }

      const savedItem = data?.item ?? data?.value ?? null
      onSaved?.(savedItem)
      onCloseRef.current?.()
    } catch (saveError) {
      console.error('Ошибка отметки ухода:', saveError)
      setError(saveError.message || 'Не удалось сохранить уход. Проверьте подключение.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!open) return null

  const title = tab === 'fertilize' ? 'Чем подкармливала' : 'Чем опрыскивали'
  const showProductFields = tab !== 'other'
  const plantsBusy = plantsLoading ||
    (!Array.isArray(plants) && loadedPlants === null && !plantsError)

  return (
    <div
      className='careSheetOverlay'
      onMouseDown={event => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <section
        className='careSheet'
        ref={sheetRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='careSheetTitle'
        aria-busy={isSaving || plantsBusy || undefined}
      >
        <header className='careSheetHeader'>
          <div className='careSheetHeading'>
            <h2 id='careSheetTitle'>Отметить уход</h2>
            <p>Запишем уход в историю растения — напоминания обновятся.</p>
          </div>
          <button
            type='button'
            className='careSheetClose'
            onClick={handleClose}
            disabled={isSaving}
            aria-label='Закрыть'
          >
            ×
          </button>
        </header>

        {plantsBusy && (
          <p className='careSheetStatus' role='status'>Загружаем растения…</p>
        )}

        {!plantsBusy && plantsError && (
          <div className='careSheetStatus' role='alert'>
            <p>{plantsError}</p>
            <button type='button' onClick={() => setPlantsRetry(value => value + 1)}>
              Повторить
            </button>
          </div>
        )}

        {!plantsBusy && !plantsError && availablePlants.length === 0 && (
          <div className='careSheetEmpty'>
            <p>Сначала добавьте растение</p>
            <Link to='/add-plant' onClick={handleClose}>Добавить растение</Link>
          </div>
        )}

        {!plantsBusy && !plantsError && availablePlants.length > 0 && (
          <form className='careSheetForm' onSubmit={handleSubmit} noValidate>
            <label className='careSheetField'>
              Растение
              <select
                ref={plantSelectRef}
                value={activePlantId}
                onChange={event => setSelectedPlantId(event.target.value)}
                disabled={isSaving}
                required
              >
                {availablePlants.map(item => (
                  <option key={item?.id} value={item?.id}>
                    {item?.name || `Растение #${item?.id}`}
                  </option>
                ))}
              </select>
            </label>

            <div className='careSheetTabs' role='tablist' aria-label='Тип ухода'>
              {careActionTabs.map(item => (
                <button
                  key={item.id}
                  type='button'
                  role='tab'
                  aria-selected={tab === item.id}
                  className={tab === item.id ? 'is-active' : ''}
                  onClick={() => setTab(item.id)}
                  disabled={isSaving}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'other' && (
              <label className='careSheetField'>
                Вид ухода
                <select
                  value={otherCode}
                  onChange={event => setOtherCode(event.target.value)}
                  disabled={isSaving}
                >
                  {OTHER_CARE_ACTIONS.map(action => (
                    <option key={action.code} value={action.code}>{action.label}</option>
                  ))}
                </select>
              </label>
            )}

            {showProductFields && (
              <>
                <label className='careSheetField'>
                  {title}
                  <input
                    type='text'
                    maxLength={160}
                    value={product}
                    onChange={event => setProduct(event.target.value)}
                    placeholder='Например, Покон'
                    disabled={isSaving}
                  />
                </label>

                <div className='careSheetChips' role='group' aria-label='Популярные средства'>
                  {suggestions.map(name => (
                    <button
                      key={name}
                      type='button'
                      className={product === name ? 'is-active' : ''}
                      onClick={() => setProduct(name)}
                      disabled={isSaving}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                <label className='careSheetField'>
                  Дозировка
                  <input
                    type='text'
                    maxLength={120}
                    value={dose}
                    onChange={event => setDose(event.target.value)}
                    placeholder='Например, 1 колпачок на 1 л'
                    disabled={isSaving}
                  />
                </label>
              </>
            )}

            {tab === 'spray' && (
              <label className='careSheetCheckbox'>
                <input
                  type='checkbox'
                  checked={methodBottle}
                  onChange={event => setMethodBottle(event.target.checked)}
                  disabled={isSaving}
                />
                Из пульверизатора
              </label>
            )}

            <label className='careSheetField'>
              Заметка
              <textarea
                rows={3}
                maxLength={500}
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder='Например, обработала нижнюю сторону листьев'
                disabled={isSaving}
              />
            </label>

            <label className='careSheetField'>
              Дата ухода
              <input
                type='date'
                value={dateValue}
                max={careDateValue(new Date())}
                onChange={event => setDateValue(event.target.value)}
                disabled={isSaving}
              />
            </label>

            {error && <p className='careSheetError' role='alert'>{error}</p>}

            <div className='careSheetActions'>
              <button type='button' onClick={handleClose} disabled={isSaving}>
                Отмена
              </button>
              <button type='submit' className='careSheetSubmit' disabled={isSaving}>
                {isSaving ? 'Сохраняем…' : 'Отметить'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

export default CareActionSheet
