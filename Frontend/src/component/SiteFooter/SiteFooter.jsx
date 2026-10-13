import { Link } from 'react-router-dom'
import { ARTICLE_NAV, PLANT_NAV } from '../../data/seoMeta.js'
import { articlePath, plantPath } from '../../data/siteMap.js'
import { FEEDBACK_EMAIL, FEEDBACK_MAILTO } from '../../utils/feedback.js'
import './SiteFooter.css'

const FOOTER_PLANTS = PLANT_NAV.slice(0, 6)
const FOOTER_ARTICLES = ARTICLE_NAV.slice(0, 5)

function SiteFooter() {
    return (
        <footer className='siteFooter'>
            <div className='siteFooterColumns'>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Растения</p>
                    <ul>
                        {FOOTER_PLANTS.map(plant => (
                            <li key={plant.slug}>
                                <Link to={plantPath(plant.slug)}>{plant.name}</Link>
                            </li>
                        ))}
                        <li><Link to='/plants'>Все растения</Link></li>
                    </ul>
                </div>
                <div className='siteFooterColumn'>
                    <p className='siteFooterTitle'>Уход</p>
                    <ul>
                        {FOOTER_ARTICLES.map(article => (
                            <li key={article.slug}>
                                <Link to={articlePath(article.slug)}>{article.title}</Link>
                            </li>
                        ))}
                        <li><Link to='/care'>Все статьи</Link></li>
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
            </div>
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
