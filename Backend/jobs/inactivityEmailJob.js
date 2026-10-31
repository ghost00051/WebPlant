import cron from 'node-cron'
import inactivityEmailService, {
    INACTIVITY_EMAIL_INTERVAL_MINUTES,
    INACTIVITY_EMAIL_TICK_CRON,
    INACTIVITY_EMAIL_TICK_LOCK
} from '../services/inactivityEmailService.js'

const tasks = []

function currentDate() {
    return new Date()
}

async function runTick() {
    try {
        const result = await inactivityEmailService.runInactivityEmailTick(currentDate())
        if (!result?.skipped) {
            console.log(
                `✉️ InactivityEmailJob: отправлено ${result?.sent ?? 0}, ` +
                `запланировано ${result?.planned ?? 0}, ` +
                `пропущено по окну ${result?.skippedWindow ?? 0}, ` +
                `дублей ${result?.skippedDuplicate ?? 0}, ` +
                `без почты ${result?.skippedNoMail ?? 0}, ошибок ${result?.errors ?? 0}`
            )
            return
        }
        if (result.reason !== 'disabled') {
            console.log(`⏳ InactivityEmailJob: тик пропущен (${result.reason})`)
        }
    } catch (error) {
        console.error('❌ InactivityEmailJob: тик упал:', error?.message || error)
    }
}

export function start() {
    if (tasks.length) return tasks

    const task = cron.schedule(INACTIVITY_EMAIL_TICK_CRON, runTick, { timezone: 'UTC' })
    tasks.push(task)
    console.log(
        '✉️ InactivityEmailJob запущен: проверка каждые ' +
        `${INACTIVITY_EMAIL_INTERVAL_MINUTES} минут (UTC), ` +
        'отправка — в локальное окно пользователя ' +
        '(INACTIVITY_EMAIL_WINDOW_START/INACTIVITY_EMAIL_WINDOW_END)'
    )
    return tasks
}

export function stop() {
    for (const task of tasks.splice(0, tasks.length)) {
        try {
            task.stop()
        } catch (error) {
            console.error('⚠️ InactivityEmailJob: не удалось остановить задачу:', error?.message || error)
        }
    }
}

export { runTick, INACTIVITY_EMAIL_INTERVAL_MINUTES, INACTIVITY_EMAIL_TICK_CRON, INACTIVITY_EMAIL_TICK_LOCK }

export default { start, stop }
