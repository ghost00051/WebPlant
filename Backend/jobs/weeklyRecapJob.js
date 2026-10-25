import cron from 'node-cron'
import weeklyRecapService, {
    WEEKLY_RECAP_INTERVAL_MINUTES,
    WEEKLY_RECAP_TICK_CRON
} from '../services/weeklyRecapService.js'

const tasks = []

function currentDate() {
    return new Date()
}

async function runTick() {
    try {
        const result = await weeklyRecapService.runWeeklyRecapTick(currentDate())
        if (!result?.skipped) {
            console.log(
                `🌿 WeeklyRecapJob: создано ${result?.recapsCreated ?? 0} recap, ` +
                `писем ${result?.emailsSent ?? 0}, ошибок ${result?.errors ?? 0}`
            )
        }
    } catch (error) {
        console.error('❌ WeeklyRecapJob: тик упал:', error?.message || error)
    }
}

export function start() {
    if (tasks.length) return tasks

    const task = cron.schedule(WEEKLY_RECAP_TICK_CRON, runTick, { timezone: 'UTC' })
    tasks.push(task)
    console.log(
        '🌿 WeeklyRecapJob запущен: проверка каждые ' +
        `${WEEKLY_RECAP_INTERVAL_MINUTES} минут (UTC), ` +
        'отправка — по локальному дню/часу пользователя (WEEKLY_RECAP_WEEKDAY/WEEKLY_RECAP_HOUR)'
    )
    return tasks
}

export function stop() {
    for (const task of tasks.splice(0, tasks.length)) {
        try {
            task.stop()
        } catch (error) {
            console.error('⚠️ WeeklyRecapJob: не удалось остановить задачу:', error?.message || error)
        }
    }
}

export { runTick }

export default { start, stop }
