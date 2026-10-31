import { ARTICLE_NAV, PLANT_NAV } from '../../data/seoMeta.js'
import { CARE_ACTION_CODES } from '../../utils/careEvents.js'
import './landingSocialProof.css'

const CARE_TYPES_COUNT = CARE_ACTION_CODES.length + 1

const FACTS = [
    {
        value: String(PLANT_NAV.length),
        unit: 'растений',
        title: 'в справочнике по уходу',
        text: 'Частота полива, требования к свету и типичные проблемы — открыто, без регистрации.'
    },
    {
        value: String(ARTICLE_NAV.length),
        unit: 'статей',
        title: 'об уходе за растениями',
        text: 'Разбираем перелив, желтеющие листья, зимний полив и другие частые вопросы.'
    },
    {
        value: String(CARE_TYPES_COUNT),
        unit: 'видов ухода',
        title: 'в одном расписании',
        text: 'Полив, подкормка, опрыскивание, осмотр и ещё три действия — с отметкой в один тап.'
    },
    {
        value: '3',
        unit: 'канала',
        title: 'напоминаний',
        text: 'Push в браузере, Telegram и MAX: напоминание придёт туда, где вам удобнее.'
    }
]

function LandingSocialProof() {
    return (
        <section className='landingFacts' aria-labelledby='landingFactsTitle'>
            <div className='landingFactsHeading'>
                <p className='landingEyebrow'>Факты вместо обещаний</p>
                <h2 id='landingFactsTitle'>Что уже работает в «Лейке»</h2>
                <p className='landingFactsLead'>
                    Мы не публикуем отзывы, которые не можем подтвердить. Вместо этого —
                    то, что уже есть в приложении: часть разделов доступна без
                    регистрации, остальное можно проверить после неё.
                </p>
            </div>
            <ul className='landingFactsGrid'>
                {FACTS.map(fact => (
                    <li className='landingFactCard' key={fact.title}>
                        <p className='landingFactValue'>
                            <strong>{fact.value}</strong> {fact.unit}
                        </p>
                        <h3>{fact.title}</h3>
                        <p className='landingFactText'>{fact.text}</p>
                    </li>
                ))}
            </ul>
            <p className='landingFactsNote'>
                Цифры приведены по самому приложению: справочник и статьи можно открыть
                прямо сейчас, а расписание, напоминания и помощника — попробовать в демо
                на этой странице.
            </p>
        </section>
    )
}

export default LandingSocialProof
