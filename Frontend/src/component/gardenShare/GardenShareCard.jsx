import { useCallback, useEffect, useState } from 'react'
import {
  GARDEN_SHARE_TITLE,
  buildShareUrl,
  copyToClipboard,
  createGardenShare,
  fetchShareStatus,
  revokeGardenShare,
  shareGardenLink
} from '../../utils/gardenShare.js'
import { trackEvent } from '../../utils/productEvents.js'
import './gardenShare.css'

const SHARE_INTRO =
  'Создайте публичную ссылку на сад: друзья увидят список растений и частоту ' +
  'полива, но не смогут ничего изменить.'

function sharedGardenUrl (share) {
  if (!share) return ''
  try {
    return buildShareUrl(share.token, window.location.origin) || ''
  } catch {
    return buildShareUrl(share.token) || ''
  }
}

function describeShareResult (result) {
  if (result === 'shared') {
    return { message: 'Ссылка отправлена', channel: 'web_share' }
  }
  if (result === 'copied') {
    return { message: 'Ссылка скопирована', channel: 'clipboard' }
  }
  return null
}

function GardenShareCard () {
  const [share, setShare] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [reloadId, setReloadId] = useState(0)

  useEffect(() => {
    let active = true

    fetchShareStatus()
      .then(nextShare => {
        if (active) setShare(nextShare)
      })
      .catch(() => {
        if (active) {
          setLoadError(
            'Не удалось проверить ссылку. Обновите страницу или попробуйте позже.'
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadId])

  const handleReload = useCallback(() => {
    setLoadError('')
    setLoading(true)
    setReloadId(value => value + 1)
  }, [])

  const handleCreate = useCallback(async () => {
    if (busy) return

    setBusy('create')
    setError('')
    setMessage('')

    try {
      const nextShare = await createGardenShare()
      setShare(nextShare)

      const url = sharedGardenUrl(nextShare)
      const result = await shareGardenLink({
        url,
        title: GARDEN_SHARE_TITLE,
        text: 'Моя коллекция растений в «Лейке»'
      })
      const described = describeShareResult(result)

      if (described) {
        setMessage(described.message)
        trackEvent('share_clicked', { channel: described.channel })
      } else {
        setMessage('Ссылка готова — скопируйте её и отправьте друзьям')
      }
    } catch (createError) {
      setError(
        createError?.message ||
          'Не удалось создать ссылку на сад. Попробуйте ещё раз.'
      )
    } finally {
      setBusy('')
    }
  }, [busy])

  const handleShareLink = useCallback(async () => {
    if (!share || busy) return

    setBusy('share')
    setError('')
    setMessage('')

    const result = await shareGardenLink({
      url: sharedGardenUrl(share),
      title: GARDEN_SHARE_TITLE,
      text: 'Моя коллекция растений в «Лейке»'
    })
    const described = describeShareResult(result)

    if (described) {
      setMessage(described.message)
      trackEvent('share_clicked', { channel: described.channel })
    }

    setBusy('')
  }, [busy, share])

  const handleCopy = useCallback(async () => {
    if (!share || busy) return

    setBusy('copy')
    setError('')
    setMessage('')

    const copied = await copyToClipboard(sharedGardenUrl(share))
    if (copied) {
      setMessage('Ссылка скопирована')
      trackEvent('share_clicked', { channel: 'clipboard' })
    } else {
      setError('Не удалось скопировать ссылку. Выделите её и скопируйте вручную.')
    }

    setBusy('')
  }, [busy, share])

  const handleRevoke = useCallback(async () => {
    if (busy) return

    setBusy('revoke')
    setError('')
    setMessage('')

    try {
      await revokeGardenShare()
      setShare(null)
      setConfirmRevoke(false)
      setMessage('Ссылка отозвана — по ней больше нельзя открыть сад')
    } catch (revokeError) {
      setError(
        revokeError?.message ||
          'Не удалось отозвать ссылку. Попробуйте ещё раз.'
      )
    } finally {
      setBusy('')
    }
  }, [busy])

  const link = sharedGardenUrl(share)

  return (
    <section className='accountData gardenShareCard' aria-labelledby='gardenShareTitle'>
      <h2 id='gardenShareTitle'>Поделиться садом</h2>

      {loading
        ? (
          <p className='accountDataText' role='status'>
            Проверяем ссылку…
          </p>
          )
        : loadError
          ? (
            <>
              <p className='accountDataError' role='alert'>
                {loadError}
              </p>
              <div className='accountDataActions'>
                <button
                  type='button'
                  className='accountDataExport'
                  onClick={handleReload}
                >
                  Проверить снова
                </button>
              </div>
            </>
            )
          : share
            ? (
              <>
                <p className='accountDataText'>
                  Ссылка активна. Каждый, у кого она есть, может посмотреть
                  растения и частоту полива — без права что-то изменить.
                </p>
                <div className='gardenShareLinkRow'>
                  <input
                    className='gardenShareLinkInput'
                    type='text'
                    readOnly
                    value={link}
                    aria-label='Публичная ссылка на сад'
                    onFocus={event => event.target.select()}
                  />
                  <button
                    type='button'
                    className='accountDataExport'
                    onClick={handleCopy}
                    disabled={Boolean(busy)}
                  >
                    {busy === 'copy' ? 'Копируем…' : 'Скопировать'}
                  </button>
                </div>
                <p className='gardenShareStats'>
                  Просмотров: {share.viewCount} · Пришло по ссылке:{' '}
                  {share.signupCount}
                </p>
                <div className='accountDataActions'>
                  <button
                    type='button'
                    className='accountDataExport'
                    onClick={handleShareLink}
                    disabled={Boolean(busy)}
                  >
                    {busy === 'share' ? 'Готовим ссылку…' : 'Поделиться ссылкой'}
                  </button>
                  <button
                    type='button'
                    className='accountDataDelete'
                    onClick={() => setConfirmRevoke(true)}
                    disabled={Boolean(busy) || confirmRevoke}
                  >
                    Отозвать ссылку
                  </button>
                </div>

                {confirmRevoke && (
                  <div
                    className='gardenShareConfirm'
                    role='group'
                    aria-labelledby='gardenShareConfirmText'
                  >
                    <p id='gardenShareConfirmText'>
                      Отозвать ссылку? Открытые по ней страницы перестанут
                      работать, новую ссылку можно создать в любой момент.
                    </p>
                    <div className='accountDataActions'>
                      <button
                        type='button'
                        className='accountDataDelete'
                        onClick={handleRevoke}
                        disabled={busy === 'revoke'}
                      >
                        {busy === 'revoke' ? 'Отзываем…' : 'Да, отозвать'}
                      </button>
                      <button
                        type='button'
                        className='accountDataExport'
                        onClick={() => setConfirmRevoke(false)}
                        disabled={busy === 'revoke'}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </>
              )
            : (
              <>
                <p className='accountDataText'>{SHARE_INTRO}</p>
                <div className='accountDataActions'>
                  <button
                    type='button'
                    className='accountDataExport'
                    onClick={handleCreate}
                    disabled={Boolean(busy)}
                  >
                    {busy === 'create' ? 'Создаём ссылку…' : 'Создать ссылку'}
                  </button>
                </div>
              </>
              )}

      {message && (
        <p className='accountDataStatus' role='status'>
          {message}
        </p>
      )}
      {error && (
        <p className='accountDataError' role='alert'>
          {error}
        </p>
      )}
    </section>
  )
}

export default GardenShareCard
