import { Link } from 'react-router-dom'
import LogoMark from '../../assets/LogoMark.svg'
import PwaInstallHint from '../PwaInstallHint/PwaInstallHint.jsx'
import SiteFooter from '../SiteFooter/SiteFooter.jsx'
import { ARTICLE_NAV, PLANT_NAV } from '../../data/seoMeta.js'
import { CARE_PATH, PLANTS_PATH, articlePath, plantPath } from '../../data/siteMap.js'
import './landingPage.css'
import './dark-theme.css'

const FEATURES = [
    {
        number: '01',
        title: 'График для каждого растения',
        description: 'Укажите интервал полива и удобное время. Расписание будет собрано в одном месте.'
    },
    {
        number: '02',
        title: 'Календарь и напоминания',
        description: 'Смотрите, что нужно полить сегодня и в ближайшие дни, и отмечайте выполненный полив.'
    },
    {
        number: '03',
        title: 'Помощь ИИ по уходу',
        description: 'Задавайте вопросы об уходе и получайте ориентиры с учётом ваших растений.'
    }
]

const FAQ = [
    {
        question: 'Как не забывать поливать комнатные растения?',
        answer: 'Добавьте растение, задайте интервал полива и включите уведомления. Календарь покажет, за какими растениями пора ухаживать.'
    },
    {
        question: 'Можно ли вести расписание для разных растений?',
        answer: 'Да. Для каждого растения можно задать собственную частоту полива, время и дни напоминаний.'
    },
    {
        question: 'Как понять, когда поливать незнакомое растение?',
        answer: 'Спросите ИИ-помощника «Лейки»: он подскажет ориентировочный график ухода, который можно настроить под условия дома.'
    }
]

const GUIDE_PLANTS = PLANT_NAV.slice(0, 5)
const GUIDE_ARTICLES = ARTICLE_NAV.slice(0, 3)

