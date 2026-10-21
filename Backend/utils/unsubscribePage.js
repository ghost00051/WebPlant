import { maskEmail } from './passwordReset.js'


const PRODUCT_NAME = 'Лейка'
const PRODUCT_URL = 'https://checktheplants.ru'
const SUPPORT_EMAIL = 'in419264@gmail.com'

const COLORS = {
    page: '#f4f7f4',
    card: '#ffffff',
    text: '#1f2a24',
    muted: '#5a6a61',
    mutedLight: '#8a988f',
    accent: '#2f8f4e',
    border: '#e6ece7',
    danger: '#9b2638'
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function layout({ title, heading, intro, body, accentColor = COLORS.accent }) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${COLORS.text};">
<main style="max-width:520px;margin:0 auto;padding:40px 16px;">
<div style="background-color:${COLORS.card};border-radius:18px;padding:32px 28px;box-shadow:0 6px 24px rgba(31,42,36,0.06);">
<div style="font-size:14px;line-height:20px;font-weight:600;color:${COLORS.accent};letter-spacing:0.4px;text-transform:uppercase;padding-bottom:10px;">${escapeHtml(PRODUCT_NAME)}</div>
<h1 style="margin:0 0 14px;font-size:22px;line-height:30px;font-weight:700;color:${accentColor};">${escapeHtml(heading)}</h1>
${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:23px;color:${COLORS.muted};">${intro}</p>` : ''}
${body}
</div>
<p style="margin:18px 0 0;text-align:center;font-size:12px;line-height:18px;color:${COLORS.mutedLight};">
<a href="${PRODUCT_URL}" style="color:${COLORS.mutedLight};text-decoration:none;">checktheplants.ru</a>
</p>
</main>
</body>
</html>`
}

function emailNotice(email) {
    const masked = maskEmail(email)
    if (!masked) return ''
    return `<p style="margin:0 0 18px;font-size:14px;line-height:21px;color:${COLORS.muted};">
Письма приходили на <strong style="font-weight:600;color:${COLORS.text};">${escapeHtml(masked)}</strong>.
</p>`
}

const BUTTON_STYLE = `display:inline-block;width:100%;box-sizing:border-box;border:0;background-color:${COLORS.accent};color:#ffffff;font-family:inherit;font-size:16px;font-weight:600;padding:15px 24px;border-radius:12px;cursor:pointer;`

const SECONDARY_LINK_STYLE = `display:inline-block;margin-top:10px;color:${COLORS.muted};font-size:14px;line-height:21px;text-decoration:underline;text-underline-offset:2px;`

export function renderUnsubscribeConfirmPage({ uid, token, email = '' } = {}) {
    const body = `
${emailNotice(email)}
<form method="post" accept-charset="utf-8" style="margin:0;">
<input type="hidden" name="uid" value="${escapeHtml(uid)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit" style="${BUTTON_STYLE}">Отписаться</button>
</form>
<p style="margin:14px 0 0;font-size:13px;line-height:20px;color:${COLORS.mutedLight};">
Кнопка отписывает от писем о растениях и новостях. Письма о работе аккаунта — например, восстановление пароля — продолжат приходить.
</p>
<p style="margin:12px 0 0;font-size:14px;line-height:21px;color:${COLORS.muted};">
Передумали? Просто закройте страницу — ничего не изменится.
</p>
<p style="margin:6px 0 0;">
<a href="${PRODUCT_URL}" style="${SECONDARY_LINK_STYLE}">Вернуться на checktheplants.ru</a>
</p>`

    return layout({
        title: `Отписка от писем «${PRODUCT_NAME}»`,
        heading: 'Отписаться от писем?',
        intro: 'Подтвердите отписку — одно нажатие, и мы больше не будем присылать письма о растениях и новостях.',
        body
    })
}

export function renderUnsubscribedPage({ email = '' } = {}) {
    const body = `
${emailNotice(email)}
<div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background-color:#f2f8f3;font-size:15px;line-height:23px;color:${COLORS.text};">
Вы отписаны от писем о растениях и новостях «${escapeHtml(PRODUCT_NAME)}».
</div>
<p style="margin:0 0 8px;font-size:14px;line-height:21px;color:${COLORS.muted};">
Это не влияет на работу аккаунта: напоминания о поливе в приложении и письма о восстановлении пароля продолжат приходить.
</p>
<p style="margin:0;font-size:14px;line-height:21px;color:${COLORS.muted};">
Если захотите вернуться — напишите на <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.accent};">${SUPPORT_EMAIL}</a>.
</p>
<p style="margin:16px 0 0;">
<a href="${PRODUCT_URL}" style="${SECONDARY_LINK_STYLE}">На главную</a>
</p>`

    return layout({
        title: `Вы отписаны — «${PRODUCT_NAME}»`,
        heading: 'Вы отписаны',
        body
    })
}

export function renderUnsubscribeErrorPage({ title, message, status = 400 } = {}) {
    const body = `
<p style="margin:0 0 16px;font-size:14px;line-height:21px;color:${COLORS.muted};">
Если письмо пришло вам, попробуйте открыть ссылку отписки из него ещё раз или ответьте на письмо — отпишу вручную.
</p>
<p style="margin:0;font-size:13px;line-height:20px;color:${COLORS.mutedLight};">
Код ответа: ${escapeHtml(status)}
</p>
<p style="margin:16px 0 0;">
<a href="${PRODUCT_URL}" style="${SECONDARY_LINK_STYLE}">Вернуться на checktheplants.ru</a>
</p>`

    return layout({
        title: title ? `${title} — «${PRODUCT_NAME}»` : `Ошибка — «${PRODUCT_NAME}»`,
        heading: title || 'Ссылка не подходит',
        intro: message || 'Ссылка отписки недействительна — возможно, она была изменена при пересылке письма.',
        body,
        accentColor: COLORS.danger
    })
}
