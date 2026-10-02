import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './profile.css'
import Pencil from '../../assets/pencil.svg'
import {
    isPasskeySupported,
    listPasskeys,
    registerPasskey
} from '../../utils/passkey.js'

function Profile() {
    const [profile, setProfile] = useState(null)
    const [plant, setPlant] = useState()
    const [history, setHistory] = useState()
    const [completion, setCompletion] = useState(null)
    const [passkeyCount, setPasskeyCount] = useState(null)
    const [passkeySupported, setPasskeySupported] = useState(false)
    const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)
    const [passkeyMessage, setPasskeyMessage] = useState('')
    const [passkeyError, setPasskeyError] = useState('')

    const getProfile = useCallback(async () => {
        try {
            const response = await fetch(
                'https://server.checktheplants.ru/api/users/me',
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                setProfile(data)
            }
        } catch (error) {
            console.error('Ошибка получения профиля:', error)
        }
    }, [])

    const getAllPlant = useCallback(async () => {
        try {
            const response = await fetch(
                'https://server.checktheplants.ru/api/plants/',
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                const arr = data.length
                setPlant(arr)
            }
        } catch (error) {
            console.error('Ошибка получения расписания:', error)
        }
    }, [])

    const getPlantHistory = useCallback(async () => {
        try {
            const response = await fetch(
                `https://server.checktheplants.ru/api/plants/history`,
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()

                const totalWaterings = data.items.reduce(
                    (sum, day) => sum + (day.plants?.length ?? 0),
                    0
                )
                setHistory(totalWaterings)
            }
        } catch (error) {
            console.error('Ошибка получения истории:', error)
        }
    }, [])

    const getCompletion = useCallback(async () => {
        try {
            const res = await fetch(
                'https://server.checktheplants.ru/api/plants/stats/completion',
                { method: 'GET', credentials: 'include' }
            )
            if (res.ok) {
                const data = await res.json()
                setCompletion(data)
            }
        } catch (e) {
            console.error('Ошибка completion:', e)
        }
    }, [])

    useEffect(() => {
        getProfile()
        getAllPlant()
        getPlantHistory()
        getCompletion()
    }, [getProfile, getAllPlant, getPlantHistory, getCompletion])

    useEffect(() => {
        let isMounted = true

        listPasskeys()
            .then(registeredPasskeys => {
                if (isMounted) setPasskeyCount(registeredPasskeys.length)
            })
            .catch(error => {
                if (!isMounted) return
                console.error('Ошибка загрузки ключей доступа:', error)
                setPasskeyError('Не удалось загрузить ключи доступа. Обновите страницу и попробуйте ещё раз.')
            })

        isPasskeySupported().then(supported => {
            if (isMounted) setPasskeySupported(supported)
        })

        return () => {
            isMounted = false
        }
    }, [])

    const handleRegisterPasskey = async () => {
        if (isRegisteringPasskey) return

        setIsRegisteringPasskey(true)
        setPasskeyError('')
        setPasskeyMessage('')

        try {
            await registerPasskey('Ключ доступа')
            setPasskeyCount(count => (count ?? 0) + 1)
            setPasskeyMessage('Ключ доступа создан. Теперь с его помощью можно входить в аккаунт.')
        } catch (error) {
            console.error('Ошибка создания ключа доступа:', error)
            setPasskeyError(error.message || 'Не удалось создать ключ доступа. Попробуйте ещё раз.')
        } finally {
            setIsRegisteringPasskey(false)
        }
    }

    if (!profile) {
        return <p>Загрузка...</p>
    }

    return (
        <div>
            <div className='headerBlocskProfils'>
                <p>Личный кабинет</p>
            </div>
            <div className='blocksDescriptionProfile'>
                <div className='nameBlocksDescriptionProfile'>
                    <div className='imgOfName'>
                        <p>{profile.name[0]}</p>
                    </div>
                    <div className='descritpionOfProfile'>
                        <p>{profile.name}</p>
                        <p>{profile.email}</p>
                    </div>
                </div>
                <Link to="/edit-profile" className='buttonOfEdProfile'>
                    <img src={Pencil} alt="" />
                    <p>Редактировать профиль</p>
                </Link>
            </div>
            <section className='passkeySettings' aria-labelledby='passkeySettingsTitle'>
                <h2 id='passkeySettingsTitle'>Вход с ключом доступа</h2>
                {passkeyError && <p className='passkeyMessage passkeyError' role='alert'>{passkeyError}</p>}
                {passkeyMessage && <p className='passkeyMessage' role='status'>{passkeyMessage}</p>}
                {passkeyCount === null ? (
                    !passkeyError && <p className='passkeyStatus'>Проверяем сохранённые ключи доступа...</p>
                ) : passkeyCount > 0 ? (
                    <p className='passkeyStatus'>
                        Ключ доступа уже добавлен. При следующем входе можно подтвердить личность Face ID, отпечатком пальца или способом, который предлагает устройство.
                    </p>
                ) : !passkeySupported ? (
                    <p className='passkeyStatus'>
                        Создание ключа доступа доступно на поддерживаемом устройстве и через защищённое HTTPS-соединение.
                    </p>
                ) : (
                    <>
                        <p className='passkeyStatus'>
                            Ключ ещё не создан. Добавьте его на этом устройстве, чтобы использовать биометрию или другой доступный способ подтверждения при входе.
                        </p>
                        <button
                            type='button'
                            className='passkeyCreateButton'
                            disabled={isRegisteringPasskey}
                            onClick={handleRegisterPasskey}
                        >
                            {isRegisteringPasskey ? 'Создание ключа...' : 'Создать ключ доступа'}
                        </button>
                    </>
                )}
            </section>
            <div className='informationOfProfile'>
                <div className='plantQuantity'>
                    <p>{plant}</p>
                    <p>Растений</p>
                </div>
                <div className='historyWaterPlant'>
                    <p>{history}</p>
                    <p>Поливов за месяц</p>
                </div>
                <div className='interestPlant'>
                    {completion && <p>{completion.percent}%</p>}
                    <p>Поливов вовремя</p>
                </div>
            </div>
            <div>
                <div>
                    <p>Мои растения</p>
                    <Link to="/my-plants" className='buttonOfPlant'>
                        <p>Все</p>
                    </Link>
                </div>
                <div>
                    {/* {plant.map(plan =>{
                        return(
                            <p>{plant}</p>
                        )
                    })} */}
                </div>
            </div>
        </div>
    )
}

export default Profile