import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import NotFound from '../ContentPage/NotFound.jsx'
import { getPlantBySlug, PLANTS } from '../../data/plants.js'
import { PLANTS_PATH, plantPath } from '../../data/siteMap.js'

function PlantsDetailPage({ slug }) {
    const plant = getPlantBySlug(slug)

    if (!plant) {
        return (
            <ContentPage activePath={PLANTS_PATH}>
                <NotFound
                    backPath={PLANTS_PATH}
                    backLabel='К списку растений'
                    message='Такой карточки нет в справочнике. Посмотрите список доступных растений.'
                />
            </ContentPage>
        )
    }

    const others = PLANTS.filter(item => item.slug !== plant.slug).slice(0, 4)

    return (
        <ContentPage activePath={PLANTS_PATH}>
            <Breadcrumbs
                items={[
                    { label: 'Справочник растений', path: PLANTS_PATH },
                    { label: plant.name }
                ]}
            />

            <div className='contentHero'>
                <h1>{plant.name}: полив и уход</h1>
                <p className='contentLead'>{plant.latin}</p>
            </div>

            <section className='contentSection' aria-labelledby='plantFactsTitle'>
                <h2 id='plantFactsTitle'>Коротко о главном</h2>
                <dl className='contentFacts'>
                    <div className='contentFact'>
                        <dt>Полив</dt>
                        <dd>{plant.intervalLabel}</dd>
                    </div>
                    <div className='contentFact'>
                        <dt>Свет</dt>
                        <dd>{plant.light}</dd>
                    </div>
                    <div className='contentFact'>
                        <dt>Влажность</dt>
                        <dd>{plant.humidity}</dd>
                    </div>
                </dl>
            </section>

            <section className='contentSection' aria-labelledby='plantLightTitle'>
                <h2 id='plantLightTitle'>Освещение</h2>
                <p>{plant.lightDetail}</p>
            </section>

            <section className='contentSection' aria-labelledby='plantWaterTitle'>
                <h2 id='plantWaterTitle'>Полив</h2>
                <p>{plant.watering}</p>
            </section>

            <section className='contentSection' aria-labelledby='plantProblemsTitle'>
                <h2 id='plantProblemsTitle'>Частые проблемы</h2>
                {plant.problems.map(problem => (
                    <div className='contentProblem' key={problem.title}>
                        <h3>{problem.title}</h3>
                        <dl>
                            <dt>Причина</dt>
                            <dd>{problem.reason}</dd>
                            <dt>Что делать</dt>
                            <dd>{problem.action}</dd>
                        </dl>
                    </div>
                ))}
            </section>

            <section className='contentSection' aria-labelledby='plantOthersTitle'>
                <h2 id='plantOthersTitle'>Другие растения</h2>
                <ul className='contentCardGrid'>
                    {others.map(item => (
                        <li className='contentCard' key={item.slug}>
                            <h3><Link to={plantPath(item.slug)}>{item.name}</Link></h3>
                            <p className='contentCardLatin'>{item.latin}</p>
                            <ul className='contentCardFacts'>
                                <li><strong>Полив:</strong> {item.intervalLabel}</li>
                            </ul>
                        </li>
                    ))}
                </ul>
            </section>

            <div className='contentCta'>
                <p>
                    Добавьте {plant.name.toLowerCase()} в «Лейку» — приложение подскажет,
                    когда пора поливать, и напомнит об уходе.
                </p>
                <Link to='/register'>Создать аккаунт</Link>
            </div>
        </ContentPage>
    )
}

export default PlantsDetailPage
