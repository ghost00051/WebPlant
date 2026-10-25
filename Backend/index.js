import 'dotenv/config'
import express from "express"
import cors from "cors"
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import path from 'path'
import { getGuestToken } from './middleware/guestToken.js'
import { refreshRememberedSession } from './middleware/auth.js'
import { accessLog, logError, requestContext } from './middleware/accessLog.js'
import { validateJsonShape } from './middleware/validateJsonShape.js'
import { isAllowedOrigin, parseLocalDevOrigins } from './utils/origins.js'
import { plantThumbRequestHandler } from './utils/plantPhotoThumb.js'
import { validateProductionPasskeyConfig } from './utils/passkeyConfig.js'
import { describeMailConfigProblems, describeMailStatus, isMailConfigured } from './services/mailService.js'
import { closeRedis, describeRedisStatus, isRedisConfigured, pingRedis } from './redis.js'
import { getAiCacheStats } from './utils/aiCache.js'
import * as pushServiceModule from './services/pushService.js'
import sequelize from "./db.js"

import "./models/userModels.js"
import "./models/userCookieConsentModels.js"
import "./models/userLegalConsentModels.js"
import "./models/PushSubscription.js"
import "./models/NotificationPreference.js"
import "./models/Notification.js"
import "./models/PushBroadcast.js"
import "./models/PushBroadcastRecipient.js"
import "./models/MailBroadcast.js"
import "./models/MailBroadcastRecipient.js"
import "./models/PasswordResetToken.js"
import "./models/Plant.js"
import "./models/PlantCarePlan.js"
import "./models/PlantPhoto.js"
import "./models/WateringLog.js"
import "./models/PlantCareLog.js"
import "./models/ChatLog.js"
import "./models/AiAdviceLog.js"
import "./models/SiteVisit.js"
import "./models/ProductEvent.js"
import "./models/GardenShare.js"
import "./models/GardenShareSignup.js"
import "./models/BotLink.js"
import "./models/BotLinkCode.js"
import "./models/BotMessage.js"


import "./models/associations.js"

import pushRouter from "./routes/pushRoutes.js"
import adminPushRouter from './routes/adminPushRoutes.js'
import adminMailRouter from './routes/adminMailRoutes.js'
import adminRouter from './routes/adminRoutes.js'
import adminBotsRouter from './routes/adminBotsRoutes.js'
import botRouter from './routes/botRoutes.js'
import notificationRouter from './routes/notificationRoutes.js'
import eventRouter from './routes/eventRoutes.js'
import { startCleanupJob } from './jobs/cleanExpiredTokens.js'
import { startPushBroadcastJob } from './jobs/pushBroadcastJob.js'
import { startMailBroadcastJob } from './jobs/mailBroadcastJob.js'
import userRouter from "./routes/userRoutes.js"
import careStreakRouter from './routes/careStreakRoutes.js'
import userCookieConsentRouter from "./routes/userCookieConsentRoutes.js"
import plantRouter from "./routes/plantRoutes.js"
import systemRouter from "./routes/systemRoutes.js"
import uploadRouter from "./routes/uploadRoutes.js"
import reminderService from './jobs/reminderService.js'
import weeklyRecapJob from './jobs/weeklyRecapJob.js'
import botPollingJob from './jobs/botPollingJob.js'
import chatRouter from './routes/chatRoutes.js'
import gardenShareRouter from './routes/gardenShareRoutes.js'
import { getWebhookState } from './services/botChannelService.js'
import { describeBotConfigProblems } from './utils/botConfig.js'

