import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './registration.css'
import './dark-theme.css'
import './adaptiv.css'
import {
  subscribeToPush,
  isPushSupported,
  isIOS,
  isStandalone
} from '../../utils/pushNotifications.js'
import LogoBox from '../../assets/LogoBox.svg'
import mail from '../../assets/mail.svg'
import lock from '../../assets/lock.svg'
import eye from '../../assets/eye.svg'
import fingerprint from '../../assets/fingerprint.svg'
import user from '../../assets/user.svg'
import shieldcheck from '../../assets/shield-check.svg'
import { loginWithPasskey } from '../../utils/passkey.js'
import { API_URL } from '../../utils/api.js'
import personalDataDocument from '../../../document/soglasieNaObrabotkuPD.pdf'
import privacyPolicyDocument from '../../../document/PrivacyPolicy.pdf'
import termsDocument from '../../../document/UserAgreementTemplate.pdf'

async function getResponseMessage(response, fallback) {
  try {
    const data = await response.json()
    return typeof data.message === 'string' ? data.message : fallback
  } catch {
    return fallback
  }
}

function Registration({ initialMode = 'login' }) {
  const [isLogin, setIsLogin] = useState(initialMode !== 'register')
  const [mobilePanelsHeight, setMobilePanelsHeight] = useState(null)
  const blocksWrapperRef = useRef(null)
  const loginPanelRef = useRef(null)
  const registrationPanelRef = useRef(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [emailEntr, setEmailEntr] = useState('')
  const [passwordEntr, setPasswordEntr] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegistrationPassword, setShowRegistrationPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasskeyLoginLoading, setIsPasskeyLoginLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const navigate = useNavigate()

  useLayoutEffect(() => {
    const wrapper = blocksWrapperRef.current
    const activePanel = isLogin
      ? loginPanelRef.current
      : registrationPanelRef.current
    if (!wrapper || !activePanel) return undefined

    const mobileQuery = window.matchMedia('(max-width: 767px)')
    const updateHeight = () => {
      setMobilePanelsHeight(
        mobileQuery.matches ? Math.ceil(activePanel.scrollHeight) + 1 : null
      )
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(activePanel)
    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [isLogin])

  useEffect(() => {
    const controller = new AbortController()

    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/users/me`, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal
        })

        if (response.ok) {
          navigate('/home', { replace: true })
        } else if (response.status !== 401) {
          console.error('Не удалось проверить авторизацию:', response.status)
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Ошибка проверки авторизации:', error)
        }
      }
    }

    checkAuth()
    return () => controller.abort()
  }, [navigate])

  const reattachPush = async () => {
    if (!isPushSupported()) return
    if (isIOS() && !isStandalone()) return
    if (Notification.permission !== 'granted') return

    try {
      await subscribeToPush()
      console.info('Push-подписка привязана к аккаунту')
    } catch (error) {
      console.warn('Не удалось привязать push-подписку:', error)
    }
  }

  const handleRegister = async event => {
    event.preventDefault()
    if (isSubmitting) return

    const normalizedName = name.trim()
    if (!normalizedName) {
      setFormError('Укажите имя.')
      return
    }

    setIsSubmitting(true)
    setFormError('')
    try {
      const response = await fetch(`${API_URL}/users/registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          privacyPolicyAccepted,
          termsAccepted,
          name: normalizedName,
          rememberMe
        }),
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(
          await getResponseMessage(response, 'Не удалось зарегистрироваться.')
        )
      }

      await reattachPush()
      navigate('/home', { replace: true })
    } catch (error) {
      console.error('Ошибка регистрации:', error)
      setFormError(error.message || 'Ошибка при регистрации. Попробуйте ещё раз.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogin = async event => {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setFormError('')
    try {
      const response = await fetch(`${API_URL}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailEntr.trim(),
          password: passwordEntr,
          rememberMe
        }),
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(
          await getResponseMessage(response, 'Неверный email или пароль.')
        )
      }

      await reattachPush()
      navigate('/home', { replace: true })
    } catch (error) {
      console.error('Ошибка входа:', error)
      setFormError(error.message || 'Ошибка при входе. Попробуйте ещё раз.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePasskeyLogin = async () => {
    if (isPasskeyLoginLoading) return

    setIsPasskeyLoginLoading(true)
    setFormError('')
    try {
      await loginWithPasskey(emailEntr.trim(), rememberMe)
      await reattachPush()
      navigate('/home', { replace: true })
    } catch (error) {
      console.error('Ошибка входа по ключу доступа:', error)
      setFormError(
        `Не удалось войти с ключом доступа: ${error.message || 'попробуйте ещё раз.'}`
      )
    } finally {
      setIsPasskeyLoginLoading(false)
    }
  }

  const getPasswordStrength = value => {
    if (!value) return -1

    let score = 0
    if (value.length >= 8) score += 1
    if (/\p{L}/u.test(value) && /\d/.test(value)) score += 1
    if (/[^\p{L}\d]/u.test(value)) score += 1
    if (value.length >= 12) score += 1

    return Math.max(0, Math.min(3, score - 1))
  }

  const strengthLevels = [
    { label: 'Очень слабый', color: '#8B3A3A' },
    { label: 'Слабый', color: '#B5714B' },
    { label: 'Средний', color: '#C9A227' },
    { label: 'Надёжный', color: '#5A6E60' }
  ]
  const passwordStrength = getPasswordStrength(password)
  const currentLevel =
    passwordStrength >= 0 ? strengthLevels[passwordStrength] : null

  const handleSwitch = () => {
    setIsLogin(value => !value)
    setFormError('')
  }

  return (
    <main
      className={`blocksOfToService ${isLogin ? 'authModeLogin' : 'authModeRegistration'}`}
    >
      <section className='borderOther' aria-label='Вход и регистрация'>
        <div className='borderInner'>
          <div className={`slider-panel ${isLogin ? 'right' : 'left'}`}>
            <img src={LogoBox} alt='' />
            <h1>{isLogin ? 'С возвращением' : 'Создать аккаунт'}</h1>
            <p>
              {isLogin
                ? 'Войдите, чтобы продолжить уход за растениями'
                : 'Начните ухаживать за растениями вместе с «Лейкой»'}
            </p>
          </div>

          <div
            className='blocks-wrapper'
            ref={blocksWrapperRef}
            style={
              mobilePanelsHeight === null
                ? undefined
                : { height: `${mobilePanelsHeight}px` }
            }
          >
            <section
              className='blocksOfEntrance'
              aria-label='Вход в аккаунт'
              aria-hidden={!isLogin}
              inert={!isLogin}
              ref={loginPanelRef}
            >
              <form onSubmit={handleLogin}>
                <label className='emailEntrance'>
                  <span>Email</span>
                  <div className='inputShell'>
                    <img src={mail} alt='' />
                    <input
                      type='email'
                      name='login-email'
                      placeholder='name@example.com'
                      autoComplete='username'
                      autoCapitalize='none'
                      spellCheck='false'
                      required
                      value={emailEntr}
                      onChange={event => setEmailEntr(event.target.value)}
                    />
                  </div>
                </label>

                <label className='passwordEntrance'>
                  <span>Пароль</span>
                  <div className='inputShell'>
                    <img src={lock} alt='' />
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      name='login-password'
                      placeholder='Пароль'
                      autoComplete='current-password'
                      required
                      value={passwordEntr}
                      onChange={event => setPasswordEntr(event.target.value)}
                    />
                    <button
                      className='passwordVisibility'
                      type='button'
                      aria-label={showLoginPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      aria-pressed={showLoginPassword}
                      onClick={() => setShowLoginPassword(value => !value)}
                    >
                      <img src={eye} alt='' />
                    </button>
                  </div>
                </label>

                <div className='loginOptions'>
                  <label className='rememberMeLabel'>
                    <input
                      type='checkbox'
                      className='rememberMeCheckbox'
                      checked={rememberMe}
                      onChange={event => setRememberMe(event.target.checked)}
                    />
                    <span>Запомнить меня</span>
                  </label>
                </div>

                {formError && (
                  <p className='formError' role='alert'>
                    {formError}
                  </p>
                )}

                <button
                  className='buttonEntrance'
                  type='submit'
                  disabled={isSubmitting || isPasskeyLoginLoading}
                >
                  {isSubmitting ? 'Выполняется вход...' : 'Войти'}
                </button>

                <div className='orEntrance' aria-hidden='true'>
                  <span />
                  <p>или</p>
                  <span />
                </div>

                <button
                  type='button'
                  disabled={isSubmitting || isPasskeyLoginLoading}
                  onClick={handlePasskeyLogin}
                  className='buttonPasskeyLogin'
                >
                  <img src={fingerprint} alt='' />
                  <span>
                    {isPasskeyLoginLoading
                      ? 'Подтвердите вход...'
                      : 'Войти с ключом доступа'}
                  </span>
                </button>
              </form>

              <div className='formSwitch'>
                <span>Нет аккаунта?</span>
                <button className='switch-btn' type='button' onClick={handleSwitch}>
                  Создать аккаунт
                </button>
              </div>
            </section>

            <section
              className='blocksRegistration'
              aria-label='Создание аккаунта'
              aria-hidden={isLogin}
              inert={isLogin}
              ref={registrationPanelRef}
            >
              <form onSubmit={handleRegister}>
                <label className='goodOfRegistrationName'>
                  <span>Имя</span>
                  <div className='inputShell'>
                    <img src={user} alt='' />
                    <input
                      type='text'
                      name='name'
                      placeholder='Как вас зовут'
                      autoComplete='name'
                      maxLength={100}
                      required
                      value={name}
                      onChange={event => setName(event.target.value)}
                    />
                  </div>
                </label>

                <label className='goodOfRegistrationEmail'>
                  <span>Email</span>
                  <div className='inputShell'>
                    <img src={mail} alt='' />
                    <input
                      type='email'
                      name='registration-email'
                      placeholder='name@example.com'
                      autoComplete='email'
                      autoCapitalize='none'
                      spellCheck='false'
                      required
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                    />
                  </div>
                </label>

                <label className='goodOfRegistrationPassword'>
                  <span>Пароль</span>
                  <div className='inputShell'>
                    <img src={lock} alt='' />
                    <input
                      type={showRegistrationPassword ? 'text' : 'password'}
                      name='registration-password'
                      placeholder='Не менее 8 символов'
                      autoComplete='new-password'
                      minLength={8}
                      required
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                    />
                    <button
                      className='passwordVisibility'
                      type='button'
                      aria-label={
                        showRegistrationPassword ? 'Скрыть пароль' : 'Показать пароль'
                      }
                      aria-pressed={showRegistrationPassword}
                      onClick={() =>
                        setShowRegistrationPassword(value => !value)
                      }
                    >
                      <img src={eye} alt='' />
                    </button>
                  </div>
                </label>

                <div
                  className='passwordStrengthContainer'
                  style={
                    currentLevel
                      ? { '--strength-color': currentLevel.color }
                      : undefined
                  }
                >
                  <div
                    className='passwordStrength'
                    role='meter'
                    aria-label='Надёжность пароля'
                    aria-valuemin={0}
                    aria-valuemax={3}
                    aria-valuenow={Math.max(0, passwordStrength)}
                    aria-valuetext={currentLevel?.label || 'Не указана'}
                  >
                    {strengthLevels.map((level, index) => (
                      <span
                        key={level.label}
                        className={index <= passwordStrength ? 'filled' : ''}
                      />
                    ))}
                  </div>
                  <div className='passwordStrengthText' aria-live='polite'>
                    <span className='strength-label'>
                      {currentLevel ? currentLevel.label : 'Надёжность пароля'}
                    </span>
                    <span className='strength-hint'>8+ символов, буквы и цифры</span>
                  </div>
                </div>

                <label className='consentOption'>
                  <input
                    type='checkbox'
                    checked={privacyPolicyAccepted}
                    onChange={event =>
                      setPrivacyPolicyAccepted(event.target.checked)
                    }
                    required
                  />
                  <span>
                    Даю отдельное согласие на обработку{' '}
                    <a href={personalDataDocument} target='_blank' rel='noreferrer'>
                      персональных данных
                    </a>
                  </span>
                </label>
                <p className='consentPolicyNotice'>
                  До регистрации ознакомьтесь с{' '}
                  <a href={privacyPolicyDocument} target='_blank' rel='noreferrer'>
                    Политикой обработки персональных данных
                  </a>
                  .
                </p>

                <label className='consentOption'>
                  <input
                    type='checkbox'
                    checked={termsAccepted}
                    onChange={event => setTermsAccepted(event.target.checked)}
                    required
                  />
                  <span>
                    Принимаю{' '}
                    <a href={termsDocument} target='_blank' rel='noreferrer'>
                      пользовательское соглашение
                    </a>
                  </span>
                </label>

                {formError && (
                  <p className='formError' role='alert'>
                    {formError}
                  </p>
                )}

                <button
                  className='buttonRegistration'
                  type='submit'
                  disabled={isSubmitting || isPasskeyLoginLoading}
                >
                  {isSubmitting ? 'Создаём аккаунт...' : 'Зарегистрироваться'}
                </button>
              </form>

              <div className='securityTransfer'>
                <img src={shieldcheck} alt='' />
                <span>Данные передаются по защищённому каналу</span>
              </div>

              <div className='formSwitch'>
                <span>Уже есть аккаунт?</span>
                <button className='switch-btn' type='button' onClick={handleSwitch}>
                  Войти
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

    </main>
  )
}

export default Registration
