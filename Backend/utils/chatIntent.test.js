import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildPlantsOverview,
    describePlantDay,
    detectChatIntent,
    resolveLocalChatAnswer
} from './chatIntent.js'

const TZ = 'Europe/Moscow'
const NOW = new Date('2026-10-16T09:00:00Z')

const plant = (name, nextWatering, extra = {}) => ({ name, nextWatering, ...extra })

test('detectChatIntent: узнаёт типовые вопросы', () => {
    assert.equal(detectChatIntent('Что полить?'), 'what_to_water')
    assert.equal(detectChatIntent('когда поливать монстеру'), 'schedule')
    assert.equal(detectChatIntent('Сколько у меня растений?'), 'plants_count')
    assert.equal(detectChatIntent('что ты умеешь'), 'help')
    assert.equal(detectChatIntent('расскажи про фикус'), null)
    assert.equal(detectChatIntent('   '), null)
    assert.equal(detectChatIntent(null), null)
})

test('describePlantDay: сегодня, завтра, просрочка и дальняя дата', () => {
    assert.equal(describePlantDay('2026-10-16T06:00:00Z', { now: NOW, timeZone: TZ }), 'сегодня')
    assert.equal(describePlantDay('2026-10-17T06:00:00Z', { now: NOW, timeZone: TZ }), 'завтра')
    assert.equal(describePlantDay('2026-10-15T06:00:00Z', { now: NOW, timeZone: TZ }), 'вчера')
    assert.equal(describePlantDay('2026-10-01T06:00:00Z', { now: NOW, timeZone: TZ }), 'просрочен на 15 дн.')
    assert.equal(describePlantDay('2026-11-20T06:00:00Z', { now: NOW, timeZone: TZ }), '20 ноября')
    assert.equal(describePlantDay('не дата', { now: NOW, timeZone: TZ }), null)
})

test('resolveLocalChatAnswer: гостю объясняем про вход', () => {
    const answer = resolveLocalChatAnswer({ message: 'Что полить?', isAuthorized: false, now: NOW })
    assert.equal(answer.intent, 'what_to_water')
    assert.match(answer.text, /войд|войти|аккаунт/i)
})

test('resolveLocalChatAnswer: без растений предлагаем добавить', () => {
    const answer = resolveLocalChatAnswer({
        message: 'Сколько у меня растений?',
        plants: [],
        isAuthorized: true,
        now: NOW
    })
    assert.match(answer.text, /пока нет растений/i)
})

test('resolveLocalChatAnswer: что полить — просроченные и сегодняшние', () => {
    const answer = resolveLocalChatAnswer({
        message: 'Что полить?',
        plants: [
            plant('Монстера', '2026-10-14T06:00:00Z'),
            plant('Фикус', '2026-10-16T15:00:00Z'),
            plant('Кактус', '2026-10-30T06:00:00Z')
        ],
        isAuthorized: true,
        now: NOW
    })

    assert.match(answer.text, /Пора полить \(1\)/)
    assert.match(answer.text, /Монстера/)
    assert.match(answer.text, /просрочен на 2 дн\./)
    assert.match(answer.text, /Сегодня по графику \(1\)/)
    assert.match(answer.text, /Фикус/)
    assert.doesNotMatch(answer.text, /Кактус/)
})

test('resolveLocalChatAnswer: нечего поливать — говорим спокойно', () => {
    const answer = resolveLocalChatAnswer({
        message: 'что полить',
        plants: [plant('Кактус', '2026-10-30T06:00:00Z')],
        isAuthorized: true,
        now: NOW
    })
    assert.match(answer.text, /Сейчас поливать ничего не нужно/)
    assert.match(answer.text, /Кактус/)
})

test('resolveLocalChatAnswer: график сортируется по дате', () => {
    const answer = resolveLocalChatAnswer({
        message: 'покажи график',
        plants: [
            plant('Кактус', '2026-10-30T06:00:00Z'),
            plant('Монстера', '2026-10-17T06:00:00Z')
        ],
        isAuthorized: true,
        now: NOW
    })
    const lines = answer.text.split('\n')
    assert.match(lines[0], /Ближайшие поливы/)
    assert.match(lines[1], /Монстера/)
    assert.match(lines[2], /Кактус/)
})

test('resolveLocalChatAnswer: список растений и справка', () => {
    const counted = resolveLocalChatAnswer({
        message: 'сколько у меня растений',
        plants: [plant('Монстера', null), plant('Фикус', null)],
        isAuthorized: true,
        now: NOW
    })
    assert.match(counted.text, /У вас 2 растения/)
    assert.match(counted.text, /Монстера/)

    const help = resolveLocalChatAnswer({ message: 'что ты умеешь', isAuthorized: false, now: NOW })
    assert.match(help.text, /Я умею/)
})

test('resolveLocalChatAnswer: незнакомый вопрос уходит к модели', () => {
    assert.equal(resolveLocalChatAnswer({ message: 'почему желтеют листья', now: NOW }), null)
})

test('buildPlantsOverview: сводка для деградации без модели', () => {
    const guest = buildPlantsOverview({ plants: [], isAuthorized: false, now: NOW })
    assert.match(guest, /войти в аккаунт/)

    const empty = buildPlantsOverview({ plants: [], isAuthorized: true, now: NOW })
    assert.match(empty, /пока нет растений/)

    const withDue = buildPlantsOverview({
        plants: [plant('Монстера', '2026-10-14T06:00:00Z'), plant('Фикус', '2026-10-20T06:00:00Z')],
        isAuthorized: true,
        now: NOW
    })
    assert.match(withDue, /У вас 2 растения/)
    assert.match(withDue, /Пора полить \(1\)/)
    assert.match(withDue, /Дальше по графику/)
})
