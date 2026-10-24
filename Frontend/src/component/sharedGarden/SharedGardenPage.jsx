import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import NotFound from '../ContentPage/NotFound.jsx'
import {
  GARDEN_SHARE_TITLE,
  buildRegistrationPath,
  buildShareUrl,
  fetchPublicGarden,
  isValidShareToken,
  rememberShareToken,
  shareGardenLink
} from '../../utils/gardenShare.js'
import { trackEvent } from '../../utils/productEvents.js'
import './sharedGarden.css'

const DEFAULT_OWNER_NAME = 'Садовник'

function daysWord (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
  return 'дней'
}

function wateringLabel (intervalDays) {
  const days = Number(intervalDays)
  if (!Number.isFinite(days) || days <= 0) return ''
  const rounded = Math.round(days)
  return `раз в ${rounded} ${daysWord(rounded)}`
}

function plantsWord (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'растение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'растения'
  return 'растений'
}

function SharedGardenContent ({ token }) {
  const [requestId, setRequestId] = useState(0)
  const [state, setState] = useState(() => (
    isValidShareToken(token)
      ? { status: 'loading', garden: null }
      : { status: 'notfound', garden: null }
  ))
  const [shareStatus, setShareStatus] = useState('')
  const [shareBusy, setShareBusy] = useState(false)

  useEffect(() => {
    if (!isValidShareToken(token)) return undefined

    rememberShareToken(token)

    const controller = new AbortController()
    let active = true

    fetchPublicGarden(token, { signal: controller.signal })
      .then(garden => {
        if (!active) return
        setState(garden
          ? { status: 'ready', garden }
          : { status: 'notfound', garden: null })
      })
      .catch(error => {
        if (!active || error?.name === 'AbortError') return
        setState({ status: 'error', garden: null })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [token, requestId])

  const handleRetry = useCallback(() => {
    setState({ status: 'loading', garden: null })
    setRequestId(value => value + 1)
  }, [])

  const handleShare = useCallback(async () => {
    if (!state.garden || shareBusy) return

    setShareBusy(true)
    setShareStatus('')

    const url = buildShareUrl(state.garden.token, window.location.origin)
    const result = await shareGardenLink({
      url,
      title: GARDEN_SHARE_TITLE,
      text: `Сад «${state.garden.ownerName}» в «Лейке»`
    })

    if (result === 'shared') {
      setShareStatus('Ссылка отправлена')
      trackEvent('share_clicked', { channel: 'web_share' })
    } else if (result === 'copied') {
      setShareStatus('Ссылка скопирована — можно отправлять')
      trackEvent('share_clicked', { channel: 'clipboard' })
    }

    setShareBusy(false)
  }, [shareBusy, state.garden])

  if (state.status === 'loading') {
    return (
      <ContentPage>
        <div className='contentHero'>
          <h1>Сад в «Лейке»</h1>
        </div>
        <p className='sharedGardenStatus' role='status'>
          Загружаем сад…
        </p>
      </ContentPage>
    )
  }

  if (state.status === 'notfound') {
    return (
      <ContentPage>
        <NotFound
          backPath='/'
          backLabel='На главную'
          message='Такой публичной ссылки нет: возможно, владелец её отозвал или в адресе ошибка.'
        />
      </ContentPage>
    )
  }

  if (state.status === 'error') {
    return (
      <ContentPage>
        <div className='contentHero'>
          <h1>Сад в «Лейке»</h1>
          <p className='contentLead'>
            Не удалось открыть сад. Проверьте соединение с интернетом и
            попробуйте ещё раз.
          </p>
        </div>
        <div className='contentCta'>
          <p>Ссылка осталась прежней — просто повторите попытку.</p>
          <button
            type='button'
            className='sharedGardenButton'
            onClick={handleRetry}
          >
            Обновить
          </button>
        </div>
      </ContentPage>
    )
  }

  const garden = state.garden
  const ownerName = garden.ownerName || DEFAULT_OWNER_NAME
  const plantCount = Number.isFinite(garden.plantCount)
    ? garden.plantCount
    : garden.plants.length
  const registrationPath = buildRegistrationPath(garden.token)

  return (
    <ContentPage>
      <div className='contentHero'>
        <h1>Сад в «Лейке»</h1>
        <p className='contentLead'>
          Коллекция растений: {ownerName}. {plantCount}{' '}
          {plantsWord(plantCount)} в календаре полива.
        </p>
      </div>

      <section
        className='contentSection'
        aria-labelledby='sharedGardenPlantsTitle'
      >
        <h2 id='sharedGardenPlantsTitle'>Растения</h2>

        {garden.plants.length === 0
          ? (
            <p className='sharedGardenEmpty'>
              В этом саду пока нет растений. Загляните позже — коллекция
              пополняется.
            </p>
            )
          : (
            <ul className='contentCardGrid'>
              {garden.plants.map(plant => {
                const watering = wateringLabel(plant.intervalDays)
                return (
                  <li className='contentCard' key={plant.id}>
                    <h3>{plant.name}</h3>
                    {plant.species && (
                      <p className='contentCardLatin'>{plant.species}</p>
                    )}
                    {watering && (
                      <ul className='contentCardFacts'>
                        <li>
                          <strong>Полив:</strong> {watering}
                        </li>
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
            )}
      </section>

      <p className='sharedGardenReadonly'>
        Только просмотр — растения нельзя изменить.
      </p>

      <div className='contentCta sharedGardenCta'>
        <p>
          Хотите такой же календарь полива? Добавьте свои растения в «Лейку» —
          приложение подскажет, когда пора поливать.
        </p>
        <div className='sharedGardenCtaActions'>
          <button
            type='button'
            className='sharedGardenButton'
            onClick={handleShare}
            disabled={shareBusy}
          >
            {shareBusy ? 'Готовим ссылку…' : 'Поделиться этим садом'}
          </button>
          <Link to={registrationPath}>Создать свой сад</Link>
        </div>
      </div>

      {shareStatus && (
        <p className='sharedGardenStatus' role='status'>
          {shareStatus}
        </p>
      )}
    </ContentPage>
  )
}

function SharedGardenPage () {
  const { token } = useParams()
  return <SharedGardenContent key={token} token={token} />
}

export default SharedGardenPage
