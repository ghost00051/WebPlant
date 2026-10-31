import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import NotFound from '../ContentPage/NotFound.jsx'
import WateringCalculator from './WateringCalculator.jsx'
import PhotoDiagnosisCta from './PhotoDiagnosisCta.jsx'
import { getArticleBySlug } from '../../data/careArticles.js'
import {
    CARE_PATH,
    articlePath,
    plantPath,
    getRelatedArticles,
    getArticlePlants
} from '../../data/siteMap.js'

const MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

const CALCULATOR_SLUG = 'kak-chasto-polivat'
const PHOTO_DIAGNOSIS_SLUG = 'pochemu-zhelteyut-listya'

function formatUpdated(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
    if (!match) return null
    const month = MONTHS_GENITIVE[Number(match[2]) - 1]
    if (!month) return null
    return `${Number(match[3])} ${month} ${match[1]}`
}

function CareDetailPage({ slug }) {
    const article = getArticleBySlug(slug)

    if (!article) {
        return (
            <ContentPage activePath={CARE_PATH}>
                <NotFound
                    backPath={CARE_PATH}
                    backLabel='К списку статей'
                    message='Такой статьи нет. Откройте список материалов раздела «Уход».'
                />
            </ContentPage>
        )
    }

    const updated = formatUpdated(article.updated)
    const related = getRelatedArticles(article.slug, 3)
    const relatedPlants = getArticlePlants(article.slug, 3)
    const sections = Array.isArray(article.sections) ? article.sections : []
    const faq = Array.isArray(article.faq)
        ? article.faq.filter(item => item && item.question && item.answer)
        : []

    return (
        <ContentPage activePath={CARE_PATH}>
            <Breadcrumbs
                items={[
                    { label: 'Уход', path: CARE_PATH },
                    { label: article.title }
                ]}
            />

            <div className='contentHero'>
                <h1>{article.title}</h1>
                <p className='contentUpdated'>
                    Автор: Никитин Иван Сергеевич{updated ? ` · Обновлено ${updated}` : ''}
                </p>
                <p className='contentLead'>{article.intro}</p>
            </div>

            {sections.map(section => (
                <section className='contentSection' key={section.heading}>
                    <h2>{section.heading}</h2>
                    {section.paragraphs?.map(paragraph => (
                        <p key={paragraph.slice(0, 32)}>{paragraph}</p>
                    ))}
                    {section.list && (
                        <ul>
                            {section.list.map(item => <li key={item.slice(0, 32)}>{item}</li>)}
                        </ul>
                    )}
                </section>
            ))}

            {article.slug === CALCULATOR_SLUG && <WateringCalculator />}

            {article.slug === PHOTO_DIAGNOSIS_SLUG && <PhotoDiagnosisCta />}

            {faq.length > 0 && (
                <section className='contentSection' aria-labelledby='articleFaqTitle'>
                    <h2 id='articleFaqTitle'>Частые вопросы</h2>
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
                <section className='contentSection' aria-labelledby='articlePlantsTitle'>
                    <h2 id='articlePlantsTitle'>Растения из статьи</h2>
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

            {related.length > 0 && (
                <section className='contentSection' aria-labelledby='articleRelatedTitle'>
                    <h2 id='articleRelatedTitle'>Читайте также</h2>
                    <ul className='contentCardGrid'>
                        {related.map(item => (
                            <li className='contentCard' key={item.slug}>
                                <h3><Link to={articlePath(item.slug)}>{item.title}</Link></h3>
                                <p>{item.description}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className='contentCta'>
                <p>
                    «Лейка» собирает расписание полива по каждому растению
                    и напоминает об уходе.
                </p>
                <Link to='/register'>Начать бесплатно</Link>
            </div>
        </ContentPage>
    )
}

export default CareDetailPage
