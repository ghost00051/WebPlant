import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AddPlants from './addPlants.jsx'
import BackBtn from '../../assets/BackBtn.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'
import './AddPlantPage.css'
import './adaptiv.css'
import './dark-theme.css'


function AddPlantPage() {
    const navigate = useNavigate()
    const [isAuthorized, setIsAuthorized] = useState(false)
    const [hasAuthError, setHasAuthError] = useState(false)

    useEffect(() => {
        let isMounted = true

        fetch(`${API_URL}/users/me`, { credentials: 'include' })
            .then(response => {
                if (!isMounted) return
                if (response.status === 401 || response.status === 404) {
                    navigate('/login', { replace: true })
                    return
                }
                if (!response.ok) {
                    throw new Error(`Ошибка проверки авторизации: HTTP ${response.status}`)
                }
                if (isMounted) setIsAuthorized(true)
            })
            .catch(error => {
                console.error('Ошибка проверки авторизации страницы добавления растения:', error)
                if (isMounted) setHasAuthError(true)
            })

        return () => { isMounted = false }
    }, [navigate])

    if (hasAuthError) {
        return (
            <main className='addPlantPage'>
                <p className='addPlantPageStatus' role='alert'>
                    Не удалось проверить вход. Обновите страницу и попробуйте ещё раз.
                </p>
            </main>
        )
    }

    if (!isAuthorized) {
        return (
            <main className='addPlantPage'>
                <p className='addPlantPageStatus' role='status'>
                    Проверка входа...
                </p>
            </main>
        )
    }

    return (
        <main className='addPlantPage'>
            <header className='addPlantPageHeader'>
                <button
                    type='button'
                    onClick={() => navigate('/home')}
                    aria-label='Вернуться на главную'
                >
                    <ThemedIcon src={BackBtn} alt='' />
                </button>
                <h1 className='addPlantPageTitle'>Добавить растение</h1>
            </header>
            <AddPlants />
        </main>
    )
}

export default AddPlantPage