import { Link } from 'react-router-dom'
import { ARTICLE_NAV, PLANT_NAV } from '../../data/seoMeta.js'
import { articlePath, plantPath } from '../../data/siteMap.js'
import { FEEDBACK_EMAIL, FEEDBACK_MAILTO } from '../../utils/feedback.js'
import './SiteFooter.css'

const FOOTER_ARTICLES_MAIN = ARTICLE_NAV.slice(0, 6)
const FOOTER_ARTICLES_MORE = ARTICLE_NAV.slice(6)

function SiteFooter() {
    return (
        <footer className='siteFooter'>
            <nav className='siteFooterColumns' aria-label='Карта сайта'>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Растения</p>
                    <ul>
                        {PLANT_NAV.map(plant => (
                            <li key={plant.slug}>
                                <Link to={plantPath(plant.slug)}>{plant.name}</Link>
                            </li>
                        ))}
                        <li><Link to='/plants'>Все растения</Link></li>
                    </ul>
                </div>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Полив и уход</p>
                    <ul>
                        {FOOTER_ARTICLES_MAIN.map(article => (
                            <li key={article.slug}>
                                <Link to={articlePath(article.slug)}>{article.title}</Link>
                            </li>
                        ))}
                        <li><Link to='/care'>Все статьи</Link></li>
                    </ul>
                </div>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Ещё по уходу</p>
                    <ul>
                        {FOOTER_ARTICLES_MORE.map(article => (
                            <li key={article.slug}>
                                <Link to={articlePath(article.slug)}>{article.title}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Приложение</p>
                    <ul>
                        <li><Link to='/'>О «Лейке»</Link></li>
                        <li><Link to='/register'>Создать аккаунт</Link></li>
                        <li><Link to='/login'>Войти</Link></li>
                    </ul>
                </div>
            </nav>
            <div className='siteFooterBottom'>
                <span>
                    Лейка · Забота о растениях без лишней суеты
                    <small>Создатель сайта — Никитин Иван Сергеевич</small>
                </span>
                <p className='siteFooterFeedback'>
                    Нашли баг или хотите предложить что-то своё? Напишите на{' '}
                    <a href={FEEDBACK_MAILTO}>{FEEDBACK_EMAIL}</a> — с уважением, разработчик Иван.
                </p>
            </div>
        </footer>
    )
}

export default SiteFooter
