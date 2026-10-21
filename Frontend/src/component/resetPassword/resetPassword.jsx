import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import BackBtn from '../../assets/BackBtn.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import IconBadge from '../../assets/IconBadge.svg'
import mail from '../../assets/mail.svg'
import lock from '../../assets/lock.svg'
import send from '../../assets/send.svg'
import checkCircle from '../../assets/check-circle.svg'
import alertTriangle from '../../assets/alert-triangle.svg'
import shieldCheck from '../../assets/shield-check.svg'
import { API_URL } from '../../utils/api.js'
import './resetPassword.css'
import './adaptiv.css'

const RESEND_COOLDOWN_SECONDS = 60
const MIN_PASSWORD_LENGTH = 8
const RESET_PASSWORD_PATH = '/reset-password'

function readResetToken (searchParams) {
  if (typeof window === 'undefined') return searchParams.get('token') || ''

  const rawHash = window.location.hash.replace(/^#/, '')
  if (rawHash) {
    const hashToken = new URLSearchParams(rawHash).get('token') || ''
    if (hashToken) return hashToken
  }

  return searchParams.get('token') || ''
}

function stripResetTokenFromUrl () {
  if (typeof window === 'undefined') return
  if (!window.location.search && !window.location.hash) return
  window.history.replaceState(window.history.state, '', RESET_PASSWORD_PATH)
}

async function getResponseMessage (response, fallback) {
  try {
    const data = await response.json()
    return typeof data.message === 'string' ? data.message : fallback
  } catch {
    return fallback
  }
}

function ResetPassword () {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [token] = useState(() => readResetToken(searchParams))

  const [step, setStep] = useState(token ? 'checking' : 'request')
  const [email, setEmail] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    stripResetTokenFromUrl()
  }, [])

  const checkToken = useCallback(async signal => {
    try {
      const response = await fetch(
        `${API_URL}/users/password-reset/verify?token=${encodeURIComponent(token)}`,
        { method: 'GET', credentials: 'include', signal }
      )

      if (!response.ok) {
        setFormError(
          await getResponseMessage(
            response,
            'Ссылка недействительна или устарела. Запросите новую.'
          )
        )
        setStep('invalid')
        return
      }

      const data = await response.json()
      setMaskedEmail(typeof data.email === 'string' ? data.email : '')
      setStep('reset')
    } catch (error) {
      if (error.name === 'AbortError') return
      console.error('Ошибка проверки ссылки сброса пароля:', error)
      setFormError('Не удалось проверить ссылку. Попробуйте ещё раз.')
      setStep('invalid')
    }
  }, [token])

  useEffect(() => {
    if (!token) return undefined

    const controller = new AbortController()
    Promise.resolve().then(() => checkToken(controller.signal))
    return () => controller.abort()
  }, [token, checkToken])

  useEffect(() => {
    if (cooldown <= 0) return undefined

    const timer = setInterval(() => {
      setCooldown(seconds => (seconds > 0 ? seconds - 1 : 0))
    }, 1000)

    return () => clearInterval(timer)
  }, [cooldown])

  const sendResetLink = async ({ markSent }) => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setFormError('')
    try {
      const response = await fetch(`${API_URL}/users/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(
          await getResponseMessage(response, 'Не удалось отправить ссылку.')
        )
      }

      if (markSent) setStep('sent')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (error) {
      console.error('Ошибка отправки ссылки сброса пароля:', error)
      setFormError(
        error.message || 'Не удалось отправить ссылку. Попробуйте ещё раз.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRequest = event => {
    event.preventDefault()
    return sendResetLink({ markSent: true })
  }

  const handleResend = () => sendResetLink({ markSent: false })

  const handleReset = async event => {
    event.preventDefault()
    if (isSubmitting) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`)
      return
    }
    if (password !== passwordRepeat) {
      setFormError('Пароли не совпадают')
      return
    }

    setIsSubmitting(true)
    setFormError('')
    try {
      const response = await fetch(`${API_URL}/users/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(
          await getResponseMessage(response, 'Не удалось сохранить новый пароль.')
        )
      }

      setStep('done')
    } catch (error) {
      console.error('Ошибка смены пароля:', error)
      setFormError(
        error.message || 'Не удалось сохранить новый пароль. Попробуйте ещё раз.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const backToRequest = () => {
    setPassword('')
    setPasswordRepeat('')
    setFormError('')
    setEmail('')
    setStep('request')
  }

  const steps = {
    request: {
      badge: true,
      title: 'Сброс пароля',
      description:
        'Укажите email аккаунта — отправим ссылку для создания нового пароля. Ссылка действует 30 минут.'
    },
    sent: {
      icon: checkCircle,
      tone: 'success',
      title: 'Ссылка отправлена',
      description:
        `Проверьте почту ${email.trim()} — письмо от «Лейки». ` +
        'Если письма нет, посмотрите в папке «Спам».'
    },
    checking: {
      badge: true,
      title: 'Проверяем ссылку…',
      description: 'Это займёт пару секунд.'
    },
    reset: {
      badge: true,
      title: 'Новый пароль',
      description:
        (maskedEmail
          ? `Придумайте новый пароль для аккаунта ${maskedEmail}. `
          : 'Придумайте новый пароль. ') +
        `Минимум ${MIN_PASSWORD_LENGTH} символов. ` +
        'После смены пароля все активные сессии будут закрыты.'
    },
    invalid: {
      icon: alertTriangle,
      tone: 'warning',
      title: 'Ссылка не работает',
      description:
        formError || 'Ссылка недействительна или устарела. Запросите новую.'
    },
    done: {
      icon: shieldCheck,
      tone: 'success',
      title: 'Пароль изменён',
      description:
        'Теперь войдите в аккаунт с новым паролем. Все прежние сессии закрыты — ' +
        'на других устройствах потребуется войти заново.'
    }
  }

  const current = steps[step] ?? steps.request

  return (
    <main className='resetPasswordBLocks'>
      <section className='resetPasswordCard'>
        <div className='headerresetPassword'>
          <button
            type='button'
            onClick={() => navigate('/home')}
            aria-label='Вернуться на главную'
          >
            <ThemedIcon src={BackBtn} alt='' />
          </button>
          <p>Восстановление пароля</p>
        </div>

        <div className='resetPasswordHero' aria-live='polite'>
          <div className='iconOfReset'>
            {current.badge ? (
              <img src={IconBadge} alt='' />
            ) : (
              <img
                className={`resetPasswordStepIcon resetPasswordStepIcon--${current.tone}`}
                src={current.icon}
                alt=''
              />
            )}
          </div>
          <div className='mainResetColor'>
            <h1>{current.title}</h1>
            <p>{current.description}</p>
          </div>
        </div>

        <div className='resetPasswordBody'>
          {step === 'request' && (
            <form
              className='resetPasswordForm'
              onSubmit={handleRequest}
              aria-busy={isSubmitting}
            >
              <label className='emailResetPassword'>
                <span>Email</span>
                <div className='inputShellResetPassword'>
                  <img src={mail} alt='' />
                  <input
                    type='email'
                    name='login-email'
                    placeholder='name@example.com'
                    autoComplete='username'
                    autoCapitalize='none'
                    spellCheck='false'
                    required
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                  />
                </div>
              </label>
              {formError && <p className='resetError' role='alert'>{formError}</p>}
              <button
                className='buttonResetPassword'
                type='submit'
                disabled={isSubmitting}
              >
                <img src={send} alt='' />
                <span>{isSubmitting ? 'Отправляем…' : 'Отправить ссылку'}</span>
              </button>
            </form>
          )}

          {step === 'sent' && (
            <>
              {formError && <p className='resetError' role='alert'>{formError}</p>}
              <div className='buttonOfPasswordReset'>
                <button
                  className='resetPasswordGhost'
                  type='button'
                  onClick={handleResend}
                  disabled={cooldown > 0 || isSubmitting}
                >
                  <span>{isSubmitting ? 'Отправляем…' : 'Отправить снова'}</span>
                </button>
                <p className='passwordResetTimer' aria-live='polite'>
                  {cooldown > 0
                    ? <>Повторно через <b>{cooldown} с</b></>
                    : 'Можно отправить сейчас'}
                </p>
              </div>
            </>
          )}

          {step === 'checking' && (
            <div className='resetPasswordSpinner' aria-hidden='true' />
          )}

          {step === 'reset' && (
            <form
              className='resetPasswordForm'
              onSubmit={handleReset}
              aria-busy={isSubmitting}
            >
              <label className='emailResetPassword'>
                <span>Новый пароль</span>
                <div className='inputShellResetPassword'>
                  <img src={lock} alt='' />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name='new-password'
                    placeholder='Минимум 8 символов'
                    autoComplete='new-password'
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                </div>
              </label>
              <label className='emailResetPassword'>
                <span>Повторите пароль</span>
                <div className='inputShellResetPassword'>
                  <img src={lock} alt='' />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name='new-password-repeat'
                    placeholder='Повторите пароль'
                    autoComplete='new-password'
                    required
                    value={passwordRepeat}
                    onChange={event => setPasswordRepeat(event.target.value)}
                  />
                </div>
              </label>
              <label className='resetShowPassword'>
                <input
                  type='checkbox'
                  checked={showPassword}
                  onChange={event => setShowPassword(event.target.checked)}
                />
                <span>Показать пароль</span>
              </label>
              {formError && <p className='resetError' role='alert'>{formError}</p>}
              <button
                className='buttonResetPassword'
                type='submit'
                disabled={isSubmitting}
              >
                <span>{isSubmitting ? 'Сохраняем…' : 'Сохранить новый пароль'}</span>
              </button>
            </form>
          )}

          {step === 'invalid' && (
            <div className='buttonOfPasswordReset'>
              <button type='button' onClick={backToRequest}>
                <span>Запросить новую ссылку</span>
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className='buttonOfPasswordReset'>
              <button type='button' onClick={() => navigate('/login')}>
                <span>Войти</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default ResetPassword
