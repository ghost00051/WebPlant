import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './registration.css'
import './dark-theme.css'
import './adaptiv.css'
import {
  subscribeToPush,
  isPushDisabledOnThisDevice,
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
import sparkles from '../../assets/sparkles.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { loginWithPasskey } from '../../utils/passkey.js'
import { API_URL } from '../../utils/api.js'
import { trackEvent } from '../../utils/productEvents.js'
import {
  clearGuestChatHistory,
  countGuestChatAnswers,
  readGuestChatHistory
} from '../../utils/guestChat.js'
import { savePlantCountPreset } from '../../utils/registrationOnboarding.js'
import { readWantedPlants } from '../../utils/gardenHandoff.js'
import RegistrationOnboarding from './registrationOnboarding.jsx'
import {
  clearShareToken,
  readShareToken,
  readUtmShareToken
} from '../../utils/gardenShare.js'
import { detectTimeZone } from '../../utils/timeZone.js'
import personalDataDocument from '../../../document/soglasieNaObrabotkuPD.pdf'
import privacyPolicyDocument from '../../../document/PrivacyPolicy.pdf'
import termsDocument from '../../../document/UserAgreementTemplate.pdf'

function formatAnswersCount (count) {
  const value = Math.abs(Number(count)) || 0
  const mod100 = value % 100
  const mod10 = value % 10
  if (mod100 >= 11 && mod100 <= 14) return `${value} ответов`
  if (mod10 === 1) return `${value} ответ`
  if (mod10 >= 2 && mod10 <= 4) return `${value} ответа`
  return `${value} ответов`
}

async function getResponseMessage (response, fallback) {
  try {
    const data = await response.json()
    return typeof data.message === 'string' ? data.message : fallback
  } catch {
    return fallback
  }
}

const PUSH_REATTACH_TIMEOUT_MS = 3000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEUTRAL_REGISTRATION_CONFLICT =
  'Не удалось создать аккаунт. Если этот email уже зарегистрирован, войдите в аккаунт или восстановите пароль.'


function waitAtMost (promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ])
}

