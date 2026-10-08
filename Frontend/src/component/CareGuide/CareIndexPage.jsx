import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import { ARTICLES } from '../../data/careArticles.js'
import { CARE_PATH, articlePath } from '../../data/siteMap.js'

function CareIndexPage() {
    return (
        <ContentPage activePath={CARE_PATH}>
            <Breadcrumbs items={[{ label: 'Уход', path: CARE_PATH }]} />

            <div className='contentHero'>
                <h1>Уход за комнатными растениями</h1>
                <p className='contentLead'>
                    Практические руководства: как определить, что пора поливать,
                    почему желтеют листья, как оставить растения на время отпуска
                    и что делать при переливе.
                </p>
            </div>

            <section className='contentSection' aria-labelledby='careListTitle'>
                <h2 id='careListTitle'>Все статьи</h2>
                <ul className='contentCardGrid'>
                    {ARTICLES.map(article => (
                        <li className='contentCard' key={article.slug}>
                            <h3><Link to={articlePath(article.slug)}>{article.title}</Link></h3>
                            <p>{article.description}</p>
                        </li>
                    ))}
                </ul>
            </section>

            <div className='contentCta'>
                <p>
                    «Лейка» напомнит о поливе и сохранит историю ухода за каждым
                    растением — чтобы ничего не забывалось.
                </p>
                <Link to='/register'>Попробовать «Лейку»</Link>
            </div>
        </ContentPage>
    )
}

export default CareIndexPage
