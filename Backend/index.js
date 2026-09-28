import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import cookieParser from 'cookie-parser'
import path from 'path'
import { getGuestToken } from './middleware/guestToken.js'
import sequelize from "./db.js"

import "./models/userModels.js"
import "./models/userCookieConsentModels.js"
import "./models/userLegalConsentModels.js"
import "./models/PushSubscription.js"
import "./models/Plant.js"
import "./models/PlantPhoto.js"
import "./models/WateringLog.js" 
import "./models/ChatLog.js" 


import "./models/associations.js"

import pushRouter from "./routes/pushRoutes.js"
import { startCleanupJob } from './jobs/cleanExpiredTokens.js'
import userRouter from "./routes/userRoutes.js"
import userCookieConsentRouter from "./routes/userCookieConsentRoutes.js"
import plantRouter from "./routes/plantRoutes.js"
import systemRouter from "./routes/systemRoutes.js"
import uploadRouter from "./routes/uploadRoutes.js"
import reminderService from './jobs/reminderService.js'
import chatRouter from './routes/chatRoutes.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.set('trust proxy', 1)

app.use(cors({
    origin: (origin, callback) => {
        const allowed = [
            process.env.FRONTEND_URL,
            'https://frontdevivan.ru',
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'http://192.168.0.167:5173',
            'http://192.168.0.176:5173',
        ].filter(Boolean)
        const isLocalNetwork = origin && /^http:\/\/(192\.168\.\d+\.\d+|127\.0\.0\.1|localhost):\d+$/.test(origin)
        if (!origin || allowed.includes(origin) || isLocalNetwork) {
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}))

app.use(cookieParser())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(getGuestToken)

app.use('/uploads', express.static(path.resolve('uploads'), {
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
}))

app.use("/api/users", userRouter)
app.use("/api/cookie-consents", userCookieConsentRouter)
app.use("/api/push", pushRouter)
app.use("/api/plants", plantRouter)
app.use("/api/system", systemRouter)
app.use("/api/upload", uploadRouter)
app.use('/api/chat', chatRouter)

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use((err, req, res, next) => {
    console.error("❌ Error:", err)
    res.status(500).json({ message: "Internal server error" })
})

startCleanupJob()
console.log("⏰ Запущена очистка истекших согласий")
reminderService.start() 

async function startServer() {
    try {
        console.log("🔄 Подключение к базе данных...")
        await sequelize.authenticate()
        console.log("✅ База данных подключена успешно!")

        console.log("🔄 Создание/обновление таблиц...")
        await sequelize.sync()
        console.log("✅ Таблицы созданы/обновлены успешно!")

        startCleanupJob()
        console.log("⏰ Запущена очистка истекших согласий")

        const tableExists = await checkTableExists('user_cookie_consents')
        if (tableExists) {
            console.log("✅ Таблица 'user_cookie_consents' существует")
            await checkTableStructure()
        } else {
            console.warn("⚠️ Таблица 'user_cookie_consents' не найдена!")
        }

        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`)
            console.log(`🌐 http://localhost:${PORT}`)
        })
    } catch (error) {
        console.error("❌ Ошибка при запуске сервера:", error)
        process.exit(1)
    }
}

async function checkTableExists(tableName) {
    try {
        const [results] = await sequelize.query(`
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.tables 
                WHERE table_name = '${tableName}'
            );
        `)
        return results[0].exists
    } catch (error) {
        console.error(`❌ Ошибка проверки таблицы ${tableName}:`, error)
        return false
    }
}

async function checkTableStructure() {
    try {
        const [columns] = await sequelize.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'user_cookie_consents'
            ORDER BY ordinal_position;
        `)

        console.log("📋 Структура таблицы 'user_cookie_consents':")
        columns.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(NULL)' : '(NOT NULL)'}`)
        })

        const [indexes] = await sequelize.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'user_cookie_consents';
        `)

        console.log("📋 Индексы таблицы 'user_cookie_consents':")
        indexes.forEach(idx => {
            console.log(`   - ${idx.indexname}`)
        })

        return true
    } catch (error) {
        console.error("❌ Ошибка проверки структуры таблицы:", error)
        return false
    }
}

startServer()