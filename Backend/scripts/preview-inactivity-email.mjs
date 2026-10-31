import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMailConfigured, sendMail } from '../services/mailService.js'
import { renderInactivityEmail } from '../services/inactivityEmailService.js'
import { buildListUnsubscribeHeaders, buildUnsubscribeUrl } from '../utils/marketingConsent.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DEFAULT_OUT = path.join(REPO_ROOT, 'state', 'tmp', 'inactivity-email-preview.html')
const DAY_MS = 24 * 60 * 60 * 1000

const args = process.argv.slice(2)

function readArg(name) {
    const prefix = `--${name}=`
    const found = args.find(argument => argument.startsWith(prefix))
    return found ? found.slice(prefix.length) : ''
}

function fail(message) {
    console.error(`❌ ${message}`)
    process.exitCode = 1
}

const wantsSend = args.includes('--send')
const recipient = readArg('to').trim()
const userName = readArg('name').trim() || 'Иван'
const outPath = path.resolve(readArg('out').trim() || DEFAULT_OUT)
const userId = Number.parseInt(readArg('user-id'), 10)
const parsedDays = Number.parseInt(readArg('days'), 10)
const silenceDays = Number.isInteger(parsedDays) && parsedDays > 0 ? parsedDays : 7

const lastVisitArg = readArg('last-visit').trim()
const lastVisitDate = lastVisitArg || new Date(Date.now() - 10 * DAY_MS)

let unsubscribeUrl = ''
let headers
try {
    const options = { frontendUrl: process.env.FRONTEND_URL, secret: process.env.SECRET_KEY }
    unsubscribeUrl = buildUnsubscribeUrl(Number.isInteger(userId) && userId > 0 ? userId : 1234, options)
    headers = buildListUnsubscribeHeaders(Number.isInteger(userId) && userId > 0 ? userId : 1234, options)
} catch (error) {
    console.warn(
        '⚠️ Ссылка отписки не построена (нет SECRET_KEY/FRONTEND_URL):',
        error?.message || error
    )
}

const message = renderInactivityEmail({
    userName,
    lastVisitDate,
    silenceDays,
    unsubscribeUrl,
    homeUrl: process.env.FRONTEND_URL ? `${String(process.env.FRONTEND_URL).split(',')[0].trim().replace(/\/+$/, '')}/home` : undefined
})

await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, message.html, 'utf8')

console.log(`=== Письмо «${message.subject}» (preview) ===`)
console.log(`Кому (демо):   ${userName}`)
console.log(`Последний заход: ${lastVisitDate instanceof Date ? lastVisitDate.toISOString().slice(0, 10) : lastVisitDate}`)
console.log(`Subject:       ${message.subject}`)
console.log(`Отписка:       ${unsubscribeUrl || '(без ссылки — нет SECRET_KEY/FRONTEND_URL)'}`)
console.log(`List-Unsubscribe: ${headers ? 'есть' : 'нет'}`)
console.log(`HTML сохранён: ${outPath}`)
console.log('')
console.log('=== Текстовая версия ===')
console.log(message.text)
console.log('')
console.log('В БД скрипт не ходит: рендер письма с демо-данными.')
console.log('Отправка — только по явным флагам: node scripts/preview-inactivity-email.mjs --send --to=you@example.com')

if (!wantsSend) process.exit(0)

if (!recipient || !recipient.includes('@')) {
    fail('Для отправки укажите --send --to=EMAIL')
    process.exit(1)
}
if (!isMailConfigured()) {
    fail('SMTP не настроен: заполните SMTP_USER и SMTP_PASSWORD в Backend/.env')
    process.exit(1)
}
if (!headers) {
    console.warn('⚠️ List-Unsubscribe не будет: не хватает SECRET_KEY/FRONTEND_URL в окружении')
}

try {
    const info = await sendMail({ to: recipient, headers, ...message })
    console.log(`✅ Тестовое письмо отправлено на ${recipient}: ${info?.messageId || '(без messageId)'}`)
} catch (error) {
    fail(`Письмо не отправилось: ${error?.message || error}`)
    process.exit(1)
}
