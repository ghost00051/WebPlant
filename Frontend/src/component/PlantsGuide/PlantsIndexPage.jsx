import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import { PLANTS } from '../../data/plants.js'
import { PLANTS_PATH, plantPath } from '../../data/siteMap.js'

function PlantsIndexPage() {
    return (
        <ContentPage activePath={PLANTS_PATH}>
            <Breadcrumbs items={[{ label: 'Справочник растений', path: PLANTS_PATH }]} />

            <div className='contentHero'>
                <h1>Комнатные растения: полив и уход</h1>
                <p className='contentLead'>
                    Ориентировочная частота полива, требования к свету и влажности,
                    а также типичные проблемы и что с ними делать. Значения
                    ориентировочные: точный режим зависит от освещения, температуры
                    и размера горшка.
                </p>
            </div>

            <section className='contentSection' aria-labelledby='plantsListTitle'>
                <h2 id='plantsListTitle'>Растения в справочнике</h2>
                <ul className='contentCardGrid'>
                    {PLANTS.map(plant => (
                        <li className='contentCard' key={plant.slug}>
                            <h3><Link to={plantPath(plant.slug)}>{plant.name}</Link></h3>
                            <p className='contentCardLatin'>{plant.latin}</p>
                            <ul className='contentCardFacts'>
                                <li><strong>Полив:</strong> {plant.intervalLabel}</li>
                                <li><strong>Свет:</strong> {plant.light}</li>
                            </ul>
                        </li>
                    ))}
                </ul>
            </section>

            <section className='contentSection' aria-labelledby='plantsHowTitle'>
                <h2 id='plantsHowTitle'>Как пользоваться справочником</h2>
                <p>
                    Начните с ориентировочного интервала полива, а затем скорректируйте
                    его под свои условия: на свету и в тепле грунт просыхает быстрее,
                    в тени и в большом горшке — медленнее. Перед каждым поливом
                    проверяйте, просох ли верхний слой земли.
                </p>
                <p>
                    Приложение «Лейка» хранит отдельный интервал и время напоминания
                    для каждого растения, отмечает выполненный полив и показывает
                    расписание в календаре.
                </p>
            </section>

            <div className='contentCta'>
                <p>
                    Заведите карточку для каждого растения: «Лейка» напомнит о поливе
                    и сохранит историю ухода.
                </p>
                <Link to='/register'>Начать бесплатно</Link>
            </div>
        </ContentPage>
    )
}

export default PlantsIndexPage
