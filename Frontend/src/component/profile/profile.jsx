import Pencil from '../../assets/pencil.svg'
import { useCallback, useEffect, useState } from 'react'
import './profile.css'

function Profile() {
    const [profile, setProfile] = useState(null)
    const [plant, setPlant] = useState()
    const [history, setHistory] = useState()
    const [completion, setCompletion] = useState(null)

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
                // console.log(arr)
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
                <div className='buttonOfEdProfile'>

                    <img src={Pencil} alt="" />
                    <p>Редактировать профиль</p>
                </div>
            </div>
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
        </div>
    )
}

export default Profile