function Registration ({ initialMode = 'login' }) {
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
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [emailEntr, setEmailEntr] = useState('')
  const [passwordEntr, setPasswordEntr] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegistrationPassword, setShowRegistrationPassword] =
    useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasskeyLoginLoading, setIsPasskeyLoginLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [loginErrorField, setLoginErrorField] = useState('')
  const [registerErrorField, setRegisterErrorField] = useState('')
  const [loginAttempted, setLoginAttempted] = useState(false)
  const [registerAttempted, setRegisterAttempted] = useState(false)
  const [guestChatAnswers, setGuestChatAnswers] = useState(() =>
    countGuestChatAnswers(readGuestChatHistory())
  )
  const [carriedChatAnswers, setCarriedChatAnswers] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [wantedPlantsCount] = useState(() => readWantedPlants().length)
  const loginEmailRef = useRef(null)
  const loginPasswordRef = useRef(null)
  const registerNameRef = useRef(null)
  const registerEmailRef = useRef(null)
  const registerPasswordRef = useRef(null)
  const privacyConsentRef = useRef(null)
  const termsConsentRef = useRef(null)
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

  const finishOnboarding = ({ preset, openChat } = {}) => {
    if (preset) savePlantCountPreset(preset)
    setShowOnboarding(false)

    if (!openChat && wantedPlantsCount > 0) {
      navigate('/add-plant', { replace: true })
      return
    }

    navigate('/home', {
      replace: true,
      ...(openChat ? { state: { activeTab: 'chat' } } : {})
    })
  }

  const reattachPush = async () => {
    if (!isPushSupported()) return
    if (isIOS() && !isStandalone()) return
    if (Notification.permission !== 'granted') return
    if (isPushDisabledOnThisDevice()) return

    try {
      await subscribeToPush()
    } catch (error) {
      console.warn('Не удалось привязать push-подписку:', error)
    }
  }

  const focusField = ref => {
    window.setTimeout(() => {
      ref.current?.focus()
    }, 0)
  }

  const clearLoginFieldError = field => {
    if (loginErrorField === field) {
      setFormError('')
      setLoginErrorField('')
    }
  }

  const clearRegisterFieldError = field => {
    if (registerErrorField === field) {
      setFormError('')
      setRegisterErrorField('')
    }
  }

  const validateLoginForm = () => {
    if (!emailEntr.trim()) {
      return { field: 'email', message: 'Введите email.', ref: loginEmailRef }
    }
    if (!EMAIL_PATTERN.test(emailEntr.trim())) {
      return {
        field: 'email',
        message: 'Введите email в формате name@example.com.',
        ref: loginEmailRef
      }
    }
    if (!passwordEntr) {
      return { field: 'password', message: 'Введите пароль.', ref: loginPasswordRef }
    }
    return null
  }

  const validateRegistrationForm = () => {
    const normalizedName = name.trim()
    if (!normalizedName) {
      return { field: 'name', message: 'Введите имя.', ref: registerNameRef }
    }
    if (normalizedName.length > 20) {
      return {
        field: 'name',
        message: 'Имя должно содержать не более 20 символов.',
        ref: registerNameRef
      }
    }
    if (!email.trim()) {
      return { field: 'email', message: 'Введите email.', ref: registerEmailRef }
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return {
        field: 'email',
        message: 'Введите email в формате name@example.com.',
        ref: registerEmailRef
      }
    }
    if (!password) {
      return { field: 'password', message: 'Придумайте пароль.', ref: registerPasswordRef }
    }
    if (password.length < 8) {
      return {
        field: 'password',
        message: 'Пароль должен содержать не менее 8 символов.',
        ref: registerPasswordRef
      }
    }
    if (!privacyPolicyAccepted) {
      return {
        field: 'consent',
        message: 'Отметьте согласие на обработку персональных данных.',
        ref: privacyConsentRef
      }
    }
    if (!termsAccepted) {
      return {
        field: 'consent',
        message: 'Примите пользовательское соглашение.',
        ref: termsConsentRef
      }
    }
    return null
  }

  const handleRegister = async event => {
    event.preventDefault()
    if (isSubmitting) return

    setRegisterAttempted(true)
    const validationError = validateRegistrationForm()
    if (validationError) {
      setFormError(validationError.message)
      setRegisterErrorField(validationError.field)
      focusField(validationError.ref)
      return
    }

    const normalizedName = name.trim()
    const shareToken =
      readShareToken() || readUtmShareToken(window.location.search) || null
    setIsSubmitting(true)
    setFormError('')
    setRegisterErrorField('')
    try {
      const response = await fetch(`${API_URL}/users/registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          privacyPolicyAccepted,
          termsAccepted,
          marketingConsent,
          name: normalizedName,
          rememberMe,
          timezone: detectTimeZone(),
          ...(shareToken ? { shareToken } : {})
        }),
        credentials: 'include'
      })

      if (response.status === 409) {
        setFormError(NEUTRAL_REGISTRATION_CONFLICT)
        return
      }

      if (!response.ok) {
        throw new Error(
          await getResponseMessage(response, 'Не удалось зарегистрироваться.')
        )
      }

      trackEvent('register', { method: 'password' })
      clearShareToken()

      const answersCarried = guestChatAnswers
      clearGuestChatHistory()
      setGuestChatAnswers(0)

      await waitAtMost(reattachPush(), PUSH_REATTACH_TIMEOUT_MS)
      setCarriedChatAnswers(answersCarried)
      setShowOnboarding(true)
    } catch (error) {
      console.error('Ошибка регистрации:', error)
      setFormError(
        error.message || 'Ошибка при регистрации. Попробуйте ещё раз.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogin = async event => {
    event.preventDefault()
    if (isSubmitting) return

    setLoginAttempted(true)
    const validationError = validateLoginForm()
    if (validationError) {
      setFormError(validationError.message)
      setLoginErrorField(validationError.field)
      focusField(validationError.ref)
      return
    }

    setIsSubmitting(true)
    setFormError('')
    setLoginErrorField('')
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

      clearGuestChatHistory()
      setGuestChatAnswers(0)
      await waitAtMost(reattachPush(), PUSH_REATTACH_TIMEOUT_MS)
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
      clearGuestChatHistory()
      setGuestChatAnswers(0)
      await waitAtMost(reattachPush(), PUSH_REATTACH_TIMEOUT_MS)
      navigate('/home', { replace: true })
    } catch (error) {
      console.error('Ошибка входа по ключу доступа:', error)
      setFormError(
        `Не удалось войти с ключом доступа: ${
          error.message || 'попробуйте ещё раз.'
        }`
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
    setLoginErrorField('')
    setRegisterErrorField('')
    setLoginAttempted(false)
    setRegisterAttempted(false)
  }

  return (
    <main
      className={`blocksOfToService ${
        isLogin ? 'authModeLogin' : 'authModeRegistration'
      }`}
    >
      <header className='authBrand'>
        <Link to='/' className='authBrandLink' aria-label='Лейка — на главную страницу'>
          <ThemedIcon src={LogoBox} alt='' />
          <span className='authBrandName'>Лейка</span>
        </Link>
        <Link to='/' className='authHomeLink'>
          На главную
        </Link>
      </header>
      <section className='borderOther' aria-label='Вход и регистрация'>
        <div className='borderInner'>
          <div className={`slider-panel ${isLogin ? 'right' : 'left'}`}>
            <ThemedIcon src={LogoBox} alt='' />
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
              <form onSubmit={handleLogin} noValidate>
                <label className='emailEntrance' htmlFor='login-email'>
                  <span>Email</span>
                  <div className='inputShell'>
                    <img src={mail} alt='' />
                    <input
                      id='login-email'
                      type='email'
                      name='login-email'
                      placeholder='name@example.com'
                      autoComplete='username'
                      autoCapitalize='none'
                      spellCheck='false'
                      required
                      ref={loginEmailRef}
                      aria-invalid={
                        loginAttempted && loginErrorField === 'email'
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        loginAttempted && loginErrorField === 'email'
                          ? 'loginFormError'
                          : undefined
                      }
                      value={emailEntr}
                      onChange={event => {
                        setEmailEntr(event.target.value)
                        clearLoginFieldError('email')
                      }}
                    />
                  </div>
                </label>

                <div className='passwordEntrance'>
                  <label htmlFor='login-password'>Пароль</label>
                  <div className='inputShell'>
                    <img src={lock} alt='' />
                    <input
                      id='login-password'
                      type={showLoginPassword ? 'text' : 'password'}
                      name='login-password'
                      placeholder='Пароль'
                      autoComplete='current-password'
                      required
                      ref={loginPasswordRef}
                      aria-invalid={
                        loginAttempted && loginErrorField === 'password'
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        loginAttempted && loginErrorField === 'password'
                          ? 'loginFormError'
                          : undefined
                      }
                      value={passwordEntr}
                      onChange={event => {
                        setPasswordEntr(event.target.value)
                        clearLoginFieldError('password')
                      }}
                    />
                    <button
                      className='passwordVisibility'
                      type='button'
                      aria-controls='login-password'
                      aria-label={
                        showLoginPassword ? 'Скрыть пароль' : 'Показать пароль'
                      }
                      aria-pressed={showLoginPassword}
                      onClick={() => setShowLoginPassword(value => !value)}
                    >
                      <img src={eye} alt='' />
                    </button>
                  </div>
                </div>
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
                  <button
                    className='resetPassword'
                    type='button'
                    onClick={() => navigate('/reset-password')}
                  >
                    Забыли пароль?
                  </button>
                </div>
                {formError && (
                  <p id='loginFormError' className='formError' role='alert'>
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
                <button
                  className='switch-btn'
                  type='button'
                  onClick={handleSwitch}
                >
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
              <form onSubmit={handleRegister} noValidate>
                <label className='goodOfRegistrationName' htmlFor='registration-name'>
                  <span>Имя</span>
                  <div className='inputShell'>
                    <img src={user} alt='' />
                    <input
                      id='registration-name'
                      type='text'
                      name='name'
                      placeholder='Как вас зовут'
                      autoComplete='name'
                      maxLength={20}
                      required
                      ref={registerNameRef}
                      aria-invalid={
                        registerAttempted && registerErrorField === 'name'
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        registerAttempted && registerErrorField === 'name'
                          ? 'registrationFormError'
                          : undefined
                      }
                      value={name}
                      onChange={event => {
                        setName(event.target.value)
                        clearRegisterFieldError('name')
                      }}
                    />
                  </div>
                </label>

                <label className='goodOfRegistrationEmail' htmlFor='registration-email'>
                  <span>Email</span>
                  <div className='inputShell'>
                    <img src={mail} alt='' />
                    <input
                      id='registration-email'
                      type='email'
                      name='registration-email'
                      placeholder='name@example.com'
                      autoComplete='email'
                      autoCapitalize='none'
                      spellCheck='false'
                      required
                      ref={registerEmailRef}
                      aria-invalid={
                        registerAttempted && registerErrorField === 'email'
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        registerAttempted && registerErrorField === 'email'
                          ? 'registrationFormError'
                          : undefined
                      }
                      value={email}
                      onChange={event => {
                        setEmail(event.target.value)
                        clearRegisterFieldError('email')
                      }}
                    />
                  </div>
                </label>

                <div className='goodOfRegistrationPassword'>
                  <label htmlFor='registration-password'>Пароль</label>
                  <div className='inputShell'>
                    <img src={lock} alt='' />
                    <input
                      id='registration-password'
                      type={showRegistrationPassword ? 'text' : 'password'}
                      name='registration-password'
                      placeholder='Не менее 8 символов'
                      autoComplete='new-password'
                      minLength={8}
                      required
                      ref={registerPasswordRef}
                      aria-invalid={
                        registerAttempted && registerErrorField === 'password'
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        registerAttempted && registerErrorField === 'password'
                          ? 'registrationFormError'
                          : undefined
                      }
                      value={password}
                      onChange={event => {
                        setPassword(event.target.value)
                        clearRegisterFieldError('password')
                      }}
                    />
                    <button
                      className='passwordVisibility'
                      type='button'
                      aria-controls='registration-password'
                      aria-label={
                        showRegistrationPassword
                          ? 'Скрыть пароль'
                          : 'Показать пароль'
                      }
                      aria-pressed={showRegistrationPassword}
                      onClick={() =>
                        setShowRegistrationPassword(value => !value)
                      }
                    >
                      <img src={eye} alt='' />
                    </button>
                  </div>
                </div>

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
                    <span className='strength-hint'>
                      8+ символов, буквы и цифры
                    </span>
                  </div>
                </div>
                <div className='godOFcosentOption'>
                  <label className='consentOption'>
                    <input
                      type='checkbox'
                      checked={privacyPolicyAccepted}
                      ref={privacyConsentRef}
                      aria-required='true'
                      aria-invalid={
                        registerAttempted && !privacyPolicyAccepted
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        registerAttempted && !privacyPolicyAccepted
                          ? 'registrationFormError'
                          : undefined
                      }
                      onChange={event => {
                        setPrivacyPolicyAccepted(event.target.checked)
                        clearRegisterFieldError('consent')
                      }}
                    />
                    <span>
                      Даю отдельное согласие на обработку{' '}
                      <a
                        href={personalDataDocument}
                        target='_blank'
                        rel='noreferrer'
                      >
                        персональных данных
                      </a>
                    </span>
                  </label>
                  <label className='consentOption'>
                    <input
                      type='checkbox'
                      checked={termsAccepted}
                      ref={termsConsentRef}
                      aria-required='true'
                      aria-invalid={
                        registerAttempted && !termsAccepted
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        registerAttempted && !termsAccepted
                          ? 'registrationFormError'
                          : undefined
                      }
                      onChange={event => {
                        setTermsAccepted(event.target.checked)
                        clearRegisterFieldError('consent')
                      }}
                    />
                    <span>
                      Принимаю{' '}
                      <a href={termsDocument} target='_blank' rel='noreferrer'>
                        пользовательское соглашение
                      </a>
                    </span>
                  </label>
                  <p className='consentPolicyNotice'>
                    До регистрации ознакомьтесь с{' '}
                    <a
                      href={privacyPolicyDocument}
                      target='_blank'
                      rel='noreferrer'
                    >
                      Политикой обработки персональных данных
                    </a>
                    .
                  </p>
                  <div className='marketingConsent'>
                    <div className='marketingConsentHead'>
                      <img src={sparkles} alt='' />
                      <div>
                        <strong>Итоги недели и советы по уходу</strong>
                        <p className='marketingConsentBenefit'>
                          Раз в неделю пришлём, что полито и что пропущено, и
                          один совет по вашим растениям. Без спама — отписка в
                          один клик.
                        </p>
                      </div>
                    </div>
                    <label className='consentOption marketingConsentOption'>
                      <input
                        type='checkbox'
                        checked={marketingConsent}
                        onChange={event =>
                          setMarketingConsent(event.target.checked)
                        }
                      />
                      <span>Да, присылайте итоги недели и советы</span>
                    </label>
                    <p className='consentPolicyNotice'>
                      Необязательно: зарегистрироваться можно и без этого
                      согласия. Отписаться можно в любом письме — подробнее в{' '}
                      <a
                        href={privacyPolicyDocument}
                        target='_blank'
                        rel='noreferrer'
                      >
                        Политике
                      </a>
                      .
                    </p>
                  </div>
                </div>
                {formError && (
                  <p id='registrationFormError' className='formError' role='alert'>
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

              {guestChatAnswers > 0 && (
                <div className='registrationCarryNotice'>
                  <img src={sparkles} alt='' />
                  <div>
                    <strong>Ваши вопросы и диагноз сохранятся</strong>
                    <p>
                      {formatAnswersCount(guestChatAnswers)} из гостевого чата
                      перенесём в аккаунт — ничего не потеряется.
                    </p>
                  </div>
                </div>
              )}

              <div className='securityTransfer'>
                <img src={shieldcheck} alt='' />
                <span>Данные передаются по защищённому каналу</span>
              </div>

              <div className='formSwitch'>
                <span>Уже есть аккаунт?</span>
                <button
                  className='switch-btn'
                  type='button'
                  onClick={handleSwitch}
                >
                  Войти
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
      {showOnboarding && (
        <RegistrationOnboarding
          carriedChatAnswers={carriedChatAnswers}
          wantedPlantsCount={wantedPlantsCount}
          onFinish={finishOnboarding}
        />
      )}
    </main>
  )
}

export default Registration
