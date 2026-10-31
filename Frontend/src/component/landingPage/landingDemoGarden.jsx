import LogoMark from '../../assets/LogoMark.svg'
import {
    DEMO_GARDEN_NEXT_PLANT,
    DEMO_GARDEN_BASE_STREAK,
    DEMO_GARDEN_PLANTS,
    countDemoWatered,
    getLastWateredPlant,
    pluralizeDays
} from './landingDemoGardenData.js'
import './landingDemoGarden.css'

const WEEK_DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ']
const TODAY_INDEX = 2

function LandingDemoGarden({ wateredIds, onWater, onReset }) {
    const dueLeft = DEMO_GARDEN_PLANTS.filter(
        plant => plant.dueToday && !wateredIds?.[plant.id]
    ).length
    const wateredCount = countDemoWatered(wateredIds)
    const lastWatered = getLastWateredPlant(wateredIds)
    const streak = DEMO_GARDEN_BASE_STREAK + wateredCount

    let recap
    if (wateredCount === 0) {
        recap = 'Нажмите «Полить» — «Лейка» пересчитает день и добавит его в серию.'
    } else if (dueLeft > 0) {
        const verb = lastWatered?.gender === 'm' ? 'полит' : 'полита'
        recap = `${lastWatered?.name ?? 'Растение'} ${verb}. Серия — ${streak} ${pluralizeDays(streak)}. Сегодня осталось полить: ${dueLeft}.`
    } else {
        recap = `Все растения политы — сегодня полить нечего. Серия — ${streak} ${pluralizeDays(streak)}. Следующий полив — ${DEMO_GARDEN_NEXT_PLANT}, завтра.`
    }

    return (
        <div
            className='landingPreview landingPreviewInteractive'
            role='group'
            aria-label='Интерактивный демо-сад «Лейки»'
        >
            <div className='landingPreviewHeader'>
                <span className='landingPreviewLogo'>
                    <img src={LogoMark} alt='' />
                </span>
                <div>
                    <span className='landingPreviewGreeting'>Ваш сад под рукой</span>
                    <strong>Демо-сад: план на сегодня</strong>
                </div>
                <span
                    className='landingPreviewCount'
                    role='status'
                    aria-label={
                        dueLeft > 0
                            ? `Полить сегодня: ${dueLeft}`
                            : 'Все растения политы'
                    }
                >
                    {dueLeft > 0 ? dueLeft : '✓'}
                </span>
            </div>

            <div className='landingDemoCalendar' aria-hidden='true'>
                {WEEK_DAYS.map((day, index) => (
                    <span
                        key={day}
                        className={index === TODAY_INDEX ? 'isToday' : ''}
                    >
                        {day}
                    </span>
                ))}
            </div>
            <p className='landingDemoTodayLabel'>
                <span className='landingDemoDot' aria-hidden='true' />
                Сегодня · {dueLeft > 0 ? `полить: ${dueLeft}` : 'полить нечего'}
            </p>

            <ul className='landingDemoPlants'>
                {DEMO_GARDEN_PLANTS.map(plant => {
                    const watered = Boolean(wateredIds?.[plant.id])
                    return (
                        <li className='landingDemoPlant' key={plant.id}>
                            <span
                                className={`landingPlantGlyph${
                                    plant.light ? ' landingPlantGlyphLight' : ''
                                }`}
                                aria-hidden='true'
                            >
                                {plant.glyph}
                            </span>
                            <span className='landingDemoPlantText'>
                                <strong>{plant.name}</strong>
                                <small>
                                    {watered ? 'Полито сегодня ✓' : plant.note}
                                </small>
                            </span>
                            {plant.dueToday && !watered && (
                                <button
                                    type='button'
                                    className='landingDemoWater'
                                    onClick={() => onWater(plant.id)}
                                >
                                    Полить
                                </button>
                            )}
                            {watered && (
                                <span
                                    className='landingPlantCheck'
                                    aria-hidden='true'
                                >
                                    ✓
                                </span>
                            )}
                        </li>
                    )
                })}
            </ul>

            <p className='landingDemoRecap' role='status' aria-live='polite'>
                {recap}
            </p>

            {dueLeft === 0 && wateredCount > 0 && (
                <button
                    type='button'
                    className='landingDemoReset'
                    onClick={onReset}
                >
                    Сыграть ещё раз
                </button>
            )}

            <div className='landingPreviewTip'>
                <span aria-hidden='true'>✦</span>
                Это демо: настоящий календарь «Лейки» ведёт ваши растения и напоминает
                о поливе.
            </div>
        </div>
    )
}

export default LandingDemoGarden
