import assert from 'node:assert/strict'
import test from 'node:test'
import {
    describeMailConfigProblems,
    describeMailStatus,
    isMailConfigured,
    readMailConfig,
    renderBroadcastEmail,
    renderPasswordResetEmail,
    renderWelcomeEmail,
    resolveAbsoluteUrl
} from './mailService.js'

const baseEnv = {
    SMTP_USER: 'checktheplants@mail.ru',
    SMTP_PASSWORD: 'app-password'
}

test('readMailConfig: по умолчанию smtp.mail.ru:465 с SSL', () => {
    const config = readMailConfig(baseEnv)

    assert.equal(config.host, 'smtp.mail.ru')
    assert.equal(config.port, 465)
    assert.equal(config.secure, true)
    assert.equal(config.fromAddress, 'checktheplants@mail.ru')
    assert.equal(config.fromName, 'Лейка')
})

test('readMailConfig: SMTP_SECURE следует за портом, если не задан явно', () => {
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '587' }).secure, false)
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '465' }).secure, true)
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '587', SMTP_SECURE: 'true' }).secure, true)
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '465', SMTP_SECURE: 'false' }).secure, false)
})

test('readMailConfig: некорректный порт откатывается к 465', () => {
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: 'abc' }).port, 465)
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '0' }).port, 465)
    assert.equal(readMailConfig({ ...baseEnv, SMTP_PORT: '70000' }).port, 465)
})

test('isMailConfigured: нужны и логин, и пароль', () => {
    assert.equal(isMailConfigured(baseEnv), true)
    assert.equal(isMailConfigured({ SMTP_USER: 'checktheplants@mail.ru' }), false)
    assert.equal(isMailConfigured({ SMTP_PASSWORD: 'app-password' }), false)
    assert.equal(isMailConfigured({ ...baseEnv, MAIL_ENABLED: 'false' }), false)
})

test('describeMailStatus различает выключенную и ненастроенную почту', () => {
    assert.equal(describeMailStatus(baseEnv), 'configured')
    assert.equal(describeMailStatus({ SMTP_USER: 'a@mail.ru' }), 'not-configured')
    assert.equal(describeMailStatus({ ...baseEnv, MAIL_ENABLED: 'false' }), 'disabled')
})

test('describeMailConfigProblems подсказывает про пароль приложения mail.ru', () => {
    const problems = describeMailConfigProblems({ SMTP_USER: 'checktheplants@mail.ru' })

    assert.equal(problems.length, 1)
    assert.match(problems[0], /пароль для внешних приложений/)
})

test('describeMailConfigProblems ловит чужой домен в MAIL_FROM', () => {
    const problems = describeMailConfigProblems({
        ...baseEnv,
        MAIL_FROM: 'noreply@checktheplants.ru'
    })

    assert.equal(problems.length, 1)
    assert.match(problems[0], /MAIL_FROM/)
})

test('describeMailConfigProblems принимает псевдоним того же домена', () => {
    assert.deepEqual(describeMailConfigProblems({
        ...baseEnv,
        MAIL_FROM: 'lejka@mail.ru'
    }), [])
})

test('describeMailConfigProblems ловит рассинхрон порта и SMTP_SECURE', () => {
    assert.match(
        describeMailConfigProblems({ ...baseEnv, SMTP_PORT: '465', SMTP_SECURE: 'false' })[0],
        /465/
    )
    assert.match(
        describeMailConfigProblems({ ...baseEnv, SMTP_PORT: '587', SMTP_SECURE: 'true' })[0],
        /587/
    )
})

test('настроенная почта не даёт замечаний', () => {
    assert.deepEqual(describeMailConfigProblems(baseEnv), [])
})

test('renderPasswordResetEmail кладёт ссылку, срок и подпись', () => {
    const resetUrl = 'https://checktheplants.ru/reset-password?token=abc123'
    const { subject, text, html } = renderPasswordResetEmail({
        resetUrl,
        recipientEmail: 'anna@mail.ru',
        userName: 'Анна'
    })

    assert.match(subject, /Сброс пароля/)
    assert.match(subject, /Лейке/)
    assert.match(text, /Анна/)
    assert.ok(text.includes(resetUrl))
    assert.match(text, /30 мин/)
    assert.ok(html.includes(resetUrl))
    assert.match(html, /Создать новый пароль/)
    assert.match(html, /anna@mail\.ru/)
})

test('renderPasswordResetEmail экранирует вёрстку и требует ссылку', () => {
    const { html, text } = renderPasswordResetEmail({
        resetUrl: 'https://checktheplants.ru/reset-password?token=abc',
        userName: '<script>alert(1)</script>'
    })

    assert.ok(!html.includes('<script>'))
    assert.match(html, /&lt;script&gt;/)
    assert.ok(text.includes('<script>'))
    assert.throws(() => renderPasswordResetEmail({}), /resetUrl/)
})

