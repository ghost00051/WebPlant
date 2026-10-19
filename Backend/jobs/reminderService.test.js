import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildAutoSkipNotification,
    buildMorningSummaryBody,
    buildOnDayNotification,
    buildRemindersPausedNotification,
    formatSlotLabel,
    isSlotNotified,
    truncateText,
    withSlotNotification
} from './reminderService.js'
import {
    clampNotificationText,
    NOTIFICATION_BODY_MAX_LENGTH,
    NOTIFICATION_TITLE_MAX_LENGTH
} from '../services/notificationService.js'

const MSK = 'Europe/Moscow'
const iso = value => new Date(value).toISOString()

test('truncateText: обрезает длинный текст и сохраняет короткий', () => {
    assert.equal(truncateText('коротко', 20), 'коротко')
    const long = truncateText('я'.repeat(50), 10)
    assert.equal(long.length, 10)
    assert.ok(long.endsWith('…'))
    assert.equal(truncateText(null, 5), '')
    assert.equal(truncateText(undefined, 5), '')
    assert.equal(truncateText(12345, 3).length <= 3, true)
})

test('buildMorningSummaryBody: пусто и список растений', () => {
    assert.equal(
        buildMorningSummaryBody([]),
        'На сегодня полив не запланирован 🌱'
    )
    assert.equal(
        buildMorningSummaryBody([{ name: 'Фикус', location: 'Кухня' }]),
        'Сегодня полить: Фикус (Кухня)'
    )
    assert.equal(
        buildMorningSummaryBody([{ name: 'Кактус', location: null }]),
        'Сегодня полить: Кактус'
    )
})

test('buildMorningSummaryBody: максимум 5 растений, «и ещё N»', () => {
    const plants = Array.from({ length: 7 }, (_, i) => ({ name: `Растение ${i + 1}` }))
    const body = buildMorningSummaryBody(plants)
    assert.match(body, /Растение 1/)
    assert.match(body, /Растение 5/)
    assert.doesNotMatch(body, /Растение 6/)
    assert.match(body, /и ещё 2/)
})

test('buildMorningSummaryBody: длинные имена/локации обрезаны, body <= 1000 (L-01)', () => {
    const plants = Array.from({ length: 5 }, () => ({
        name: 'Очень длинное название растения'.repeat(10),
        location: 'Очень длинное местоположение'.repeat(10)
    }))
    const body = buildMorningSummaryBody(plants)
    assert.ok(body.length <= NOTIFICATION_BODY_MAX_LENGTH)
    assert.ok(!body.includes('Очень длинное название растения'.repeat(10)))
})

test('buildOnDayNotification: обычное и просроченное напоминание', () => {
    const now = new Date('2026-10-19T06:00:00Z')
    const onTime = buildOnDayNotification(
        { name: 'Фикус', location: 'Кухня' },
        { slot: now, timeZone: MSK, now }
    )
    assert.equal(onTime.title, '💧 Пора полить!')
    assert.match(onTime.body, /Фикус \(Кухня\) ждёт воды/)
    assert.doesNotMatch(onTime.body, /запланирован/)

    const late = buildOnDayNotification(
        { name: 'Фикус', location: null },
        { slot: new Date('2026-10-19T04:00:00Z'), timeZone: MSK, now }
    )
    assert.match(late.body, /Полив был запланирован на/)
    assert.ok(late.body.length <= NOTIFICATION_BODY_MAX_LENGTH)
})

test('formatSlotLabel: локальное время слота', () => {
    const label = formatSlotLabel(new Date('2026-10-19T06:00:00Z'), MSK)
    assert.match(label, /19\.10/)
    assert.match(label, /09:00/)
})

test('buildAutoSkipNotification: 1 и N пропусков', () => {
    const one = buildAutoSkipNotification({ name: 'Фикус' }, 1)
    assert.match(one.body, /полив пропущен/)
    const many = buildAutoSkipNotification({ name: 'Фикус' }, 5)
    assert.match(many.body, /пропущено 5 поливов/)
    assert.ok(many.body.length <= NOTIFICATION_BODY_MAX_LENGTH)
})

test('buildRemindersPausedNotification: объясняет паузу и путь возобновления', () => {
    const { title, body } = buildRemindersPausedNotification(
        { name: 'Фикус' },
        { consecutiveSkips: 3 }
    )
    assert.match(title, /приостановлены/)
    assert.match(body, /возобнов/i)
    assert.match(body, /Фикус/)
    assert.ok(body.length <= NOTIFICATION_BODY_MAX_LENGTH)
})

test('isSlotNotified / withSlotNotification: флаг привязан к конкретному слоту', () => {
    const slotA = new Date('2026-10-19T06:00:00Z')
    const slotB = new Date('2026-10-20T06:00:00Z')
    const metadata = withSlotNotification({ custom: 1 }, 'on_day', slotA)

    assert.equal(isSlotNotified(metadata, 'on_day', slotA), true)
    assert.equal(isSlotNotified(metadata, 'on_day', slotB), false)
    assert.equal(isSlotNotified({}, 'on_day', slotA), false)

    assert.equal(
        isSlotNotified({ notifications: { on_day: '2026-10-19T06:05:00.000Z' } }, 'on_day', slotA),
        false
    )

    assert.equal(metadata.custom, 1)
    assert.deepEqual(metadata.notifications, { on_day: iso(slotA) })
})

test('withSlotNotification: merge поверх существующих флагов', () => {
    const merged = withSlotNotification(
        { notifications: { day_before: '2026-10-18T06:00:00.000Z' }, a: 2 },
        'on_day',
        new Date('2026-10-19T06:00:00Z')
    )
    assert.equal(merged.notifications.day_before, '2026-10-18T06:00:00.000Z')
    assert.equal(merged.notifications.on_day, '2026-10-19T06:00:00.000Z')
    assert.equal(merged.a, 2)
})

test('clampNotificationText: страховка от VARCHAR(120)/(1000)', () => {
    const long = clampNotificationText({
        title: 'т'.repeat(200),
        body: 'б'.repeat(1500)
    })
    assert.ok(long.title.length <= NOTIFICATION_TITLE_MAX_LENGTH)
    assert.ok(long.body.length <= NOTIFICATION_BODY_MAX_LENGTH)

    const short = clampNotificationText({ title: 'Заголовок', body: 'Текст' })
    assert.deepEqual(short, { title: 'Заголовок', body: 'Текст' })
})
