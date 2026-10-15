import nodemailer from 'nodemailer'
import {
    RESET_TOKEN_TTL_MINUTES
} from '../utils/passwordReset.js'

const DEFAULT_SMTP_HOST = 'smtp.mail.ru'
const DEFAULT_SMTP_PORT = 465
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_SOCKET_TIMEOUT_MS = 20000
const PRODUCT_NAME = 'Лейка'
const PRODUCT_NAME_CASES = {
    nom: 'Лейка',
    gen: 'Лейки',
    acc: 'Лейку',
    pre: 'Лейке'
}
const PRODUCT_NAME_IN = PRODUCT_NAME_CASES.pre
const PRODUCT_URL = 'https://checktheplants.ru'
const DEFAULT_LOGO_URL = 'https://checktheplants.ru/icons/icon-192.png'
const DEVELOPER_NAME = 'Иван Никитин'
const APP_HOME_URL = `${PRODUCT_URL}/home`

let cachedTransporter = null
let cachedTransporterSignature = null

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readMailConfig(env = process.env) {
    const host = (env.SMTP_HOST || DEFAULT_SMTP_HOST).trim() || DEFAULT_SMTP_HOST
    const rawPort = parsePositiveInt(env.SMTP_PORT, DEFAULT_SMTP_PORT)
    const port = rawPort >= 1 && rawPort <= 65535 ? rawPort : DEFAULT_SMTP_PORT
    const secure = env.SMTP_SECURE === undefined || env.SMTP_SECURE === ''
        ? port === 465
        : env.SMTP_SECURE !== 'false'
    const user = (env.SMTP_USER || '').trim()
    const password = env.SMTP_PASSWORD || ''
    const fromAddress = (env.MAIL_FROM || user).trim()
    const fromName = (env.MAIL_FROM_NAME || PRODUCT_NAME).trim() || PRODUCT_NAME

    return {
        enabled: env.MAIL_ENABLED !== 'false',
        host,
        port,
        secure,
        user,
        password,
        fromAddress,
        fromName,
        replyTo: (env.MAIL_REPLY_TO || '').trim(),
        connectionTimeoutMs: parsePositiveInt(env.MAIL_CONNECT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        socketTimeoutMs: parsePositiveInt(env.MAIL_SOCKET_TIMEOUT_MS, DEFAULT_SOCKET_TIMEOUT_MS)
    }
}

export function isMailConfigured(env = process.env) {
    const config = readMailConfig(env)
    return Boolean(config.enabled && config.host && config.user && config.password)
}

export function describeMailStatus(env = process.env) {
    const config = readMailConfig(env)
    if (!config.enabled) return 'disabled'
    return Boolean(config.host && config.user && config.password) ? 'configured' : 'not-configured'
}

export function describeMailConfigProblems(env = process.env) {
    const config = readMailConfig(env)
    const problems = []

    if (!config.enabled) {
        return ['MAIL_ENABLED=false — отправка писем выключена вручную']
    }
    if (!config.user && !config.password) {
        return ['SMTP_USER и SMTP_PASSWORD не заданы — отправка писем недоступна']
    }
    if (!config.user) problems.push('SMTP_USER не задан')
    if (!config.password) {
        problems.push(
            'SMTP_PASSWORD не задан — в mail.ru нужен «пароль для внешних приложений», обычный пароль от почты не подойдёт'
        )
    }

    const domainOf = value => {
        const at = String(value || '').lastIndexOf('@')
        return at > 0 ? value.slice(at + 1).toLowerCase() : ''
    }
    if (config.fromAddress && config.user &&
        config.fromAddress.toLowerCase() !== config.user.toLowerCase() &&
        domainOf(config.fromAddress) !== domainOf(config.user)) {
        problems.push(
            `MAIL_FROM (${config.fromAddress}) не совпадает с SMTP_USER (${config.user}): ` +
            'mail.ru принимает письма только от адреса авторизованного ящика или его псевдонима'
        )
    }
    if (config.port === 465 && !config.secure) {
        problems.push('Для порта 465 нужен SMTP_SECURE=true')
    }
    if (config.port === 587 && config.secure) {
        problems.push('Для порта 587 нужен SMTP_SECURE=false (STARTTLS)')
    }

    return problems
}

function configSignature(config) {
    return [
        config.host,
        config.port,
        config.secure,
        config.user,
        config.password,
        config.connectionTimeoutMs,
        config.socketTimeoutMs
    ].join('|')
}

function getTransporter(env = process.env) {
    const config = readMailConfig(env)
    const signature = configSignature(config)
    if (cachedTransporter && cachedTransporterSignature === signature) return cachedTransporter

    cachedTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: config.connectionTimeoutMs,
        greetingTimeout: config.connectionTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
        dnsTimeout: config.connectionTimeoutMs,
        tls: { minVersion: 'TLSv1.2', servername: config.host }
    })
    cachedTransporterSignature = signature
    return cachedTransporter
}

