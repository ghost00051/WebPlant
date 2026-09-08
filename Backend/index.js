import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import cookieParser from 'cookie-parser'
import { getGuestToken } from './middleware/guestToken.js'
import sequelize from "./db.js"
import "./models/userModels.js"
import "./models/userCookieConsentModels.js"
import "./models/userLegalConsentModels.js"
import { startCleanupJob } from './jobs/cleanExpiredTokens.js'
import userRouter from "./routes/userRoutes.js"
import userCookieConsentRouter from "./routes/userCookieConsentRoutes.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}))
app.use(cookieParser())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(getGuestToken)

app.use("/api/users", userRouter)
app.use("/api/cookie-consents", userCookieConsentRouter)

app.use((err, req, res, next) => {
    console.error("❌ Error:", err)
    res.status(500).json({ message: "Internal server error" })
})

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