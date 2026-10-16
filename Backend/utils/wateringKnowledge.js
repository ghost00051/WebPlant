export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Europe/Moscow'

export const PLANT_GROUPS = [
    {
        id: 'cactus_succulent',
        title: 'кактусы и суккуленты',
        pattern: /кактус|cactus|суккулент|succulent|эхевери|echeveria|хаворти|haworthia|литопс|lithops|алоэ|aloe|толстянк|crassula|крассул|молоча|euphorbia|сансевиер|sansevieria|замиокулькас|zamioculcas|опунци|opuntia|маммилляри|mammillaria|астрофитум|astrophytum|седум|sedum|каланхоэ тереса/i,
        intervalRange: [14, 30],
        winterFactor: 1.8,
        summerFactor: 0.9,
        clue: 'запасает воду в листьях/стебле, боится залива',
        question: 'Как быстро просыхает грунт: за пару дней, за неделю или дольше? Проверяли палочкой или на вес горшка?',
        timeOfDay: { winter: 'day', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'orchid',
        title: 'орхидеи',
        pattern: /орхиде|orchid|фаленопсис|phalaenopsis|дендробиум|dendrobium|каттле|cattleya|пафиопедилум|paphiopedilum|ванда|vanda/i,
        intervalRange: [7, 14],
        winterFactor: 1.4,
        summerFactor: 0.9,
        clue: 'растёт в коре, корни серебрятся между поливами',
        question: 'Видны ли корни в прозрачном горшке и какого они цвета: зелёные, серебристые или тёмные?',
        timeOfDay: { winter: 'day', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'fern',
        title: 'папоротники',
        pattern: /папоротник|fern|нефролепис|nephrolepis|адиантум|adiantum|асплениум|asplenium|платицериум|platycerium|птерис|pteris/i,
        intervalRange: [2, 5],
        winterFactor: 1.3,
        summerFactor: 0.85,
        clue: 'любит постоянно влажный грунт и высокую влажность воздуха',
        question: 'Как быстро грунт становится сухим на ощупь: за день-два или дольше? Есть ли увлажнитель или опрыскивание?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'calathea_maranta',
        title: 'марантовые (калатея, маранта, строманта)',
        pattern: /калате|calathea|марант|maranta|стромант|stromanthe|ктенант|ctenanthe|гейхер|геликони/i,
        intervalRange: [3, 7],
        winterFactor: 1.3,
        summerFactor: 0.9,
        clue: 'реагирует на пересушку скручиванием листьев, не терпит холодную воду',
        question: 'Скручиваются ли листья между поливами и какой водой поливаете — отстоянной комнатной температуры?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'flowering',
        title: 'цветущие комнатные',
        pattern: /фиалк|сенполи|saintpaulia|violet|пеларгони|pelargonium|герань|geranium|гибискус|hibiscus|бегони|begonia|азали|azalea|хризантем|chrysanthemum|роз[аы]|rose|антуриум|anthurium|спатифиллум|spathiphyllum|кливи|clivia|гортензи|hydrangea|цикламен|cyclamen|пуансетти|poinsettia/i,
        intervalRange: [3, 8],
        winterFactor: 1.4,
        summerFactor: 0.85,
        clue: 'во время цветения и активного роста пьёт больше, зимой — заметно меньше',
        question: 'Растение сейчас цветёт или в периоде покоя? Есть ли бутоны или новые листья?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'herbs_vegetables',
        title: 'пряные травы и овощи',
        pattern: /базилик|basil|мята|mint|розмарин|rosemary|тимьян|thyme|мелисс|лемонграсс|томат|помидор|tomato|огурец|cucumber|перец|pepper|салат|lettuce|петрушк|parsley|укроп|dill|шпинат|spinach|земляник|клубник|strawberr|кабач|zucchini|баклажан|eggplant/i,
        intervalRange: [1, 3],
        winterFactor: 1.6,
        summerFactor: 1,
        clue: 'растёт быстро, грунт не должен пересыхать полностью',
        question: 'Где растёт: на подоконнике, на балконе или в открытом грунте? Как быстро просыхает грунт?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'evening', autumn: 'morning' }
    },
    {
        id: 'palm',
        title: 'пальмы',
        pattern: /пальм|palm|хамедоре|chamaedorea|хове|howea|кенци|kentia|финик|phoenix|вашингтони|washingtonia|ливiston|ливистон|cycad|саговник|юкка|yucca|драцен|dracaena|cordyline|кордилин/i,
        intervalRange: [6, 12],
        winterFactor: 1.5,
        summerFactor: 0.9,
        clue: 'крупный объём грунта, просыхает медленно, чувствительна к застою воды',
        question: 'Какой размер горшка и есть ли дренажные отверстия? Как глубоко просыхает грунт перед поливом?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
    },
    {
        id: 'tropical_foliage',
        title: 'тропические лиственные',
        pattern: /монстер|monstera|фикус|ficus|филодендрон|philodendron|эпипремнум|epipremnum|сциндапсус|scindapsus|потос|pothos|хлорофитум|chlorophytum|диффенбахи|dieffenbachia|аглаонем|aglaonema|шеффлер|schefflera|пепероми|peperomia|традесканци|tradescantia|зебрин|zebrina|березк|каучуконос|эухарис|eucharis|аспидистр|aspidistra|циссус|cissus|хойя|hoya/i,
        intervalRange: [6, 12],
        winterFactor: 1.5,
        summerFactor: 0.85,
        clue: 'крупные листья испаряют много влаги летом и мало зимой',
        question: 'Стоит ли растение у окна и какого оно размера: насколько крупный горшок и как быстро просыхает грунт?',
        timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
    }
]

export const DEFAULT_GROUP = {
    id: 'default',
    title: 'комнатные растения общего типа',
    pattern: null,
    intervalRange: [5, 10],
    winterFactor: 1.5,
    summerFactor: 0.9,
    clue: 'ориентируйтесь на просыхание верхних 2–3 см грунта',
    question: 'Как быстро просыхает верхний слой грунта: за пару дней, за неделю или дольше? Где стоит растение и какой у него горшок?',
    timeOfDay: { winter: 'morning', spring: 'morning', summer: 'morning', autumn: 'morning' }
}

export const SEASON_LABELS = {
    winter: 'зима',
    spring: 'весна',
    summer: 'лето',
    autumn: 'осень'
}

export function detectPlantGroup({ name, species } = {}) {
    const haystack = `${species || ''} ${name || ''}`.trim()
    if (!haystack) return DEFAULT_GROUP
    return PLANT_GROUPS.find(group => group.pattern.test(haystack)) || DEFAULT_GROUP
}

export function getSeasonInfo(now = new Date(), timeZone = APP_TIME_ZONE) {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        month: 'numeric',
        year: 'numeric'
    })
    const parts = formatter.formatToParts(now)
    const monthNumber = Number(parts.find(part => part.type === 'month')?.value)
    const year = Number(parts.find(part => part.type === 'year')?.value)
    const month = Number.isInteger(monthNumber) ? monthNumber : now.getUTCMonth() + 1

    let season
    if (month === 12 || month === 1 || month === 2) season = 'winter'
    else if (month >= 3 && month <= 5) season = 'spring'
    else if (month >= 6 && month <= 8) season = 'summer'
    else season = 'autumn'

    if (String(process.env.HEMISPHERE || '').toLowerCase() === 'south') {
        season = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[season]
    }

    const monthName = new Intl.DateTimeFormat('ru-RU', { timeZone, month: 'long' }).format(now)

    return {
        season,
        seasonLabel: SEASON_LABELS[season],
        month,
        monthName,
        year,
        growingSeason: season === 'spring' || season === 'summer'
    }
}

