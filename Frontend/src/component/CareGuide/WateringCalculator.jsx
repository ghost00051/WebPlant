import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANTS } from '../../data/plants.js'
import './WateringCalculator.css'

const SEASONS = [
    { value: 'summer', label: 'Лето, жарко', factor: 1 },
    { value: 'shoulder', label: 'Весна или осень', factor: 1.15 },
    { value: 'winter', label: 'Зима, работают батареи', factor: 1.35 }
]

const LIGHTS = [
    { value: 'bright', label: 'Яркий рассеянный свет', factor: 0.9 },
    { value: 'partial', label: 'Полутень', factor: 1 },
    { value: 'shade', label: 'Тень, далеко от окна', factor: 1.2 }
]

const POTS = [
    { value: 'small', label: 'Маленький, до 12 см', factor: 0.9 },
    { value: 'medium', label: 'Средний, 13–18 см', factor: 1 },
    { value: 'large', label: 'Большой, больше 18 см', factor: 1.2 }
]

const AIR = [
    { value: 'dry', label: 'Сухо: батареи, кондиционер', factor: 0.85 },
    { value: 'normal', label: 'Обычная влажность', factor: 1 },
    { value: 'humid', label: 'Влажно: увлажнитель, много растений', factor: 1.1 }
]

const MIN_INTERVAL_DAYS = 2
const MAX_INTERVAL_DAYS = 45

function parseInterval(plant) {
    const match = /(\d+)\s*[–-]\s*(\d+)/.exec(plant.intervalDays ?? '')
    if (!match) return { min: 7, max: 10 }
    const min = Number(match[1])
    const max = Number(match[2])
    return min <= max ? { min, max } : { min: max, max: min }
}

function factorOf(options, value) {
    return options.find(option => option.value === value)?.factor ?? 1
}

function clampDays(value) {
    return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(value)))
}

const DAY_WORD_FORMS = ['день', 'дня', 'дней']

function dayWord(count) {
    const value = Math.abs(Number(count))
    const mod10 = value % 10
    const mod100 = value % 100
    if (mod10 === 1 && mod100 !== 11) return DAY_WORD_FORMS[0]
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return DAY_WORD_FORMS[1]
    return DAY_WORD_FORMS[2]
}

function intervalDaysText(minDays, maxDays) {
    if (minDays === maxDays) return `${minDays} ${dayWord(minDays)}`
    return `${minDays}–${maxDays} ${dayWord(maxDays)}`
}

function WateringCalculator() {
    const [speciesSlug, setSpeciesSlug] = useState(PLANTS[0].slug)
    const [season, setSeason] = useState('shoulder')
    const [light, setLight] = useState('bright')
    const [pot, setPot] = useState('medium')
    const [air, setAir] = useState('normal')

    const plant = PLANTS.find(item => item.slug === speciesSlug) ?? PLANTS[0]
    const base = parseInterval(plant)
    const factor = factorOf(SEASONS, season) * factorOf(LIGHTS, light) *
        factorOf(POTS, pot) * factorOf(AIR, air)

    const minDays = clampDays(base.min * factor)
    const maxDays = clampDays(Math.max(minDays, base.max * factor))
    const intervalText = intervalDaysText(minDays, maxDays)

    return (
        <section className='wateringCalculator' aria-labelledby='wateringCalculatorTitle'>
            <div className='wateringCalculatorIntro'>
                <h2 id='wateringCalculatorTitle'>Калькулятор: когда поливать</h2>
                <p>
                    Выберите растение и условия в комнате — калькулятор поправит базовый
                    интервал с учётом сезона, света, объёма горшка и сухости воздуха.
                    Это ориентир: перед поливом проверьте грунт на глубине 3–4 см.
                </p>
            </div>
            <form className='wateringCalculatorForm' onSubmit={event => event.preventDefault()}>
                <label className='wateringCalculatorField'>
                    <span>Растение</span>
                    <select value={speciesSlug} onChange={event => setSpeciesSlug(event.target.value)}>
                        {PLANTS.map(item => (
                            <option key={item.slug} value={item.slug}>{item.name}</option>
                        ))}
                    </select>
                </label>
                <label className='wateringCalculatorField'>
                    <span>Сезон</span>
                    <select value={season} onChange={event => setSeason(event.target.value)}>
                        {SEASONS.map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </label>
                <label className='wateringCalculatorField'>
                    <span>Свет</span>
                    <select value={light} onChange={event => setLight(event.target.value)}>
                        {LIGHTS.map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </label>
                <label className='wateringCalculatorField'>
                    <span>Горшок</span>
                    <select value={pot} onChange={event => setPot(event.target.value)}>
                        {POTS.map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </label>
                <label className='wateringCalculatorField'>
                    <span>Воздух</span>
                    <select value={air} onChange={event => setAir(event.target.value)}>
                        {AIR.map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </label>
            </form>
            <div className='wateringCalculatorResult' aria-live='polite'>
                <p className='wateringCalculatorLabel'>Ориентировочный интервал</p>
                <p className='wateringCalculatorValue'>
                    {plant.name}: поливать примерно раз в {intervalText}
                </p>
                <p className='wateringCalculatorHint'>
                    Базовый интервал для вида — {plant.intervalLabel}. Поправка под ваши
                    условия: ≈ {Math.round(factor * 100)}% от базового.
                </p>
                <p className='wateringCalculatorHint'>
                    Если к следующему поливу грунт на глубине 3–4 см ещё сырой, добавьте день.
                    Если грунт полностью сухой за два дня до напоминания — интервал можно сократить.
                </p>
                <div className='wateringCalculatorActions'>
                    <Link className='wateringCalculatorPrimary' to='/register'>
                        Сохранить график в «Лейке»
                    </Link>
                    <Link className='wateringCalculatorSecondary' to='/care/kak-ponyat-pora-polivat'>
                        Как проверить, что пора поливать
                    </Link>
                </div>
            </div>
        </section>
    )
}

export default WateringCalculator
