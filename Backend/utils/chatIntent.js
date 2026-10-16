import { appTimeZone } from './aiMetrics.js'

const DAY_MS = 24 * 60 * 60 * 1000

const INTENT_PATTERNS = [
    { intent: 'what_to_water', pattern: /что\s+полить|кого\s+полить|пора\s+полить|нужно\s+полить|полить\s+сегодня|полив\s+сегодня|что\s+поливать/i },
    { intent: 'schedule', pattern: /график|расписан|когда\s+полить|когда\s+поливать|следующий\s+полив|план\s+полива/i },
    { intent: 'plants_count', pattern: /сколько\s+(у\s+меня\s+)?растен|мои\s+растения|список\s+растений|какие\s+у\s+меня\s+растения/i },
    { intent: 'help', pattern: /что\s+ты\s+умеешь|чем\s+ты\s+можешь\s+помочь|помощь|help|подсказки/i }
]

export function detectChatIntent(message) {
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text) return null
    const match = INTENT_PATTERNS.find(item => item.pattern.test(text))
    return match ? match.intent : null
}

function dayKey(value, timeZone) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date)
}

export function describePlantDay(value, { now = new Date(), timeZone = appTimeZone() } = {}) {
    const target = dayKey(value, timeZone)
    const today = dayKey(now, timeZone)
    if (!target || !today) return null
    if (target === today) return 'сегодня'

    const diffDays = Math.round(
        (new Date(`${target}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / DAY_MS
    )
    if (diffDays === 1) return 'завтра'
    if (diffDays === -1) return 'вчера'
    if (diffDays < -1) return `просрочен на ${Math.abs(diffDays)} дн.`
    if (diffDays <= 7) return `через ${diffDays} дн.`

    return new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        day: 'numeric',
        month: 'long'
    }).format(new Date(value))
}

function isDue(plant, now) {
    const next = plant?.nextWatering ? new Date(plant.nextWatering) : null
    if (!next || Number.isNaN(next.getTime())) return false
    return next.getTime() <= now.getTime()
}

function dueToday(plant, options) {
    const next = plant?.nextWatering ? new Date(plant.nextWatering) : null
    if (!next || Number.isNaN(next.getTime())) return false
    return dayKey(next, options.timeZone) === dayKey(options.now, options.timeZone)
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
