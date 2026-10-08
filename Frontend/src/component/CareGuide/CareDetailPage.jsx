import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import NotFound from '../ContentPage/NotFound.jsx'
import { ARTICLES, getArticleBySlug } from '../../data/careArticles.js'
import { CARE_PATH, articlePath } from '../../data/siteMap.js'

const MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

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
    const related = ARTICLES.filter(item => item.slug !== article.slug).slice(0, 3)

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
                {updated && <p className='contentUpdated'>Обновлено {updated}</p>}
                <p className='contentLead'>{article.intro}</p>
            </div>

            {article.sections.map(section => (
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

            {article.faq?.length > 0 && (
                <section className='contentSection' aria-labelledby='articleFaqTitle'>
                    <h2 id='articleFaqTitle'>Частые вопросы</h2>
                    <ul className='contentFaq'>
                        {article.faq.map(item => (
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
