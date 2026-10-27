import { Link } from 'react-router-dom'
import './PlantFollowCta.css'

const CARE_FREQUENCY_PATH = '/care/kak-chasto-polivat'

function PlantFollowCta({ plant }) {
    const interval = plant.intervalLabel || 'индивидуальный интервал'

    return (
        <section className='plantFollow' aria-labelledby='plantFollowTitle'>
            <div className='plantFollowBody'>
                <h2 className='plantFollowTitle' id='plantFollowTitle'>Следить за этим растением</h2>
                <p className='plantFollowLead'>
                    Добавьте {plant.name} в «Лейку»: приложение подставит интервал {interval}
                    и напомнит, когда пора поливать. Интервал можно поправить под свои условия.
                </p>
                <ul className='plantFollowList'>
                    <li>Напоминание о поливе в удобное время</li>
                    <li>История ухода и заметки по растению</li>
                    <li>Сезонная поправка: зимой реже, летом чаще</li>
                </ul>
            </div>
            <div className='plantFollowActions'>
                <Link className='plantFollowPrimary' to='/register'>
                    Следить за этим растением
                </Link>
                <p className='plantFollowNote'>
                    Аккаунт бесплатный: растения, график и напоминания сохраняются в вашем саду.
                </p>
                <Link className='plantFollowSecondary' to={CARE_FREQUENCY_PATH}>
                    Пока почитать, как часто поливать
                </Link>
            </div>
        </section>
    )
}

export default PlantFollowCta