function clampInterval(value, [min, max]) {
    const rounded = Math.round(Number(value))
    if (!Number.isFinite(rounded)) return min
    return Math.min(max, Math.max(min, rounded))
}

function seasonInterval(group, season) {
    const [min, max] = group.intervalRange
    const base = (min + max) / 2
    const factor = season === 'winter'
        ? group.winterFactor
        : season === 'summer'
            ? group.summerFactor
            : 1.1
    return clampInterval(base * factor, [Math.max(1, min), Math.min(365, Math.round(max * 1.8))])
}

function describeAnswers(answers = []) {
    const lines = answers
        .filter(item => item && typeof item.answer === 'string' && item.answer.trim())
        .map(item => `— ${item.answer.trim()}`)
    return lines.length > 0 ? ` Ваши уточнения: ${lines.join(' ')}` : ''
}

export function fallbackWateringAdvice({ plantName, species, answers = [], now = new Date(), timeZone } = {}) {
    const group = detectPlantGroup({ name: plantName, species })
    const season = getSeasonInfo(now, timeZone)
    const intervalDays = seasonInterval(group, season.season)
    const details = describeAnswers(answers)
    const seasonNote = season.season === 'winter'
        ? 'Зимой при коротком дне и прохладе полив обычно реже, чем летом.'
        : season.season === 'summer'
            ? 'Летом при жаре и активном росте полив обычно чаще, чем зимой.'
            : 'В межсезонье ориентируйтесь на реальное просыхание грунта.'

    return {
        type: 'recommendation',
        intervalDays,
        reason: `Ориентир для группы «${group.title}»: примерно раз в ${intervalDays} дн. ` +
            `(${group.clue}). ${seasonNote}${details} ` +
            'Проверяйте грунт пальцем или палочкой на глубине 2–3 см и корректируйте интервал по факту.',
        confidence: answers.length >= 2 ? 'medium' : 'low'
    }
}

