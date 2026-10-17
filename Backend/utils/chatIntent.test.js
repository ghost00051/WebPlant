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

test('detectChatIntent: вежливые префиксы и регистр не мешают команде', () => {
    assert.equal(detectChatIntent('Алиса, что полить?'), 'what_to_water')
    assert.equal(detectChatIntent('  Покажи, пожалуйста, график  '), 'schedule')
    assert.equal(detectChatIntent('Лейка, сколько у меня растений'), 'plants_count')
    assert.equal(detectChatIntent('ПОМОЩЬ'), 'help')
})

test('detectChatIntent: вопросы ухода не перехватываются командами (регресс)', () => {
    assert.equal(detectChatIntent('Почему желтеют мои растения?'), null)
    assert.equal(detectChatIntent('Нужна помощь с фикусом, он сбросил листья'), null)
    assert.equal(detectChatIntent('Полив сегодня был?'), null)
    assert.equal(detectChatIntent('Когда полить фикус, если он сохнет?'), null)
    assert.equal(detectChatIntent('Что делать с пятнами на листьях?'), null)
    assert.equal(detectChatIntent('Помогите, растение вянет'), null)
})

test('detectChatIntent: длинные сообщения всегда уходят к модели', () => {
    const long = `Что полить ${'и чем ещё помочь '.repeat(10)}`
    assert.ok(long.length > 120)
    assert.equal(detectChatIntent(long), null)
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

test('resolveLocalChatAnswer: живые вопросы не подменяются шаблоном (регресс)', () => {
    const plants = [plant('Монстера', '2026-10-20T06:00:00Z')]
    const common = { plants, isAuthorized: true, now: NOW, timeZone: TZ }

    assert.equal(resolveLocalChatAnswer({ message: 'Почему желтеют мои растения?', ...common }), null)
    assert.equal(resolveLocalChatAnswer({ message: 'Нужна помощь с фикусом, он сбросил листья', ...common }), null)
    assert.equal(resolveLocalChatAnswer({ message: 'Полив сегодня был?', ...common }), null)
})

test('resolveLocalChatAnswer: часовой пояс пользователя меняет ответ', () => {
    const now = new Date('2026-10-17T20:00:00Z')
    const plants = [plant('Монстера', '2026-10-18T05:00:00Z')]

    const moscow = resolveLocalChatAnswer({ message: 'Что полить?', plants, isAuthorized: true, now, timeZone: 'Europe/Moscow' })
    const vladivostok = resolveLocalChatAnswer({ message: 'Что полить?', plants, isAuthorized: true, now, timeZone: 'Asia/Vladivostok' })

    assert.match(moscow.text, /Ближайший полив/)
    assert.match(vladivostok.text, /Сегодня по графику/)
})

test('buildPlantsOverview: растение без даты не считается просроченным', () => {
    const overview = buildPlantsOverview({
        plants: [plant('Монстера', null)],
        isAuthorized: true,
        now: NOW,
        timeZone: TZ
    })

    assert.match(overview, /Монстера/)
    assert.doesNotMatch(overview, /1970|2074\d/)
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
