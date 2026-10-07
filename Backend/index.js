import 'dotenv/config'
import express from "express"
import cors from "cors"
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import path from 'path'
import { getGuestToken } from './middleware/guestToken.js'
import { refreshRememberedSession } from './middleware/auth.js'
import { isAllowedOrigin, parseLocalDevOrigins } from './utils/origins.js'
import { validateProductionPasskeyConfig } from './utils/passkeyConfig.js'
import sequelize from "./db.js"

import "./models/userModels.js"
import "./models/userCookieConsentModels.js"
import "./models/userLegalConsentModels.js"
import "./models/PushSubscription.js"
import "./models/NotificationPreference.js"
import "./models/Notification.js"
import "./models/Plant.js"
import "./models/PlantPhoto.js"
import "./models/WateringLog.js"
import "./models/ChatLog.js"


import "./models/associations.js"

import pushRouter from "./routes/pushRoutes.js"
import notificationRouter from './routes/notificationRoutes.js'
import { startCleanupJob } from './jobs/cleanExpiredTokens.js'
import userRouter from "./routes/userRoutes.js"
import userCookieConsentRouter from "./routes/userCookieConsentRoutes.js"
import plantRouter from "./routes/plantRoutes.js"
import systemRouter from "./routes/systemRoutes.js"
import uploadRouter from "./routes/uploadRoutes.js"
import reminderService from './jobs/reminderService.js'
import chatRouter from './routes/chatRoutes.js'

const app = express()
const PORT = Number(process.env.PORT || 5000)

function validateProductionConfig() {
    if (process.env.NODE_ENV !== 'production') return
    parseLocalDevOrigins(process.env.LOCAL_DEV_ORIGINS)

    const required = [
        'DB_NAME',
        'DB_USER',
        'DB_PASSWORD',
        'SECRET_KEY',
        'FRONTEND_URL',
        'FRONTEND_ORIGIN',
        'RP_ID',
        'VAPID_SUBJECT',
        'VAPID_PUBLIC_KEY',
        'VAPID_PRIVATE_KEY'
    ]
    const missing = required.filter(name => !process.env[name]?.trim())
    if (missing.length) {
        throw new Error(`Missing required production environment variables: ${missing.join(', ')}`)
    }
    if (Buffer.byteLength(process.env.SECRET_KEY, 'utf8') < 32) {
        throw new Error('SECRET_KEY must contain at least 32 bytes in production')
    }

    const frontendUrls = process.env.FRONTEND_URL.split(',').map(value => value.trim()).filter(Boolean)
    if (!frontendUrls.length || frontendUrls.some(frontendUrl => {
        try {
            const url = new URL(frontendUrl)
            return url.protocol !== 'https:' ||
                url.pathname !== '/' ||
                url.search !== '' ||
                url.hash !== ''
        } catch {
            return true
        }
    })) {
        throw new Error('FRONTEND_URL must contain valid HTTPS origins separated by commas')
    }
    validateProductionPasskeyConfig({
        rpId: process.env.RP_ID,
        frontendOrigin: process.env.FRONTEND_ORIGIN,
        frontendUrl: process.env.FRONTEND_URL
    })
}

app.set('trust proxy', 1)

app.use(cors({
    origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}))

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(cookieParser())
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 1000 }))
app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.get('origin')
        const fetchSite = req.get('sec-fetch-site')
        const hasAuthCookie = Boolean(req.cookies?.token || req.cookies?.refresh_token)
        if ((origin && !isAllowedOrigin(origin)) ||
            (!origin && fetchSite === 'cross-site') ||
            (hasAuthCookie && !origin)) {
            return res.status(403).json({ message: 'Запрос с этого источника запрещён' })
        }
    }
    next()
})
app.use(refreshRememberedSession)

app.use('/uploads', express.static(path.resolve('uploads'), {
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
}))

app.use("/api/users", userRouter)
app.use("/api/cookie-consents", getGuestToken, userCookieConsentRouter)
app.use("/api/push", pushRouter)
app.use("/api/notifications", notificationRouter)
app.use("/api/plants", plantRouter)
app.use("/api/system", systemRouter)
app.use("/api/upload", uploadRouter)
app.use('/api/chat', getGuestToken, chatRouter)

app.get('/health', async (req, res) => {
    try {
        await sequelize.authenticate()
        return res.json({ status: 'ok', timestamp: new Date().toISOString() })
    } catch (error) {
        console.error('❌ Проверка готовности не пройдена:', error)
        return res.status(503).json({ status: 'unavailable' })
    }
})

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n')
})

app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    next()
})

app.use((req, res) => {
    res.status(404).json({ message: 'Маршрут не найден' })
})

app.use((err, req, res, next) => {
    console.error("❌ Error:", err)
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : err.code === 'LIMIT_FILE_SIZE'
            ? 413
            : typeof err.code === 'string' && err.code.startsWith('LIMIT_')
                ? 400
                : 500
    const message = status === 400
        ? 'Некорректный запрос'
        : status === 413
            ? 'Размер запроса превышает допустимый лимит'
            : 'Internal server error'
    res.status(status).json({ message })
})

async function startServer() {
    try {
        validateProductionConfig()
        if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
            throw new Error('PORT must be an integer between 1 and 65535')
        }
        console.log("🔄 Подключение к базе данных...")
        await sequelize.authenticate()
        console.log("✅ База данных подключена успешно!")

        if (process.env.NODE_ENV === 'production') {
            const queryInterface = sequelize.getQueryInterface()
            const tables = await queryInterface.showAllTables()
            const existingTables = new Set(tables.map(table =>
                typeof table === 'string' ? table : table.tableName
            ))
            const missing = []
            for (const model of Object.values(sequelize.models)) {
                const tableName = model.getTableName()
                if (!existingTables.has(tableName)) {
                    missing.push(tableName)
                    continue
                }
                const columns = await queryInterface.describeTable(tableName)
                for (const attribute of Object.values(model.rawAttributes)) {
                    const columnName = attribute.field || attribute.fieldName
                    if (!columns[columnName]) missing.push(`${tableName}.${columnName}`)
                }
            }
            if (missing.length) {
                throw new Error(`Database schema is missing required tables or columns: ${missing.join(', ')}`)
            }
            console.log("✅ Схема production-базы проверена")
        } else {
            console.log("🔄 Создание таблиц для непроизводственной среды...")
            await sequelize.sync()
            console.log("✅ Таблицы созданы/обновлены успешно!")
        }

        startCleanupJob()
        console.log("⏰ Запущена очистка истекших согласий и auth-данных")
        reminderService.start()

        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`)
            console.log(`🌐 http://localhost:${PORT}`)
        })
    } catch (error) {
        console.error("❌ Ошибка при запуске сервера:", error)
        process.exit(1)
    }
}

startServer()