// Приветственное письмо: рассылка тем, кто зарегистрировался раньше,
// и проверочная отправка на один адрес.
//
// Запуск из каталога Backend:
//   node scripts/send-welcome-emails.mjs                     # сухой прогон: список получателей
//   node scripts/send-welcome-emails.mjs --send              # отправить всем, кому ещё не уходило
//   node scripts/send-welcome-emails.mjs --to you@example.com  # одно письмо для проверки вёрстки
//   node scripts/send-welcome-emails.mjs --send --force      # отправить повторно, даже если уже уходило
//
// В кластере:
//   kubectl exec -n webplant deployment/backend -- node scripts/send-welcome-emails.mjs --send
import 'dotenv/config'
import { Op } from 'sequelize'
import sequelize from '../db.js'
import User from '../models/userModels.js'
import { getFirstName } from '../utils/personName.js'
import { isMailConfigured, readMailConfig, renderWelcomeEmail, sendWelcomeEmail } from '../services/mailService.js'
import { sendWelcomeEmailToUser } from '../services/welcomeEmailService.js'

const args = process.argv.slice(2)

function readOption(name) {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
}

const shouldSend = args.includes('--send')
const force = args.includes('--force')
const to = readOption('--to')
const name = readOption('--name') || ''
const delayMs = Number.parseInt(readOption('--delay') || '1500', 10)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function printLetterPreview(recipientName) {
    const { subject, text } = renderWelcomeEmail({ userName: recipientName })
    console.log(`\nТема: ${subject}`)
    console.log('--- текст письма ---')
    console.log(text)
    console.log('--------------------\n')
}

try {
    if (!isMailConfigured()) {
        console.error('❌ SMTP не настроен: заполните SMTP_USER и SMTP_PASSWORD в Backend/.env')
        process.exit(1)
    }
    const config = readMailConfig()
    console.log(`SMTP: ${config.host}:${config.port}, от кого: ${config.fromName} <${config.fromAddress}>`)

    if (to) {
        console.log(`Отправляю одно проверочное письмо на ${to}`)
        printLetterPreview(name)
        const info = await sendWelcomeEmail({ to, userName: name })
        console.log(`✅ Отправлено: ${info.messageId || '(без messageId)'}`)
        console.log('Отметка в базе не ставится — это проверочная отправка.')
        await sequelize.close()
        process.exit(0)
    }

    const where = force
        ? { email: { [Op.ne]: '' } }
        : { welcome_email_sent_at: null }

    const users = await User.findAll({
        where,
        attributes: ['id', 'email', 'name', 'welcome_email_sent_at'],
        order: [['id', 'ASC']]
    })

    if (!users.length) {
        console.log('Нет получателей: всем пользователям приветственное письмо уже уходило (--force отправит повторно).')
        await sequelize.close()
        process.exit(0)
    }

    console.log(`\nПолучателей: ${users.length}`)
    for (const user of users) {
        console.log(`  #${user.id}  ${user.email}  ${user.name ? `(${user.name})` : '(без имени)'}` +
            `${user.welcome_email_sent_at ? '  — уже отправлялось' : ''}`)
    }

    printLetterPreview(getFirstName(users[0].name))

    if (!shouldSend) {
        console.log('Это сухой прогон. Чтобы отправить, добавьте --send')
        await sequelize.close()
        process.exit(0)
    }

    let sent = 0
    let failed = 0
    let skipped = 0
    for (const user of users) {
        const result = await sendWelcomeEmailToUser(user, { force })
        if (result.status === 'sent') {
            sent += 1
            console.log(`✅ #${user.id} ${user.email}`)
        } else if (result.status === 'failed') {
            failed += 1
            console.error(`❌ #${user.id} ${user.email}: ${result.error?.message || result.error}`)
        } else {
            skipped += 1
            console.log(`↷ #${user.id} ${user.email}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`)
        }
        if (delayMs > 0) await sleep(delayMs)
    }

    console.log(`\nИтого: отправлено ${sent}, ошибок ${failed}, пропущено ${skipped}`)
    await sequelize.close()
    process.exit(failed ? 1 : 0)
} catch (error) {
    console.error('❌ Ошибка рассылки приветственных писем:', error)
    await sequelize.close().catch(() => {})
    process.exit(1)
}