function LandingPage() {
    return (
        <div className='landingPage'>
            <header className='landingHeader'>
                <Link className='landingBrand' to='/' aria-label='Лейка — главная'>
                    <img src={LogoMark} alt='' />
                    <span>Лейка</span>
                </Link>
                <nav className='landingHeaderNav' aria-label='Разделы сайта'>
                    <Link to={PLANTS_PATH}>Справочник растений</Link>
                    <Link to={CARE_PATH}>Уход</Link>
                </nav>
                <Link className='landingLoginLink' to='/login'>Войти</Link>
            </header>

            <PwaInstallHint />

            <main>
                <section className='landingHero' aria-labelledby='landingTitle'>
                    <div className='landingHeroContent'>
                        <p className='landingEyebrow'>Спокойный уход за растениями</p>
                        <h1 id='landingTitle'>Помните о поливе.<br />Наслаждайтесь ростом.</h1>
                        <p className='landingSubtitle'>
                            Календарь полива и уход за комнатными растениями в одном приложении:
                            своё расписание для каждого растения, напоминания и подсказки ИИ.
                        </p>
                        <p className='landingIntro'>
                            «Лейка» помогает вести коллекцию растений, планировать полив и
                            замечать, что уже сделано. Всё необходимое — на одном экране.
                        </p>
                        <div className='landingActions'>
                            <Link className='landingPrimaryAction' to='/register'>
                                Начать бесплатно
                            </Link>
                            <Link className='landingSecondaryAction' to='/login'>
                                У меня уже есть аккаунт
                            </Link>
                        </div>
                        <p className='landingPrivacyNote'>
                            Создайте аккаунт, чтобы сохранить свои растения и расписание.
                        </p>
                    </div>
                    <div className='landingPreview' aria-label='Как устроена Лейка'>
                        <div className='landingPreviewHeader'>
                            <span className='landingPreviewLogo'>
                                <img src={LogoMark} alt='' />
                            </span>
                            <div>
                                <span className='landingPreviewGreeting'>Ваш сад под рукой</span>
                                <strong>План на сегодня</strong>
                            </div>
                            <span className='landingPreviewCount'>2</span>
                        </div>
                        <div className='landingPreviewCalendar' aria-hidden='true'>
                            <span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span>
                            <span>5</span><span className='isToday'>6</span><span>7</span><span>8</span><span>9</span>
                        </div>
                        <div className='landingPreviewPlant'>
                            <span className='landingPlantGlyph' aria-hidden='true'>✳</span>
                            <span><strong>Монстера</strong><small>Полить сегодня</small></span>
                            <span className='landingPlantCheck' aria-hidden='true'>✓</span>
                        </div>
                        <div className='landingPreviewPlant'>
                            <span className='landingPlantGlyph landingPlantGlyphLight' aria-hidden='true'>❋</span>
                            <span><strong>Фикус</strong><small>Полить сегодня</small></span>
                            <span className='landingPlantCheck' aria-hidden='true'>✓</span>
                        </div>
                        <div className='landingPreviewTip'>
                            <span aria-hidden='true'>✦</span>
                            Не уверены, когда поливать? Спросите ИИ-помощника.
                        </div>
                    </div>
                </section>

                <section className='landingFeatures' aria-labelledby='landingFeaturesTitle'>
                    <div className='landingSectionHeading'>
                        <p className='landingEyebrow'>Всё просто и по делу</p>
                        <h2 id='landingFeaturesTitle'>Ваш уход — в одном ритме</h2>
                    </div>
                    <div className='landingFeatureGrid'>
                        {FEATURES.map(feature => (
                            <article className='landingFeature' key={feature.number}>
                                <span>{feature.number}</span>
                                <h3>{feature.title}</h3>
                                <p>{feature.description}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className='landingGettingStarted' aria-labelledby='landingStartTitle'>
                    <div>
                        <p className='landingEyebrow'>Первые шаги</p>
                        <h2 id='landingStartTitle'>Начать можно за пару минут</h2>
                    </div>
                    <ol>
                        <li><span>1</span><p>Создайте аккаунт или войдите.</p></li>
                        <li><span>2</span><p>Добавьте растение и настройте график.</p></li>
                        <li><span>3</span><p>Отмечайте полив и следите за календарём.</p></li>
                    </ol>
                    <Link className='landingPrimaryAction' to='/register'>Попробовать «Лейку»</Link>
                </section>

                <section className='landingGuide' aria-labelledby='landingGuideTitle'>
                    <div className='landingSectionHeading'>
                        <p className='landingEyebrow'>Полезное до регистрации</p>
                        <h2 id='landingGuideTitle'>Справочник по уходу за растениями</h2>
                        <p className='landingGuideLead'>
                            Частота полива, требования к свету и разбор частых проблем —
                            доступны без регистрации.
                        </p>
                    </div>
                    <div className='landingGuideColumns'>
                        <div>
                            <h3>Растения</h3>
                            <ul className='landingGuideList'>
                                {GUIDE_PLANTS.map(plant => (
                                    <li key={plant.slug}>
                                        <Link to={plantPath(plant.slug)}>
                                            {plant.name} — {plant.intervalLabel}
                                        </Link>
                                    </li>
                                ))}
                                <li><Link to={PLANTS_PATH}>Все растения в справочнике</Link></li>
                            </ul>
                        </div>
                        <div>
                            <h3>Статьи об уходе</h3>
                            <ul className='landingGuideList'>
                                {GUIDE_ARTICLES.map(article => (
                                    <li key={article.slug}>
                                        <Link to={articlePath(article.slug)}>{article.title}</Link>
                                    </li>
                                ))}
                                <li><Link to={CARE_PATH}>Все статьи об уходе</Link></li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className='landingFaq' aria-labelledby='landingFaqTitle'>
                    <p className='landingEyebrow'>Ответы на вопросы</p>
                    <h2 id='landingFaqTitle'>Уход за комнатными растениями без лишних хлопот</h2>
                    <div>
                        {FAQ.map(item => (
                            <details key={item.question}>
                                <summary>{item.question}</summary>
                                <p>{item.answer}</p>
                            </details>
                        ))}
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    )
}

export default LandingPage