const app = express()
const PORT = Number(process.env.PORT || 5000)
const BACKGROUND_JOBS_ENABLED = process.env.BACKGROUND_JOBS_ENABLED !== 'false'
const MIGRATION_FILES_BY_TABLE = {
    auth_sessions: 'Backend/migrations/20261002_create_auth_and_passkey_tables.sql',
    passkeys: 'Backend/migrations/20261002_create_auth_and_passkey_tables.sql',
    passkey_challenges: 'Backend/migrations/20261002_create_auth_and_passkey_tables.sql',
    notification_preferences: 'Backend/migrations/20261005_create_notification_preferences.sql',
    'notification_preferences.care_advice_enabled': 'Backend/migrations/20261020_extend_notifications_for_care.sql',
    'notification_preferences.last_care_advice_date': 'Backend/migrations/20261020_extend_notifications_for_care.sql',
    notifications: 'Backend/migrations/20261006_create_notifications.sql',
    'notifications.payload': 'Backend/migrations/20261020_extend_notifications_for_care.sql',
    'notifications.type': 'Backend/migrations/20261020_extend_notifications_for_care.sql',
    push_broadcasts: 'Backend/migrations/20261010_create_push_broadcasts.sql',
    push_broadcast_recipients: 'Backend/migrations/20261010_create_push_broadcasts.sql',
    'push_subscriptions.last_success_at': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_subscriptions.last_error': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_subscriptions.failed_attempts': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_subscriptions.invalidated_at': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_subscriptions.invalid_reason': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcasts.idempotency_key': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcasts.started_at': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcasts.updated_at': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcasts.last_processed_id': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcasts.chunk_size': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcast_recipients.status': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcast_recipients.attempts': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcast_recipients.sent_at': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    'push_broadcast_recipients.last_error': 'Backend/migrations/20261022_push_delivery_hardening.sql',
    mail_broadcasts: 'Backend/migrations/20261014_create_mail_broadcasts.sql',
    mail_broadcast_recipients: 'Backend/migrations/20261014_create_mail_broadcasts.sql',
    password_reset_tokens: 'Backend/migrations/20261012_create_password_reset_tokens.sql',
    ai_advice_logs: 'Backend/migrations/20261016_create_ai_advice_logs.sql',
    plant_care_plans: 'Backend/migrations/20261021_create_plant_care_plans.sql',
    plant_care_logs: 'Backend/migrations/20261031_create_plant_care_logs.sql',
    chat_logs: 'Backend/migrations/20261017_add_chat_logs_guest_index.sql',
    'users.welcome_email_sent_at': 'Backend/migrations/20261012_add_welcome_email_sent_at.sql',
    'users.timezone': 'Backend/migrations/20261013_add_user_timezone.sql',
    'users.created_at': 'Backend/migrations/20261027_add_users_created_at.sql',
    'users.marketing_email_opt_in': 'Backend/migrations/20261026_add_marketing_consent.sql',
    'users.marketing_email_opt_in_at': 'Backend/migrations/20261026_add_marketing_consent.sql',
    'users.marketing_email_opt_in_source': 'Backend/migrations/20261026_add_marketing_consent.sql',
    'users.marketing_email_opt_out_at': 'Backend/migrations/20261026_add_marketing_consent.sql',
    admin_audit_logs: 'Backend/migrations/20261025_create_admin_audit_logs.sql',
    bot_links: 'Backend/migrations/20261101_create_bot_channels.sql',
    bot_link_codes: 'Backend/migrations/20261101_create_bot_channels.sql',
    bot_messages: 'Backend/migrations/20261101_create_bot_channels.sql',
    'notification_preferences.weekly_recap_enabled': 'Backend/migrations/20261102_add_weekly_recap.sql',
    'notification_preferences.last_weekly_recap_date': 'Backend/migrations/20261102_add_weekly_recap.sql',
    product_events: 'Backend/migrations/20261027_create_product_events.sql',
    'notifications.clicked_at': 'Backend/migrations/20261027_add_notification_clicks.sql',
    'notifications.click_count': 'Backend/migrations/20261027_add_notification_clicks.sql',
    'site_visit_days.utm_source': 'Backend/migrations/20261027_add_visits_utm.sql',
    'site_visit_days.utm_medium': 'Backend/migrations/20261027_add_visits_utm.sql',
    'site_visit_days.utm_campaign': 'Backend/migrations/20261027_add_visits_utm.sql',
    site_visit_days: 'Backend/migrations/20261012_create_admin_analytics.sql',
    garden_shares: 'Backend/migrations/20261028_create_garden_shares.sql',
    garden_share_signups: 'Backend/migrations/20261028_create_garden_shares.sql'
}

