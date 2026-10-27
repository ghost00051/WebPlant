import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AddPlants from './addPlants.jsx'
import MultiAddPlants from './MultiAddPlants.jsx'
import BackBtn from '../../assets/BackBtn.svg'
import plus from '../../assets/plus.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'
import './AddPlantPage.css'
import './adaptiv.css'
import './dark-theme.css'


function AddPlantPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [isAuthorized, setIsAuthorized] = useState(false)
    const [hasAuthError, setHasAuthError] = useState(false)
    const [isMultiAddOpen, setIsMultiAddOpen] = useState(
        () => searchParams.get('multi') === '1'
    )

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
                <div className='addPlantPageHeaderTop'>
                    <button
                        type='button'
                        onClick={() => navigate('/home')}
                        aria-label='Вернуться на главную'
                    >
                        <ThemedIcon src={BackBtn} alt='' />
                    </button>
                    <h1 className='addPlantPageTitle'>Добавить растение</h1>
                </div>
                <button
                    type='button'
                    className='addPlantPageMultiButton'
                    onClick={() => setIsMultiAddOpen(true)}
                >
                    <img src={plus} alt='' aria-hidden='true' />
                    <span>Добавить сразу несколько</span>
                </button>
            </header>
            <AddPlants key={searchParams.toString()} />
            <MultiAddPlants open={isMultiAddOpen} onClose={() => setIsMultiAddOpen(false)} />
        </main>
    )
}

export default AddPlantPage
