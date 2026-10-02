import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AddPlants from './addPlants.jsx'
import BackBtn from '../../assets/BackBtn.svg'
import './AddPlantPage.css'

const API_URL = import.meta.env.VITE_API_URL ||
    'https://server.checktheplants.ru/api'

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
                    navigate('/', { replace: true })
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

        return () => {
            isMounted = false
        }
    }, [navigate])

    if (hasAuthError) {
        return <p className='addPlantPageStatus' role='alert'>Не удалось проверить вход. Обновите страницу и попробуйте ещё раз.</p>
    }

    if (!isAuthorized) {
        return <p className='addPlantPageStatus' role='status'>Проверка входа...</p>
    }

    return (
        <main className='addPlantPage'>
            <header className='addPlantPageHeader'>
                <button type='button' onClick={() => navigate('/home')} aria-label='Вернуться на главную'>
                    <img src={BackBtn} alt='' />
                </button>
                <span>Добавить растение</span>
            </header>
            <AddPlants />
        </main>
    )
}

export default AddPlantPage
