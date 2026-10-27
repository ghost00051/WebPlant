import { Link } from 'react-router-dom'
import ContentPage from '../ContentPage/ContentPage.jsx'
import Breadcrumbs from '../ContentPage/Breadcrumbs.jsx'
import { ARTICLES } from '../../data/careArticles.js'
import { CARE_PATH, CARE_INDEX_FAQ, articlePath } from '../../data/siteMap.js'

const START_LINKS = [
  {
    slug: 'kak-chasto-polivat',
    title: 'Как часто поливать',
    text: 'Ориентировочные интервалы для популярных растений и калькулятор с сезонной поправкой.'
  },
  {
    slug: 'kak-ponyat-pora-polivat',
    title: 'Как понять, что пора поливать',
    text: 'Проверка грунта, вес горшка и признаки перелива — без графика и календаря.'
  },
  {
    slug: 'pochemu-zhelteyut-listya',
    title: 'Почему желтеют листья',
    text: 'Пять частых причин пожелтения и что делать в каждом случае.'
  }
]

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

            <section className='contentSection' aria-labelledby='careStartTitle'>
                <h2 id='careStartTitle'>С чего начать</h2>
                <ul className='contentCardGrid'>
                    {START_LINKS.map(item => (
                        <li className='contentCard' key={item.slug}>
                            <h3><Link to={articlePath(item.slug)}>{item.title}</Link></h3>
                            <p>{item.text}</p>
                        </li>
                    ))}
                </ul>
            </section>

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

            <section className='contentSection' aria-labelledby='careFaqTitle'>
                <h2 id='careFaqTitle'>Частые вопросы</h2>
                <ul className='contentFaq'>
                    {CARE_INDEX_FAQ.map(item => (
                        <li key={item.question}>
                            <details>
                                <summary>{item.question}</summary>
                                <p>{item.answer}</p>
                            </details>
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
