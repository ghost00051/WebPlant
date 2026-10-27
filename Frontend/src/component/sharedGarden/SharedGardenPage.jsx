import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import {
  VIEWER_SESSION,
  fetchViewerSessionState,
  isViewerAuthenticated
} from '../../utils/gardenExtraApi.js'
import {
  buildGardenHandoffPath,
  normalizeWantedPlant,
  pickWantedPlants,
  rememberAddPlantDraft,
  rememberWantedPlants
} from '../../utils/gardenHandoff.js'
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
  const navigate = useNavigate()
  const [requestId, setRequestId] = useState(0)
  const [state, setState] = useState(() => (
    isValidShareToken(token)
      ? { status: 'loading', garden: null }
      : { status: 'notfound', garden: null }
  ))
  const [viewerSession, setViewerSession] = useState(VIEWER_SESSION.unknown)
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

  useEffect(() => {
    let active = true

    fetchViewerSessionState()
      .then(session => {
        if (active) setViewerSession(session)
      })
      .catch(() => {
        if (active) setViewerSession(VIEWER_SESSION.unknown)
      })

    return () => {
      active = false
    }
  }, [])

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

  const handleWantedPlant = useCallback(plant => {
    if (!state.garden) return

    const wantedPlant = normalizeWantedPlant(plant)
    if (!wantedPlant) return

    rememberWantedPlants([wantedPlant])
    rememberAddPlantDraft(wantedPlant)

    if (isViewerAuthenticated(viewerSession)) {
      navigate('/add-plant')
      return
    }

    navigate(buildGardenHandoffPath(
      buildRegistrationPath(state.garden.token),
      [wantedPlant]
    ))
  }, [navigate, state.garden, viewerSession])

  const handleCreateGarden = useCallback(() => {
    if (state.status !== 'ready' || !state.garden) return

    const wantedPlants = pickWantedPlants(state.garden.plants)
    rememberWantedPlants(wantedPlants)
    if (wantedPlants.length) rememberAddPlantDraft(wantedPlants[0])

    if (isViewerAuthenticated(viewerSession)) {
      navigate(wantedPlants.length ? '/add-plant' : '/home')
      return
    }

    navigate(buildGardenHandoffPath(
      buildRegistrationPath(state.garden.token),
      wantedPlants
    ))
  }, [navigate, state, viewerSession])

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
  const wantedPlants = pickWantedPlants(garden.plants)
  const registrationPath = buildGardenHandoffPath(
    buildRegistrationPath(garden.token),
    wantedPlants
  )
  const viewerAuthenticated = isViewerAuthenticated(viewerSession)

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
                    <button
                      type='button'
                      className='sharedGardenWantedButton'
                      onClick={() => handleWantedPlant(plant)}
                      aria-label={`Хочу такое же: ${plant.name}`}
                    >
                      Хочу такое же
                    </button>
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
          {wantedPlants.length > 0
            ? 'Понравились растения? Перенесём до трёх из них в ваш сад — останется добавить название и интервал полива.'
            : 'Хотите такой же календарь полива? Добавьте свои растения в «Лейку» — приложение подскажет, когда пора поливать.'}
        </p>
        {wantedPlants.length > 0 && (
          <ul
            className='sharedGardenWantedList'
            aria-label='Растения, которые перенесём в ваш сад'
          >
            {wantedPlants.map(plant => (
              <li key={plant.name}>{plant.name}</li>
            ))}
          </ul>
        )}
        <div className='sharedGardenCtaActions'>
          <button
            type='button'
            className='sharedGardenButton sharedGardenButton--secondary'
            onClick={handleShare}
            disabled={shareBusy}
          >
            {shareBusy ? 'Готовим ссылку…' : 'Поделиться этим садом'}
          </button>
          {viewerAuthenticated
            ? (
              <button
                type='button'
                className='sharedGardenButton'
                onClick={handleCreateGarden}
              >
                {wantedPlants.length > 0
                  ? 'Добавить эти растения к себе'
                  : 'Перейти в мой сад'}
              </button>
              )
            : (
              <Link
                className='sharedGardenButton sharedGardenCtaPrimary'
                to={registrationPath}
                onClick={() => {
                  rememberWantedPlants(wantedPlants)
                  if (wantedPlants.length) rememberAddPlantDraft(wantedPlants[0])
                }}
              >
                Создать свой сад
              </Link>
              )}
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
