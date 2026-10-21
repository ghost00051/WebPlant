import { appTimeZone, describePlantDay, diffLocalDays, localDayKey } from './localDay.js'

export { describePlantDay }

const MAX_LOCAL_COMMAND_LENGTH = 120

const POLITE_PREFIX = /^(?:алиса|лейка|пожалуйста|скажи|подскажи|покажи-ка|покажи|ну|а)[\s,]+/

const CARE_PROBLEM = /почему|отчего|желт|сохн|вянет|вянут|засыха|боле|пятн|гнил|гниёт|гниет|опал|сбросил|спасти|что\s+делать|не\s+растёт|не\s+растет|плохо\s+себя/

const COMMAND_PATTERNS = [
    {
        intent: 'what_to_water',
        pattern: /^(?:что|кого)(?:\s+мне)?\s+полить(?:\s+(?:сегодня|сейчас|завтра))?$|^(?:пора|нужно|надо)\s+полить$|^полить\s+сегодня$|^что\s+поливать$|^полив\s+сегодня$/
    },
    {
        intent: 'schedule',
        pattern: /^(?:покажи|показать)(?:\s+мне)?\s+(?:график|расписание|план)(?:\s+полива)?$|^(?:график|расписание|план)(?:\s+полива)?$|^когда\s+поли(?:ть|вать)(?:\s+.{1,30})?$|^следующий\s+полив$/
    },
    {
        intent: 'plants_count',
        pattern: /^сколько(?:\s+у\s+меня)?\s+растений$|^(?:мои|какие(?:\s+у\s+меня)?)\s+растения$|^список\s+растений$/
    },
    {
        intent: 'help',
        pattern: /^помощь$|^help$|^подсказки$|^что\s+ты\s+умеешь$|^чем\s+ты\s+можешь\s+помочь$|^какие\s+есть\s+(?:команды|возможности)$/
    }
]

export function normalizeLocalCommand(message) {
    if (typeof message !== 'string') return ''
    let text = message.trim().toLowerCase().replace(/\s+/g, ' ')
    text = text.replace(/[?!.…\s]+$/u, '')
    for (let i = 0; i < 3 && POLITE_PREFIX.test(text); i += 1) {
        text = text.replace(POLITE_PREFIX, '')
    }
    return text.trim()
}

export function detectChatIntent(message) {
    const text = normalizeLocalCommand(message)
    if (!text || text.length > MAX_LOCAL_COMMAND_LENGTH) return null
    if (CARE_PROBLEM.test(text)) return null
    const match = COMMAND_PATTERNS.find(item => item.pattern.test(text))
    return match ? match.intent : null
}

function isDue(plant, now) {
    const next = plant?.nextWatering ? new Date(plant.nextWatering) : null
    if (!next || Number.isNaN(next.getTime())) return false
    return next.getTime() <= now.getTime()
}

function dueToday(plant, options) {
    const next = plant?.nextWatering ? new Date(plant.nextWatering) : null
    if (!next || Number.isNaN(next.getTime())) return false
    return localDayKey(next, options.timeZone) === localDayKey(options.now, options.timeZone)
}

function plantLine(plant, options) {
    const when = describePlantDay(plant.nextWatering, options)
    const species = plant.species ? ` (${plant.species})` : ''
    return when ? `• ${plant.name}${species} — ${when}` : `• ${plant.name}${species}`
}

function plural(count, one, few, many) {
    const mod10 = count % 10
    const mod100 = count % 100
    if (mod10 === 1 && mod100 !== 11) return one
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
    return many
}

