import test from 'node:test'
import assert from 'node:assert/strict'

import {
    renderBroadcastEmail,
    renderPasswordResetEmail,
    renderWelcomeEmail
} from './mailService.js'

const UNSUBSCRIBE_URL = 'https://checktheplants.ru/unsubscribe?uid=42&token=abcdefghijklmnopqrstuvwxyz012345'
const UNSUBSCRIBE_HREF = UNSUBSCRIBE_URL.replace('&', '&amp;')

test('renderBroadcastEmail: футер содержит рабочую ссылку отписки (L2.2)', () => {
    const message = renderBroadcastEmail({
        subject: 'Новости «Лейки»',
        body: 'Текст письма',
        userName: 'Анна',
        unsubscribeUrl: UNSUBSCRIBE_URL
    })

    assert.match(message.html, /Отписаться от рассылки/)
    assert.ok(message.html.includes(UNSUBSCRIBE_HREF))
    assert.match(message.text, /Отписаться в один клик:/)
    assert.ok(message.text.includes(UNSUBSCRIBE_URL))
})

test('renderBroadcastEmail: без unsubscribeUrl (предпросмотр) остаётся ссылка-заглушка', () => {
    const message = renderBroadcastEmail({ subject: 'Тема', body: 'Текст' })

    assert.ok(message.html.includes('https://checktheplants.ru/unsubscribe'))
    assert.match(message.text, /Отписаться/)
})

test('renderBroadcastEmail: ссылка экранируется, вёрстка не ломается', () => {
    const message = renderBroadcastEmail({
        subject: 'Тема',
        body: 'Текст',
        unsubscribeUrl: 'https://checktheplants.ru/unsubscribe?uid=1&token=abc"><script>'
    })

    assert.equal(message.html.includes('<script>'), false)
    assert.ok(message.html.includes('&quot;&gt;&lt;script&gt;'))
})

test('renderWelcomeEmail: приветственное письмо тоже с отпиской', () => {
    const message = renderWelcomeEmail({ userName: 'Анна', unsubscribeUrl: UNSUBSCRIBE_URL })

    assert.ok(message.html.includes(UNSUBSCRIBE_HREF))
    assert.match(message.html, /отпишитесь в один клик/i)
    assert.ok(message.text.includes(UNSUBSCRIBE_URL))
})

test('renderPasswordResetEmail: транзакционное письмо без отписки', () => {
    const message = renderPasswordResetEmail({
        resetUrl: 'https://checktheplants.ru/reset-password#token=abc'
    })

    assert.equal(/unsubscribe/i.test(message.html), false)
    assert.equal(/отпис/i.test(message.html), false)
    assert.equal(/отпис/i.test(message.text), false)
})
