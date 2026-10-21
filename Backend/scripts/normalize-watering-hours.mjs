import 'dotenv/config'
import sequelize from '../db.js'
import Plant from '../models/Plant.js'
import User from '../models/userModels.js'
import { planWateringHourFixes } from '../utils/wateringNormalization.js'
import { APP_TIME_ZONE } from '../utils/wateringSchedule.js'
import { isValidTimeZone } from '../utils/timeZone.js'

function parseArgs(argv) {
    const options = { apply: false, help: false, timeZone: null }

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index]
        if (arg === '--apply') options.apply = true
        else if (arg === '--help' || arg === '-h') options.help = true
        else if (arg === '--zone') {
            options.timeZone = argv[++index]
            if (!isValidTimeZone(options.timeZone)) {
                console.error(`Некорректный часовой пояс: ${options.timeZone}`)
                process.exit(1)
            }
        } else {
            console.error(`Неизвестный параметр: ${arg}`)
            options.help = true
        }
    }

    return options
}

async function loadTimeZones() {
    try {
        const users = await User.findAll({ attributes: ['id', 'timezone'], raw: true })
        return new Map(users.map(user => [user.id, user.timezone]))
    } catch (error) {
        const missingColumn = error?.parent?.code === '42703' ||
            /timezone/i.test(error?.message || '')
        if (!missingColumn) throw error

        console.warn(
            '⚠️ Колонки users.timezone ещё нет: применяю миграцию ' +
            '20261013_add_user_timezone.sql либо используйте параметр --zone'
        )
        return new Map()
    }
}

function formatInZone(value, timeZone) {
    if (!value) return '—'
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        dateStyle: 'short',
        timeStyle: 'short',
        hourCycle: 'h23'
    }).format(value)
}

async function main() {
    const options = parseArgs(process.argv.slice(2))

    if (options.help) {
        console.log('Использование: node scripts/normalize-watering-hours.mjs [--apply] [--zone <IANA>]')
        console.log('Без --apply скрипт только показывает план (dry-run).')
        return
    }

    await sequelize.authenticate()

    const plants = await Plant.findAll({
        attributes: ['id', 'user_id', 'name', 'watering_time_of_day', 'next_watering_at'],
        raw: true,
        order: [['id', 'ASC']]
    })

    const timeZonesByUser = await loadTimeZones()
    const plan = planWateringHourFixes({
        plants,
        timeZonesByUser,
        defaultTimeZone: options.timeZone || APP_TIME_ZONE
    })

    const changed = plan.filter(item => item.changed)
    const skipped = plan.filter(item => !item.changed)

    console.log(`Всего растений: ${plan.length}`)
    console.log(`Требуют сдвига времени: ${changed.length}`)
    console.log('')

    for (const item of plan) {
        const current = formatInZone(item.current, item.timeZone)
        const fixed = item.changed ? formatInZone(item.fixed, item.timeZone) : '—'
        console.log(
            `#${item.id} ${item.name || 'без имени'} | пояс ${item.timeZone} | ` +
            `${item.timeOfDay || '—'} | сейчас ${current} → станет ${fixed} | ${item.reason}`
        )
    }

    if (!options.apply) {
        console.log('')
        console.log('Это dry-run: данные не изменены. Для применения добавьте --apply.')
        return
    }

    if (!changed.length) {
        console.log('')
        console.log('Нечего менять.')
        return
    }

    await sequelize.transaction(async transaction => {
        for (const item of changed) {
            await Plant.update(
                { next_watering_at: item.fixed },
                { where: { id: item.id }, transaction }
            )
        }
    })

    console.log('')
    console.log(`Обновлено растений: ${changed.length} (остальные ${skipped.length} уже были верными)`)
}

await main()
    .catch(error => {
        console.error('❌ Ошибка нормализации:', error?.message || error)
        process.exitCode = 1
    })
    .finally(() => sequelize.close().catch(() => {}))
