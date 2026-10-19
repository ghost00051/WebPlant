import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CHAT_EMPTY_TITLE,
    CHAT_PHOTO_TITLE,
    CHAT_TITLE_MAX_LENGTH,
    buildChatTitle,
    truncateChatTitle
} from './chatSession.js'

test('buildChatTitle: заголовок — первое сообщение пользователя', () => {
    assert.equal(buildChatTitle({ text: '  Почему желтеют листья у монстеры?  ' }), 'Почему желтеют листья у монстеры?')
    assert.equal(buildChatTitle({ text: 'первая строка\nвторая строка' }), 'первая строка вторая строка')
})

test('buildChatTitle: фото-чат без подписи получает человекочитаемое имя', () => {
    assert.equal(buildChatTitle({ text: '', hasPhoto: true }), CHAT_PHOTO_TITLE)
    assert.equal(buildChatTitle({ text: 'Фото растения для диагностики', hasPhoto: true }), CHAT_PHOTO_TITLE)
    assert.equal(buildChatTitle({ text: 'Пятна на листьях', hasPhoto: true }), 'Пятна на листьях')
})

test('buildChatTitle: пустой чат и длинный текст', () => {
    assert.equal(buildChatTitle({ text: '' }), CHAT_EMPTY_TITLE)
    assert.equal(buildChatTitle({}), CHAT_EMPTY_TITLE)

    const long = buildChatTitle({ text: 'я'.repeat(120) })
    assert.equal(long.length, CHAT_TITLE_MAX_LENGTH)
    assert.ok(long.endsWith('…'))
    assert.equal(truncateChatTitle('коротко'), 'коротко')
    assert.equal(truncateChatTitle(null), '')
})