function formatSchemaMigrationHint(missing) {
    const hintedFiles = new Set()
    for (const entry of missing) {
        const [tableName] = entry.split('.')
        const migrationFile = MIGRATION_FILES_BY_TABLE[entry] || MIGRATION_FILES_BY_TABLE[tableName]
        if (migrationFile) hintedFiles.add(migrationFile)
    }
    if (!hintedFiles.size) return 'Review Backend/migrations/ and apply the missing SQL manually.'
    return `Apply migration(s): ${[...hintedFiles].join(' ; ')}`
}

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

    for (const problem of describeMailConfigProblems()) {
        console.warn(`⚠️ Почта: ${problem}`)
    }
}

app.set('trust proxy', 1)

app.use(requestContext)
app.use(accessLog)

app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    next()
})

app.use(cors({
    origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Idempotency-Key'],
    maxAge: 600
}))

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(cookieParser())
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 1000 }))
app.use(validateJsonShape)

const ALLOWED_CONTENT_TYPES = new Set([
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data'
])

app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()

    const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'))
    if (!hasBody) return next()

    const rawType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!rawType) {
        return res.status(415).json({ message: 'Требуется заголовок Content-Type: application/json' })
    }
    if (ALLOWED_CONTENT_TYPES.has(rawType) || rawType.endsWith('+json')) return next()

    return res.status(415).json({ message: 'Неподдерживаемый Content-Type' })
})

app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.get('origin')
        const fetchSite = req.get('sec-fetch-site')
        const hasAuthCookie = Boolean(
            req.cookies?.token ||
            req.cookies?.refresh_token ||
            req.cookies?.guest_token
        )
        if ((origin && !isAllowedOrigin(origin)) ||
            (!origin && fetchSite === 'cross-site') ||
            (hasAuthCookie && !origin)) {
            return res.status(403).json({ message: 'Запрос с этого источника запрещён' })
        }
    }
    next()
})
app.use(refreshRememberedSession)

app.use('/uploads/thumbs', plantThumbRequestHandler())
app.use('/uploads', express.static(path.resolve('uploads'), {
    maxAge: '365d',
    immutable: true,
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
}))

app.use("/api/users", careStreakRouter)
app.use("/api/users", userRouter)
app.use("/api/cookie-consents", getGuestToken, userCookieConsentRouter)
app.use("/api/push", pushRouter)
app.use("/api/admin/push", adminPushRouter)
app.use("/api/admin/mail", adminMailRouter)
app.use("/api/admin/bots", adminBotsRouter)
app.use("/api/admin", adminRouter)
app.use("/api/notifications", notificationRouter)
app.use("/api/events", eventRouter)
app.use("/api/plants", plantRouter)
app.use("/api/system", systemRouter)
app.use("/api/upload", uploadRouter)
app.use('/api/chat', getGuestToken, chatRouter)
app.use('/api/garden', gardenShareRouter)
app.use('/api/bots', botRouter)

app.get('/livez', (req, res) => {
    return res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

function describePushStatus() {
    try {
        const getPushStatus = pushServiceModule.getPushStatus
        return typeof getPushStatus === 'function'
            ? getPushStatus()
            : { configured: null }
    } catch (error) {
        return { configured: false, error: error?.message || String(error) }
    }
}

function describeBotsStatus() {
    try {
        return {
            enabled: process.env.BOTS_ENABLED !== 'false',
            webhookEnabled: process.env.BOT_WEBHOOK_ENABLED === 'true',
            polling: botPollingJob.getPollingState(),
            webhooks: getWebhookState()
        }
    } catch (error) {
        return {
            enabled: process.env.BOTS_ENABLED !== 'false',
            webhookEnabled: process.env.BOT_WEBHOOK_ENABLED === 'true',
            error: error?.message || String(error)
        }
    }
}

app.get('/health', async (req, res) => {
    try {
        await sequelize.authenticate()
        return res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            deployTarget: process.env.DEPLOY_TARGET || null,
            redis: describeRedisStatus(),
            mail: describeMailStatus(),
            push: describePushStatus(),
            bots: describeBotsStatus(),
            backgroundJobs: BACKGROUND_JOBS_ENABLED,
            aiCache: getAiCacheStats()
        })
    } catch (error) {
        logError(error, req, 'health_check_failed')
        return res.status(503).json({ status: 'unavailable' })
    }
})

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n')
})