export function buildPlantsOverview({ plants = [], isAuthorized = false, now = new Date(), timeZone = appTimeZone() } = {}) {
    if (!isAuthorized) {
        return 'Чтобы рассказать про ваши растения, нужно войти в аккаунт. После входа спросите: «Что полить?» или «Покажи график».'
    }
    if (!plants.length) {
        return 'У вас пока нет растений в «Лейке». Добавьте первое — и я подскажу, когда его поливать.'
    }

    const options = { now, timeZone }
    const due = plants.filter(plant => isDue(plant, now))
    const soon = plants
        .filter(plant => !isDue(plant, now))
        .slice(0, 5)

    const lines = [`У вас ${plants.length} ${plural(plants.length, 'растение', 'растения', 'растений')}.`]
    if (due.length) {
        lines.push('', `Пора полить (${due.length}):`)
        lines.push(...due.slice(0, 10).map(plant => plantLine(plant, options)))
    } else {
        lines.push('', 'Сейчас поливать ничего не нужно — все растения политы.')
    }
    if (soon.length) {
        lines.push('', 'Дальше по графику:')
        lines.push(...soon.map(plant => plantLine(plant, options)))
    }
    return lines.join('\n')
}

export function resolveLocalChatAnswer({
    message,
    plants = [],
    isAuthorized = false,
    now = new Date(),
    timeZone = appTimeZone()
} = {}) {
    const intent = detectChatIntent(message)
    if (!intent) return null

    const options = { now, timeZone }

    if (intent === 'help') {
        return {
            intent,
            text: [
                'Я умею:',
                '• подсказывать, что полить сегодня («Что полить?»);',
                '• показывать график полива («Покажи график»);',
                '• считать ваши растения («Сколько у меня растений?»);',
                '• советовать частоту и время полива для нового растения.',
                '',
                'Спросите своими словами — я пойму.'
            ].join('\n')
        }
    }

    if (!isAuthorized) {
        return {
            intent,
            text: 'Чтобы отвечать по вашим растениям, войдите в аккаунт. А ещё я могу подсказать частоту и время полива для нового растения.'
        }
    }

    if (!plants.length) {
        return {
            intent,
            text: 'У вас пока нет растений в «Лейке». Добавьте первое — и я подскажу, когда его поливать.'
        }
    }

    if (intent === 'plants_count') {
        const names = plants.slice(0, 10).map(plant => `• ${plant.name}`).join('\n')
        const rest = plants.length > 10 ? `\n…и ещё ${plants.length - 10}.` : ''
        return {
            intent,
            text: `У вас ${plants.length} ${plural(plants.length, 'растение', 'растения', 'растений')}:\n${names}${rest}`
        }
    }

    if (intent === 'what_to_water') {
        const due = plants.filter(plant => isDue(plant, now))
        const today = plants.filter(plant => !isDue(plant, now) && dueToday(plant, options))
        if (!due.length && !today.length) {
            const nearest = plants[0]
            const when = nearest ? describePlantDay(nearest.nextWatering, options) : null
            return {
                intent,
                text: when
                    ? `Сейчас поливать ничего не нужно. Ближайший полив: ${nearest.name} — ${when}.`
                    : 'Сейчас поливать ничего не нужно — все растения политы.'
            }
        }
        const lines = []
        if (due.length) {
            lines.push(`Пора полить (${due.length}):`)
            lines.push(...due.slice(0, 10).map(plant => plantLine(plant, options)))
        }
        if (today.length) {
            if (lines.length) lines.push('')
            lines.push(`Сегодня по графику (${today.length}):`)
            lines.push(...today.slice(0, 10).map(plant => plantLine(plant, options)))
        }
        lines.push('', 'Проверьте грунт пальцем на 2–3 см — если сухо, поливайте.')
        return { intent, text: lines.join('\n') }
    }

    if (intent === 'schedule') {
        const upcoming = [...plants]
            .filter(plant => plant.nextWatering)
            .sort((a, b) => new Date(a.nextWatering) - new Date(b.nextWatering))
            .slice(0, 7)
        if (!upcoming.length) {
            return { intent, text: 'Пока нет дат полива — добавьте растения и укажите частоту, и я построю график.' }
        }
        return {
            intent,
            text: ['Ближайшие поливы:', ...upcoming.map(plant => plantLine(plant, options))].join('\n')
        }
    }

    return null
}

export { diffLocalDays, localDayKey }