test('renderWelcomeEmail: тема, приветствие по имени, подпись разработчика', () => {
    const { subject, text, html } = renderWelcomeEmail({ userName: 'Иван' })

    assert.match(subject, /Добро пожаловать в «Лейку»/)
    assert.match(text, /Привет, Иван!/)
    assert.match(text, /разработчик «Лейки»/)
    assert.match(text, /Иван Никитин/)
    assert.ok(text.includes('https://checktheplants.ru/home'))
    assert.match(text, /С чего начать/)
    assert.match(text, /Приложение я делаю один/)
    assert.match(html, /Привет, Иван!/)
    assert.match(html, /Открыть свой сад/)
    assert.match(html, /<img[^>]+src="https:\/\/checktheplants\.ru\/icons\/icon-192\.png"/)
    assert.match(html, /alt="Лейка"/)
})

test('renderWelcomeEmail: без имени — нейтральное приветствие, логотип переопределяется', () => {
    const { text, html } = renderWelcomeEmail({
        logoUrl: 'https://cdn.example.com/logo.png?a=1&b=2'
    })

    assert.match(text, /^Привет!/)
    assert.ok(!text.includes('Привет, !'))
    assert.match(html, /https:\/\/cdn\.example\.com\/logo\.png\?a=1&amp;b=2/)
})

test('renderWelcomeEmail экранирует имя получателя в вёрстке', () => {
    const { html } = renderWelcomeEmail({ userName: '<script>alert(1)</script>' })

    assert.ok(!html.includes('<script>'))
    assert.match(html, /&lt;script&gt;/)
})

test('resolveAbsoluteUrl достраивает внутренние пути и не трогает внешние', () => {
    assert.equal(resolveAbsoluteUrl('/home'), 'https://checktheplants.ru/home')
    assert.equal(resolveAbsoluteUrl('home'), 'https://checktheplants.ru/home')
    assert.equal(resolveAbsoluteUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
    assert.equal(resolveAbsoluteUrl('http://example.com'), 'http://example.com')
    assert.equal(resolveAbsoluteUrl('  /my-plants  '), 'https://checktheplants.ru/my-plants')
    assert.equal(resolveAbsoluteUrl(''), '')
    assert.equal(resolveAbsoluteUrl(null), '')
})

test('renderBroadcastEmail: тема, обращение по имени, абзацы и подпись', () => {
    const { subject, text, html } = renderBroadcastEmail({
        subject: 'Полив в отпуске',
        body: 'Первое сообщение.\n\nВторое сообщение.',
        userName: 'Анна',
        recipientEmail: 'anna@mail.ru'
    })

    assert.equal(subject, 'Полив в отпуске')
    assert.match(text, /^Здравствуйте, Анна!/)
    assert.match(text, /Первое сообщение\./)
    assert.match(text, /Второе сообщение\./)
    assert.match(text, /— Лейка, https:\/\/checktheplants\.ru/)
    assert.match(text, /Письмо отправлено на anna@mail\.ru\./)

    assert.match(html, /Здравствуйте, Анна!/)
    assert.equal((html.match(/<p style=/g) || []).length, 2)
    assert.match(html, /<title>Полив в отпуске<\/title>/)
    assert.match(html, /<img[^>]+src="https:\/\/checktheplants\.ru\/icons\/icon-192\.png"/)
})

test('renderBroadcastEmail: кнопка появляется только с подписью и ссылкой', () => {
    const withoutButton = renderBroadcastEmail({
        subject: 'Тема',
        body: 'Текст',
        ctaLabel: '',
        ctaUrl: '/home'
    })

    assert.ok(!withoutButton.html.includes('<a href="https://checktheplants.ru/home"'))
    assert.ok(!withoutButton.text.includes('/home'))

    const withButton = renderBroadcastEmail({
        subject: 'Тема',
        body: 'Текст',
        ctaLabel: 'Открыть свой сад',
        ctaUrl: '/home'
    })

    assert.match(withButton.text, /Открыть свой сад: https:\/\/checktheplants\.ru\/home/)
    assert.match(withButton.html, /<a href="https:\/\/checktheplants\.ru\/home"/)
    assert.match(withButton.html, />Открыть свой сад<\/a>/)
})

test('renderBroadcastEmail: без имени нейтральное обращение, переводы строк сохраняются', () => {
    const { text, html } = renderBroadcastEmail({
        subject: 'Тема',
        body: 'Строка один\nстрока два'
    })

    assert.match(text, /^Здравствуйте!/)
    assert.ok(!text.includes('Здравствуйте, !'))
    assert.match(html, /Строка один<br>строка два/)
})

test('renderBroadcastEmail экранирует вёрстку и требует тему с текстом', () => {
    const { html, text } = renderBroadcastEmail({
        subject: 'Тема',
        body: '<script>alert(1)</script>',
        userName: '<b>Анна</b>'
    })

    assert.ok(!html.includes('<script>'))
    assert.match(html, /&lt;script&gt;/)
    assert.match(html, /&lt;b&gt;Анна&lt;\/b&gt;/)
    assert.ok(text.includes('<script>alert(1)</script>'))

    assert.throws(() => renderBroadcastEmail({ body: 'Текст' }), /subject is required/)
    assert.throws(() => renderBroadcastEmail({ subject: 'Тема' }), /body is required/)
    assert.throws(
        () => renderBroadcastEmail({ subject: '   ', body: 'Текст' }),
        /subject is required/
    )
})
