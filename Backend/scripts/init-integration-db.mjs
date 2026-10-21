import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sequelize from '../db.js'
import User from '../models/userModels.js'
import Plant from '../models/Plant.js'
import PushSubscription from '../models/PushSubscription.js'
import ChatLog from '../models/ChatLog.js'

const BASE_MODELS = [
    { name: 'users', model: User },
    { name: 'plants', model: Plant },
    { name: 'push_subscriptions', model: PushSubscription },
    { name: 'chat_logs', model: ChatLog }
]

export async function ensureBaseSchema({ log = () => {} } = {}) {
    await sequelize.authenticate()

    const synced = []
    for (const { name, model } of BASE_MODELS) {
        await model.sync()
        synced.push(name)
        log(`✓ ${name}`)
    }
    return synced
}

async function main() {
    const target = `${process.env.DB_NAME || '?'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`
    console.log(`Базовая схема для миграций: ${target}`)

    const startedAt = Date.now()
    const synced = await ensureBaseSchema({ log: message => console.log(`  ${message}`) })

    await sequelize.close()
    console.log(`Готово за ${Date.now() - startedAt} мс: ${synced.join(', ')}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
    main().catch(async error => {
        console.error('Не удалось подготовить базовую схему:', error)
        await sequelize.close().catch(() => {})
        process.exit(1)
    })
}
