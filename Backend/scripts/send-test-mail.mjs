import 'dotenv/config'
import {
    describeMailConfigProblems,
    isMailConfigured,
    readMailConfig,
    sendMail,
    verifyMailConnection
} from '../services/mailService.js'
import { buildResetUrl } from '../utils/passwordReset.js'

const config = readMailConfig()
const recipient = process.argv[2] || config.user

function fail(message) {
    console.error(`❌ ${message}`)
    process.exitCode = 1
}

console.log('=== Настройки SMTP ===')
console.log(`Хост:      ${config.host}:${config.port} (secure=${config.secure})`)
console.log(`Логин:     ${config.user || '(не задан)'}`)
console.log(`Пароль:    ${config.password ? 'задан' : '(не задан)'}`)
console.log(`От кого:   ${config.fromName} <${config.fromAddress || config.user}>`)
console.log(`Кому:      ${recipient || '(не задан)'}`)

const problems = describeMailConfigProblems()
if (problems.length) {
    console.log('\n=== Замечания ===')
    for (const problem of problems) console.log(`• ${problem}`)
}

if (!isMailConfigured()) {
    fail('SMTP не настроен: заполните SMTP_USER и SMTP_PASSWORD в Backend/.env')
    process.exit(1)
}

if (!recipient) {
    fail('Не указан получатель: node scripts/send-test-mail.mjs you@example.com')
    process.exit(1)
}

const check = await verifyMailConnection()
if (!check.ok) {
    fail(`Не удалось подключиться к ${config.host}:${config.port} — ${check.error}`)
    console.log('Подсказка: в mail.ru включите доступ по протоколам и создайте «пароль для внешних приложений».')
    process.exit(1)
}
console.log('\n✅ Соединение с SMTP установлено, авторизация прошла')

let sampleUrl = ''
try {
    sampleUrl = buildResetUrl('test-token-0000000000000000000000000000000000000', process.env.FRONTEND_URL)
} catch {
    sampleUrl = 'https://checktheplants.ru/reset-password?token=<токен>'
}

try {
    const info = await sendMail({
        to: recipient,
        subject: 'Проверка почты «Лейка»',
        text: [
            'Это тестовое письмо от backend-а «Лейки».',
            'Если вы его видите, SMTP настроен верно и письма сброса пароля будут уходить.',
            '',
            `Пример ссылки из письма: ${sampleUrl}`,
            '',
            '— Лейка, https://checktheplants.ru'
        ].join('\n')
    })
    console.log(`✅ Письмо отправлено: ${info.messageId || '(без messageId)'}`)
    console.log(`   Принято получателей: ${(info.accepted || []).join(', ') || '(нет)'}`)
    console.log('   Проверьте входящие и папку «Спам».')
} catch (error) {
    fail(`Письмо не отправилось: ${error.message}`)
    console.log('Частые причины: 535 — неверный пароль (нужен пароль приложения),')
    console.log('550/553 — адрес отправителя не принадлежит ящику SMTP_USER,')
    console.log('554 — сработал антиспам mail.ru (письмо отклонено как спам).')
    process.exit(1)
}