export function fallbackWateringTimeAdvice({
    plantName,
    species,
    intervalDays = null,
    now = new Date(),
    timeZone,
    location = ''
} = {}) {
    const group = detectPlantGroup({ name: plantName, species })
    const season = getSeasonInfo(now, timeZone)
    const outdoors = /улиц|балкон|террас|сад|огород|теплиц|лоджи/i.test(String(location || ''))
    const rainyRisk = ['fern', 'calathea_maranta', 'orchid'].includes(group.id)
    const longInterval = Number.isFinite(intervalDays) && intervalDays >= 12

    let timeOfDay = group.timeOfDay[season.season] || 'morning'

    if (season.season === 'summer' && (outdoors || longInterval)) timeOfDay = 'evening'
    if (season.season === 'summer' && rainyRisk && !outdoors) timeOfDay = 'morning'
    if (season.season === 'winter' && group.id === 'cactus_succulent') timeOfDay = 'day'
    if (outdoors && season.season === 'winter') timeOfDay = 'morning'

    const reasons = {
        morning: 'Утром вода успевает впитаться, а листья и верхний слой грунта подсыхают за день — меньше риска грибных проблем.',
        day: 'Днём в помещении теплее: вода не будет холодной для корней, и грунт успеет прогреться.',
        evening: 'Вечером вода впитывается без быстрого испарения — это полезно в жару и для крупных кашпо.'
    }

    const seasonNote = season.season === 'summer'
        ? ' Летом в жару допустимо поливать и вечером.'
        : season.season === 'winter'
            ? ' Зимой лучше не поливать поздно вечером холодной водой.'
            : ''

    return {
        timeOfDay,
        reason: `${reasons[timeOfDay]} Для группы «${group.title}» (${season.seasonLabel}).${seasonNote} ` +
            'Главное — проверять влажность грунта, а не поливать строго по часам.'
    }
}


export function buildIntervalReference(season) {
    return PLANT_GROUPS
        .map(group => {
            const [min, max] = group.intervalRange
            const winter = Math.round(((min + max) / 2) * group.winterFactor)
            const summer = Math.round(((min + max) / 2) * group.summerFactor)
            return `• ${group.title}: ${min}–${max} дн. (зимой ≈${winter}, летом ≈${summer}); ${group.clue}`
        })
        .join('\n')
        .concat('\n• другие комнатные растения: 5–10 дн. (зимой реже, летом чаще)')
        .concat(season === 'winter' ? '\nСейчас зима: из-за короткого дня и прохлады интервалы обычно на 30–80% длиннее летних.' : '')
        .concat(season === 'summer' ? '\nСейчас лето: активный рост и жара — интервалы обычно самые короткие.' : '')
}
