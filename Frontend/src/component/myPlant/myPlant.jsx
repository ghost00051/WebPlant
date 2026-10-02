import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import BackBtn from '../../assets/BackBtn.svg'
import './myPlant.css'
import search from '../../assets/search.svg'
import xcircle from '../../assets/x-circle.svg'

function MyPlant() {
    const navigate = useNavigate()
    const [plant, setPlant] = useState([])
    const [searchQuery, setSearchQuery] = useState('')

    const getAllPlant = useCallback(async () => {
        try {
            const response = await fetch(
                'https://server.checktheplants.ru/api/plants/',
                { method: 'GET', credentials: 'include' }
            )
            if (response.ok) {
                const data = await response.json()
                setPlant(data)
            }
        } catch (error) {
            console.error('Ошибка получения растений:', error)
        }
    }, [])

    const plantDelete = async plantId => {
        try {
            const response = await fetch(
                `https://server.checktheplants.ru/api/plants/${plantId}`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                    credentials: 'include'
                }
            )

            if (!response.ok) {
                console.log('Ошибка удаления')
            }

            if (response.ok) {
                console.log('Все гуд')
                setPlant(prev => prev.filter(p => p.id !== plantId))
            }
        } catch (error) {
            console.error('Ошибка удаления:', error)
        }
    }

    useEffect(() => {
        getAllPlant()
    }, [getAllPlant])

    const filteredPlants = plant.filter(p =>
        p.name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )

    return (
        <div className='gofOfMyplants'>
            <div className='headerOfPlants'>
                <img
                    src={BackBtn}
                    alt="Назад"
                    onClick={() => navigate(-1)}
                    style={{ cursor: 'pointer' }}
                />
                <p>Мои растения</p>
            </div>

            <div className='searchButton'>
                <div className='childOfsearchButton'>
                    <img src={search} alt="" />
                    <input
                        type="text"
                        placeholder="Поиск..."
                        className='searchPlaceholder'
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>

                {searchQuery && (
                    <img
                        src={xcircle}
                        alt="Очистить"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSearchQuery('')}
                    />
                )}
            </div>

            <div className='gridBlocksOfPlant'>
                {filteredPlants.map(p => (
                    <div key={p.id}>
                        <div className='plantRenderOfPants'>
                            <p>{p.name}</p>
                            <p>{p.species}</p>
                            <div className='buttonEditPlants'>
                                <button>Изменить</button>
                                <button
                                    type='button'
                                    onClick={() => plantDelete(p.id)}
                                >Удалить</button>
                            </div>
                        </div>
                    </div>
                ))}

                {filteredPlants.length === 0 && (
                    <p style={{ gridColumn: '1 / -1' }}>
                        Ничего не найдено
                    </p>
                )}
            </div>
        </div>
    )
}

export default MyPlant