import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import NotFound from '../ContentPage/NotFound.jsx'
import { getPlantBySlug } from '../../data/plants.js'
import {
    PLANTS_PATH,
    plantPath,
    articlePath,
    getPlantArticles,
    getRelatedPlants
} from '../../data/siteMap.js'

function textOf(value) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string') {
        return value.text
    }
    return null
}

function listOf(value) {
    if (!Array.isArray(value)) return []
    return value.map(textOf).filter(Boolean)
}

function PlantFieldSection({ id, title, value }) {
    const text = textOf(value)
    const items = listOf(value)
    if (!text && items.length === 0) return null

    return (
        <section className='contentSection' aria-labelledby={id}>
            <h2 id={id}>{title}</h2>
            {text && <p>{text}</p>}
            {items.length > 0 && (
                <ul>
                    {items.map(item => <li key={item.slice(0, 32)}>{item}</li>)}
                </ul>
            )}
        </section>
    )
}

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

    const relatedPlants = getRelatedPlants(plant.slug, 3)
    const relatedArticles = getPlantArticles(plant.slug, 3)
    const problems = Array.isArray(plant.problems) ? plant.problems : []
    const faq = Array.isArray(plant.faq)
        ? plant.faq.filter(item => item && item.question && item.answer)
        : []

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
                {plant.image && (
                    <img
                        className='contentLead'
                        src={plant.image}
                        alt={plant.imageAlt || plant.name}
                        width={800}
                        height={600}
                        loading='lazy'
                        decoding='async'
                        style={{ maxWidth: '100%', height: 'auto', filter: 'none' }}
                    />
                )}
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

            <PlantFieldSection id='plantSoilTitle' title='Грунт' value={plant.soil} />

            <PlantFieldSection id='plantSeasonalTitle' title='Сезонный уход' value={plant.seasonal} />

            <PlantFieldSection id='plantPestsTitle' title='Вредители и болезни' value={plant.pests} />

            {problems.length > 0 && (
                <section className='contentSection' aria-labelledby='plantProblemsTitle'>
                    <h2 id='plantProblemsTitle'>Частые проблемы</h2>
                    {problems.map(problem => (
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
            )}

            <PlantFieldSection id='plantNoteTitle' title='На заметку' value={plant.note} />

            {faq.length > 0 && (
                <section className='contentSection' aria-labelledby='plantFaqTitle'>
                    <h2 id='plantFaqTitle'>Частые вопросы</h2>
                    <ul className='contentFaq'>
                        {faq.map(item => (
                            <li key={item.question}>
                                <details>
                                    <summary>{item.question}</summary>
                                    <p>{item.answer}</p>
                                </details>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {relatedPlants.length > 0 && (
                <section className='contentSection' aria-labelledby='plantOthersTitle'>
                    <h2 id='plantOthersTitle'>Другие растения</h2>
                    <ul className='contentCardGrid'>
                        {relatedPlants.map(item => (
                            <li className='contentCard' key={item.slug}>
                                <h3><Link to={plantPath(item.slug)}>{item.name}</Link></h3>
                                <p className='contentCardLatin'>{item.latin}</p>
                                <ul className='contentCardFacts'>
                                    <li><strong>Полив:</strong> {item.intervalLabel}</li>
                                    {item.light && <li><strong>Свет:</strong> {item.light}</li>}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {relatedArticles.length > 0 && (
                <section className='contentSection' aria-labelledby='plantArticlesTitle'>
                    <h2 id='plantArticlesTitle'>Статьи по теме</h2>
                    <ul>
                        {relatedArticles.map(item => (
                            <li key={item.slug}>
                                <Link to={articlePath(item.slug)}>{item.title}</Link>
                                {item.description ? ` — ${item.description}` : ''}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className='contentCta'>
                <p>
                    Добавьте в «Лейку»: {plant.name} — приложение подскажет,
                    когда пора поливать, и напомнит об уходе.
                </p>
                <Link to='/register'>Создать аккаунт</Link>
            </div>
        </ContentPage>
    )
}

export default PlantsDetailPage