app.use((req, res) => {
    res.status(404).json({ message: 'Маршрут не найден' })
})

app.use((err, req, res, next) => {
    logError(err, req, 'unhandled_error')
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

        if (isRedisConfigured()) {
            const redisReady = await pingRedis()
            console.log(redisReady
                ? "✅ Redis подключён: кэш ИИ, распределённые локи и общий rate-limit активны"
                : "⚠️ Redis недоступен: работаем без кэша ИИ, локов и общего rate-limit")
        }

        if (isMailConfigured()) {
            console.log(`✅ SMTP настроен (${process.env.SMTP_HOST || 'smtp.mail.ru'}): письма сброса пароля и рассылки из админки будут отправляться`)
        } else {
            console.warn("⚠️ SMTP не настроен: восстановление пароля и рассылки писем вернут 503 (см. SMTP_USER/SMTP_PASSWORD)")
        }

        for (const problem of describeBotConfigProblems()) {
            console.warn(`⚠️ Боты: ${problem}`)
        }
        if (process.env.BOTS_ENABLED !== 'false') {
            console.log(
                '🤖 Боты: каналы Telegram/MAX, ' +
                `вебхуки ${process.env.BOT_WEBHOOK_ENABLED === 'true' ? 'включены' : 'выключены'}, ` +
                `long polling ${process.env.BOT_POLLING_ENABLED === 'true' ? 'включён' : 'выключен'}`
            )
        }

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
                const migrationHint = formatSchemaMigrationHint(missing)
                throw new Error(`Database schema is missing required tables or columns: ${missing.join(', ')}. ${migrationHint}`)
            }
            console.log("✅ Схема production-базы проверена")
        } else {
            console.log("🔄 Создание таблиц для непроизводственной среды...")
            await sequelize.sync()
            console.log("✅ Таблицы созданы/обновлены успешно!")
        }

        if (BACKGROUND_JOBS_ENABLED) {
            startCleanupJob()
            console.log("⏰ Запущена очистка истекших согласий и auth-данных")
            reminderService.start()
            weeklyRecapJob.start()
            botPollingJob.start()
            startPushBroadcastJob()
            startMailBroadcastJob()
            console.log("📣 Планировщик отложенных рассылок запущен")
        } else {
            console.log("⏸ Фоновые задачи отключены (BACKGROUND_JOBS_ENABLED=false)")
        }

        const server = app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`)
            console.log(`🌐 http://localhost:${PORT}`)
        })

        let shuttingDown = false
        const shutdown = signal => {
            if (shuttingDown) return
            shuttingDown = true
            console.log(`⏹ Получен ${signal}: останавливаю приём новых запросов`)

            const forceExit = setTimeout(() => {
                console.error('⚠️ Соединения не завершились за 20 секунд, принудительный выход')
                process.exit(1)
            }, 20_000)
            forceExit.unref()

            server.close(async () => {
                try {
                    weeklyRecapJob.stop()
                    await botPollingJob.stop()
                } catch (error) {
                    console.error('❌ Ошибка остановки ботов и recap:', error)
                }
                try {
                    await closeRedis()
                } catch (error) {
                    console.error('❌ Ошибка закрытия Redis:', error)
                }
                clearTimeout(forceExit)
                process.exit(0)
            })
        }

        process.on('SIGTERM', () => shutdown('SIGTERM'))
        process.on('SIGINT', () => shutdown('SIGINT'))
    } catch (error) {
        console.error("❌ Ошибка при запуске сервера:", error)
        process.exit(1)
    }
}

startServer()