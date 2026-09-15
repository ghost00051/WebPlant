import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './registration.css'
import './adaptiv.css'
import { useEffect } from 'react';


function Registration() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(false)
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [emailEntr, setEmailEntr] = useState('');
  const [passwordEntr, setPasswordEntr] = useState('');
  const navigate = useNavigate()


  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('https://server.checktheplants.ru/api/users/me', {
          method: 'GET',
          credentials: 'include'
        })
        if (response.ok) {
          navigate('/home')
        } else {
          console.log('Пользователь не авторизован')
        }
      } catch (error) {
        console.error('Ошибка проверки авторизации:', error)
      } finally {
      }
    }
    checkAuth()
  }, [navigate])

  const handleRegister = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch('https://server.checktheplants.ru/api/users/registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password,
          privacyPolicyAccepted: privacyPolicyAccepted,
          termsAccepted: termsAccepted
        }),
        credentials: 'include'
      })

      const responseData = await response.json()

      if (response.ok) {
        console.log(responseData)
        navigate('/home')
      } else {
        console.error(error)
      }
    } catch (error) {
      console.error('Registration error:', error)
      alert('Ошибка при регистрации. Проверьте консоль.')
    }
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch('https://server.checktheplants.ru/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailEntr, password: passwordEntr }),
        credentials: 'include'
      })

      console.log('Status:', response.status)
      console.log('OK:', response.ok)

      if (response.ok) {
        const data = await response.json()
        console.log('Login success:', data)
        navigate('/home')
      } else {
        const responseData = await response.json() 
        alert('Ошибка входа: ' + (responseData.message || 'Неверный email или пароль'))
      }
    } catch (error) {
      console.error('Login error:', error)
      alert('Ошибка при входе. Проверьте консоль.')
    }
  }

  const handleAcceptAll = async () => {
    setActive(false)
    try {
      const response = await fetch('https://server.checktheplants.ru/api/cookie-consents/all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          consents: [
            { consentType: 'technical', isAccepted: true },
            { consentType: 'analytics', isAccepted: true },
            { consentType: 'marketing', isAccepted: true },
            { consentType: 'personalization', isAccepted: true }
          ]
        }),
        credentials: 'include'
      })
      const data = await response.json()
      console.log('✅ Все согласия сохранены:', data)
    } catch (error) {
      console.error('❌ Ошибка:', error)
    }
  }

  const handleRejectAll = async () => {
    setActive(false)
    try {
      const response = await fetch('https://server.checktheplants.ru/api/cookie-consents/all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          consents: [
            { consentType: 'technical', isAccepted: true },
            { consentType: 'analytics', isAccepted: false },
            { consentType: 'marketing', isAccepted: false },
            { consentType: 'personalization', isAccepted: false }
          ]
        }),
        credentials: 'include'
      })
      const data = await response.json()
      console.log('Отказ от куких сохранен', data)
    } catch (error) {
      console.error('❌ Ошибка:', error)
    }
  }

  const handleSwitch = () => {
    setIsLogin(!isLogin)
  }


  useEffect(() => {
    const timer = setTimeout(() => {
      setActive(true)
    }, 1000);
    return () => clearTimeout(timer);
  }, [])


  return (
    <div className='blocksOfToService'>
      <div className='borderOther'>
        <div className='borderInner'>
          <div className={`slider-panel ${isLogin ? 'right' : 'left'}`}>
            {isLogin ? (
              <>
                <h2>Нет аккаунта?</h2>
                <p>Зарегистрируйтесь, чтобы получить доступ</p>
              </>
            ) : (
              <>
                <h2>Уже есть аккаунт?</h2>
                <p>Войдите, чтобы продолжить</p>
              </>
            )}
          </div>
          <div className='blocks-wrapper'>
            <div className='blocksOfEntrance'>
              <p className='headingEntr'>Вход</p>
              <form onSubmit={handleLogin}>
                <input
                  type='email'
                  placeholder='Email'
                  className='entranceEmail'
                  autoComplete='email'
                  required
                  onChange={(e) => setEmailEntr(e.target.value)}
                />
                <input
                  type='password'
                  placeholder='Пароль'
                  className='entrancePassword'
                  autoComplete='current-password'
                  required
                  onChange={(e) => setPasswordEntr(e.target.value)}
                />
                <button className='buttonEntrance' type='submit'>
                  Войти
                </button>
              </form>
              <div className='dontHaveAccount'>
                <p>Нету аккаунта?</p>
                <button className='switch-btn' onClick={handleSwitch}>
                  Зарегистрироваться
                </button>
              </div>
            </div>
            <div className='blocksRegistration'>
              <p className='headingRegistration'>Регистрация</p>
              <form onSubmit={handleRegister}>
                <input
                  type='email'
                  placeholder='Email'
                  className='registrationEmail'
                  autoComplete='email'
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  type='password'
                  placeholder='Пароль'
                  className='registrationPassword'
                  autoComplete='new-password'
                  onChange={(e) => setPassword(e.target.value)}
                />
                <input
                  type='password'
                  placeholder='Подтвердите пароль'
                  className='forceRegistrtrationPassword'
                  autoComplete='new-password'
                />
                <div className='personalData'>
                  <input
                    className='chekBoxPersonalData'
                    type="checkbox"
                    id="personalDataCheck"
                    checked={privacyPolicyAccepted}
                    onChange={(e) => setPrivacyPolicyAccepted(e.target.checked)}
                    required
                  />
                  <div>
                    <p>Согласие на обработку</p>
                    <a href="../../../document/UserAgreementTemplate.pdf" download="my-document.pdf">персональных данных</a>
                  </div>
                </div>
                <div className='userAgreement'>
                  <input
                    type="checkbox"
                    id="userAgreementCheck"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    required />
                  <div>
                    <a href="../../../document/soglasieNaObrabotkuPD.pdf" download="soglasieNaObrabotkuPD.pdf">Пользовательское соглашение</a>
                  </div>
                </div>
                <button className='buttonRegistration' type='submit'>
                  Зарегистрироваться
                </button>
              </form>
              <div className='haveAccount'>
                <p>Есть аккаунт?</p>
                <button className='switch-btn' onClick={handleSwitch}>
                  Войти
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={`cookies ${active ? 'active' : ''}`}>
        <p>Мы используем файлы cookie для улучшения работы сайта</p>
        <div className='buttonOfCookies'>
          <button className='cookiesGood' onClick={handleAcceptAll}>Принять все</button>
          <button className='cookiesFail' onClick={handleRejectAll}>Отказаться</button>
        </div>
      </div>
    </div>
  )
}

export default Registration