export function resetMailTransport() {
    if (cachedTransporter && typeof cachedTransporter.close === 'function') {
        cachedTransporter.close()
    }
    cachedTransporter = null
    cachedTransporterSignature = null
}

function withTimeout(promise, timeoutMs, message) {
    let timer
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function verifyMailConnection(env = process.env) {
    if (!isMailConfigured(env)) {
        return { ok: false, error: 'SMTP не настроен' }
    }
    const config = readMailConfig(env)
    try {
        await withTimeout(
            getTransporter(env).verify(),
            config.socketTimeoutMs,
            'SMTP: превышено время проверки соединения'
        )
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error.message }
    }
}

export async function sendMail({ to, subject, text, html, replyTo }, env = process.env) {
    if (!isMailConfigured(env)) {
        throw new Error('SMTP не настроен: заполните SMTP_USER и SMTP_PASSWORD')
    }

    const config = readMailConfig(env)
    const from = config.fromName
        ? { name: config.fromName, address: config.fromAddress || config.user }
        : config.fromAddress || config.user
    const finalReplyTo = replyTo || config.replyTo || undefined

    return withTimeout(
        getTransporter(env).sendMail({
            from,
            to,
            subject,
            text,
            html,
            replyTo: finalReplyTo
        }),
        config.socketTimeoutMs + config.connectionTimeoutMs,
        'SMTP: превышено время отправки письма'
    )
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export function renderPasswordResetEmail({
    resetUrl,
    recipientEmail = '',
    userName = '',
    expiresInMinutes = RESET_TOKEN_TTL_MINUTES
}) {
    if (typeof resetUrl !== 'string' || !resetUrl) {
        throw new Error('renderPasswordResetEmail: resetUrl is required')
    }

    const greeting = userName ? `Здравствуйте, ${userName}!` : 'Здравствуйте!'
    const subject = `Сброс пароля в «${PRODUCT_NAME_IN}»`
    const safeUrl = escapeHtml(resetUrl)
    const text = [
        greeting,
        '',
        `Вы запросили сброс пароля в «${PRODUCT_NAME_IN}» (${PRODUCT_URL}).`,
        `Чтобы придумать новый пароль, перейдите по ссылке (она действует ${expiresInMinutes} мин):`,
        '',
        resetUrl,
        '',
        'Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо — пароль останется прежним,',
        'а ссылка станет недействительной через указанное время.',
        '',
        `— ${PRODUCT_NAME}, ${PRODUCT_URL}`
    ].join('\n')

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#1f2a24;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;padding:32px;">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:8px;">Сброс пароля</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:16px;">
${escapeHtml(greeting)}<br><br>
Вы запросили сброс пароля в «${escapeHtml(PRODUCT_NAME_IN)}». Нажмите кнопку ниже, чтобы придумать новый пароль.
</td></tr>
<tr><td align="center" style="padding:8px 0 20px;">
<a href="${safeUrl}" style="display:inline-block;background-color:#2f8f4e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:12px;">Создать новый пароль</a>
</td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#4a5a51;padding-bottom:16px;">
Ссылка действует ${expiresInMinutes} мин. Если кнопка не открывается, скопируйте адрес в браузер:<br>
<a href="${safeUrl}" style="color:#2f8f4e;word-break:break-all;">${safeUrl}</a>
</td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#4a5a51;border-top:1px solid #e6ece7;padding-top:16px;">
Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо — пароль останется прежним.
${recipientEmail ? `<br><br>Письмо отправлено на ${escapeHtml(recipientEmail)}.` : ''}
</td></tr>
<tr><td style="font-size:13px;color:#8a988f;padding-top:20px;">
— ${escapeHtml(PRODUCT_NAME)}, <a href="${PRODUCT_URL}" style="color:#8a988f;">checktheplants.ru</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

    return { subject, text, html }
}

export async function sendPasswordResetEmail({
    to,
    resetUrl,
    userName = '',
    env = process.env
}) {
    const message = renderPasswordResetEmail({
        resetUrl,
        recipientEmail: to,
        userName
    })
    return sendMail({ to, ...message }, env)
}

const WELCOME_SUBJECT = `Добро пожаловать в «${PRODUCT_NAME_CASES.acc}»`
const WELCOME_PREHEADER =
    'Спасибо, что вы с нами. Несколько слов от разработчика и три совета, с чего начать.'

const WELCOME_HIGHLIGHTS = [
    {
        title: 'Добавьте растение',
        text: 'подскажет, как часто его поливать, и посчитает следующий полив.'
    },
    {
        title: 'Настройте напоминания',
        text: 'выберите удобное время: напомним в браузере или в приложении на телефоне.'
    },
    {
        title: 'Загляните в справочник',
        text: 'короткие статьи об уходе и разбор частых проблем: от жёлтых листьев до полива в отпуске.'
    }
]

export function renderWelcomeEmail({
    userName = '',
    logoUrl = DEFAULT_LOGO_URL
}) {
    const greeting = userName ? `Привет, ${userName}!` : 'Привет!'
    const safeLogoUrl = escapeHtml(logoUrl)

    const text = [
        greeting,
        '',
        `Спасибо, что зарегистрировались в «${PRODUCT_NAME_IN}» — сервисе, который помогает не забывать о поливе растений.`,
        '',
        'С чего начать:',
        ...WELCOME_HIGHLIGHTS.map(item => `• ${item.title} — ${item.text}`),
        '',
        'Приложение я делаю один: код, интерфейс и поддержка — всё на мне. Поэтому особенно ценю каждого, кто им пользуется: ваши отзывы читаю сам и по ним правлю продукт.',
        '',
        'Если что-то не работает, чего-то не хватает или есть идея — просто ответьте на это письмо, оно придёт мне. Отвечу лично.',
        '',
        `Открыть свой сад: ${APP_HOME_URL}`,
        '',
        `— ${DEVELOPER_NAME}, разработчик «${PRODUCT_NAME_CASES.gen}»`,
        PRODUCT_URL
    ].join('\n')

    const highlightsHtml = WELCOME_HIGHLIGHTS.map(item => `
<tr>
<td valign="top" style="width:22px;font-size:16px;line-height:23px;color:#2f8f4e;font-weight:700;padding:0 0 12px;">✓</td>
<td style="font-size:15px;line-height:23px;color:#33413a;padding:0 0 12px;">
<strong style="font-weight:600;">${escapeHtml(item.title)}</strong> — ${escapeHtml(item.text)}
</td>
</tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(WELCOME_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#1f2a24;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(WELCOME_PREHEADER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:18px;padding:32px;">
<tr><td align="center" style="padding-bottom:14px;">
<img src="${safeLogoUrl}" width="76" height="76" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;width:76px;height:76px;border:0;border-radius:50%;">
</td></tr>
<tr><td align="center" style="font-size:22px;line-height:30px;font-weight:700;color:#1f2a24;padding-bottom:6px;">Добро пожаловать в «${escapeHtml(PRODUCT_NAME_CASES.acc)}»!</td></tr>
<tr><td align="center" style="font-size:14px;line-height:20px;color:#6b7a71;padding-bottom:24px;">Сервис для тех, кто не хочет забывать о поливе</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:12px;">${escapeHtml(greeting)}</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-bottom:20px;">
Спасибо, что зарегистрировались в «${escapeHtml(PRODUCT_NAME_IN)}». Она помогает не забывать о поливе: считает расписание, напоминает о каждом растении и хранит историю ухода.
</td></tr>
<tr><td style="font-size:13px;line-height:18px;font-weight:600;color:#6b7a71;letter-spacing:0.4px;text-transform:uppercase;padding-bottom:12px;">С чего начать</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${highlightsHtml}
</table>
</td></tr>
<tr><td style="padding:10px 0 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f8f3;border-radius:14px;">
<tr><td style="padding:20px 22px;font-size:15px;line-height:23px;color:#2c3a32;">
«${escapeHtml(PRODUCT_NAME)}» я делаю один: код, интерфейс и поддержка — всё на мне. Поэтому особенно ценю каждого, кто ей пользуется: ваши отзывы читаю сам и по ним правлю продукт.<br><br>
Если что-то не работает, чего-то не хватает или есть идея — просто ответьте на это письмо, оно придёт мне. Отвечу лично.
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:26px 0 6px;">
<a href="${APP_HOME_URL}" style="display:inline-block;background-color:#2f8f4e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:15px 30px;border-radius:12px;">Открыть свой сад</a>
</td></tr>
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-top:20px;">
— ${escapeHtml(DEVELOPER_NAME)}, разработчик «${escapeHtml(PRODUCT_NAME_CASES.gen)}»<br>
<a href="${PRODUCT_URL}" style="color:#2f8f4e;text-decoration:none;">checktheplants.ru</a>
</td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#8a988f;border-top:1px solid #e6ece7;padding-top:16px;">
Отвечать на это письмо можно как обычно — ответ придёт разработчику.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

    return { subject: WELCOME_SUBJECT, text, html }
}

export async function sendWelcomeEmail({
    to,
    userName = '',
    env = process.env
}) {
    const message = renderWelcomeEmail({ userName })
    return sendMail({ to, ...message }, env)
}

export function resolveAbsoluteUrl(url, baseUrl = PRODUCT_URL) {
    if (typeof url !== 'string') return ''
    const trimmed = url.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `${baseUrl}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`
}

function bodyToParagraphs(body) {
    return String(body)
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map(block => block.replace(/^\n+/, '').replace(/\n+$/, ''))
        .filter(block => block.trim())
        .map(block => `<p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#33413a;">${
            escapeHtml(block).replace(/\n/g, '<br>')
        }</p>`)
        .join('\n')
}

export function renderBroadcastEmail({
    subject,
    body,
    userName = '',
    ctaLabel = '',
    ctaUrl = '',
    recipientEmail = '',
    logoUrl = DEFAULT_LOGO_URL
}) {
    const cleanSubject = typeof subject === 'string' ? subject.trim() : ''
    if (!cleanSubject) {
        throw new Error('renderBroadcastEmail: subject is required')
    }
    const cleanBody = typeof body === 'string' ? body.trim() : ''
    if (!cleanBody) {
        throw new Error('renderBroadcastEmail: body is required')
    }

    const greeting = userName ? `Здравствуйте, ${userName}!` : 'Здравствуйте!'
    const absoluteCtaUrl = resolveAbsoluteUrl(ctaUrl)
    const hasButton = Boolean(ctaLabel && absoluteCtaUrl)
    const safeLogoUrl = escapeHtml(logoUrl)
    const paragraphs = bodyToParagraphs(cleanBody)

    const text = [
        greeting,
        '',
        cleanBody,
        ...(hasButton ? ['', `${ctaLabel}: ${absoluteCtaUrl}`] : []),
        '',
        `— ${PRODUCT_NAME}, ${PRODUCT_URL}`,
        ...(recipientEmail ? ['', `Письмо отправлено на ${recipientEmail}.`] : [])
    ].join('\n')

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(cleanSubject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#1f2a24;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:18px;padding:32px;">
<tr><td align="center" style="padding-bottom:14px;">
<img src="${safeLogoUrl}" width="68" height="68" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;width:68px;height:68px;border:0;border-radius:50%;">
</td></tr>
<tr><td style="font-size:16px;line-height:24px;color:#33413a;padding-bottom:14px;">${escapeHtml(greeting)}</td></tr>
<tr><td>${paragraphs}</td></tr>
${hasButton ? `<tr><td align="center" style="padding:6px 0 18px;">
<a href="${escapeHtml(absoluteCtaUrl)}" style="display:inline-block;background-color:#2f8f4e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:15px 30px;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
</td></tr>` : ''}
<tr><td style="font-size:15px;line-height:23px;color:#33413a;padding-top:14px;">
— ${escapeHtml(PRODUCT_NAME)}, <a href="${PRODUCT_URL}" style="color:#2f8f4e;text-decoration:none;">checktheplants.ru</a>
</td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#8a988f;border-top:1px solid #e6ece7;padding-top:16px;">
Отвечать на это письмо можно как обычно — ответ придёт разработчику.${recipientEmail
        ? `<br>Письмо отправлено на ${escapeHtml(recipientEmail)}.`
        : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

    return { subject: cleanSubject, text, html }
}

export async function sendBroadcastEmail({
    to,
    subject,
    body,
    userName = '',
    ctaLabel = '',
    ctaUrl = '',
    env = process.env
}) {
    const message = renderBroadcastEmail({
        subject,
        body,
        userName,
        ctaLabel,
        ctaUrl,
        recipientEmail: to
    })
    return sendMail({ to, ...message }, env)
}

