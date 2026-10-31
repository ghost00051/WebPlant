import test from 'node:test'
import assert from 'node:assert/strict'

import reminderService, {
    buildAutoSkipNotification,
    buildDeferredPushPayload,
    buildMorningSummaryBody,
    buildOnDayNotification,
    buildRemindersPausedNotification,
    collectMorningSummaryPlants,
    formatSlotLabel,
    isDeferredPushPayload,
    isSlotNotified,
    markPushDeliveredPayload,
    readDeferredPushTag,
    shouldSendMorningSummary,
    truncateText,
    withSlotNotification
} from './reminderService.js'
import {
    clampNotificationText,
    NOTIFICATION_BODY_MAX_LENGTH,
    NOTIFICATION_TITLE_MAX_LENGTH
} from '../services/notificationService.js'
import { getReminderTickMetrics, resetReminderTickMetrics } from '../utils/reminderTickMetrics.js'
import { MISSED_POLICY } from '../utils/missedWatering.js'
import { resolveQuietHours } from '../utils/quietHours.js'
import NotificationPreference from '../models/NotificationPreference.js'
import Plant from '../models/Plant.js'
import User from '../models/userModels.js'

const MSK = 'Europe/Moscow'
const iso = value => new Date(value).toISOString()
const NOW_0900_MSK = new Date('2026-11-01T06:00:00Z')
const END_OF_TODAY_MSK = new Date('2026-11-01T21:00:00Z')

async function withStubbedMethods(overrides, run) {
    const originals = new Map()
    for (const [key, impl] of Object.entries(overrides)) {
        originals.set(key, reminderService[key])
        reminderService[key] = impl
    }

    try {
        return await run()
    } finally {
        for (const [key, original] of originals) {
            if (original === undefined) delete reminderService[key]
            else reminderService[key] = original
        }
    }
}

async function withStubbedStatic(model, method, impl, run) {
    const original = model[method]
    model[method] = impl
    try {
        return await run()
    } finally {
        model[method] = original
    }
}

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

test('BE-02: buildMorningSummaryBody добавляет блок «Завтра полить»', () => {
    const today = [{ name: 'Фикус' }]
    const tomorrow = [{ name: 'Кактус', location: 'Кухня' }]

    const both = buildMorningSummaryBody(today, { tomorrow })
    assert.match(both, /Сегодня полить: Фикус/)
    assert.match(both, /Завтра полить: Кактус \(Кухня\)/)

    const onlyTomorrow = buildMorningSummaryBody([], { tomorrow })
    assert.equal(onlyTomorrow, 'Завтра полить: Кактус (Кухня)')

    const tomorrowMany = buildMorningSummaryBody([], {
        tomorrow: Array.from({ length: 7 }, (_, i) => ({ name: `Завтра ${i + 1}` }))
    })
    assert.match(tomorrowMany, /Завтра 1/)
    assert.match(tomorrowMany, /и ещё 2/)
})

test('BE-01: collectMorningSummaryPlants фильтрует уведомления как per_plant', () => {
    const plants = [
        {
            id: 1,
            name: 'Сегодня',
            next_watering_at: new Date('2026-11-01T06:00:00Z'),
            notify_morning: true,
            watering_interval_days: 1
        },
        {
            id: 2,
            name: 'Завтра',
            next_watering_at: new Date('2026-11-02T06:00:00Z'),
            notify_morning: true,
            notify_day_before: true,
            watering_interval_days: 1
        },
        {
            id: 3,
            name: 'Без утренних',
            next_watering_at: new Date('2026-11-01T06:00:00Z'),
            notify_morning: false,
            watering_interval_days: 1
        },
        {
            id: 4,
            name: 'На паузе',
            next_watering_at: new Date('2026-11-01T06:00:00Z'),
            notify_morning: true,
            watering_interval_days: 1,
            metadata: { reminders_paused: true }
        },
        {
            id: 5,
            name: 'Не тот день недели',
            next_watering_at: new Date('2026-11-01T06:00:00Z'),
            notify_morning: true,
            watering_interval_days: 7,
            reminder_weekdays: [1]
        },
        {
            id: 6,
            name: 'Просрочено',
            next_watering_at: new Date('2026-11-02T06:00:00Z'),
            notify_morning: true,
            notify_day_before: true,
            watering_interval_days: 1,
            metadata: { missed_since: '2026-10-30T06:00:00.000Z' }
        },
        {
            id: 7,
            name: 'Завтра без тумблера',
            next_watering_at: new Date('2026-11-02T06:00:00Z'),
            notify_morning: true,
            notify_day_before: false,
            watering_interval_days: 1
        },
        {
            id: 8,
            name: 'Legacy null',
            next_watering_at: new Date('2026-11-01T06:00:00Z'),
            notify_morning: null,
            watering_interval_days: 1
        }
    ]

    const { today, tomorrow } = collectMorningSummaryPlants(plants, {
        now: NOW_0900_MSK,
        end: END_OF_TODAY_MSK,
        timeZone: MSK
    })

    assert.deepEqual(today.map(plant => plant.id), [1, 6, 8])
    assert.deepEqual(tomorrow.map(plant => plant.id), [2])
    assert.equal(shouldSendMorningSummary({ today, tomorrow }), true)
    assert.equal(shouldSendMorningSummary({ today: [], tomorrow: [] }), false)
})

test('BE-02: «завтра» считается по часовому поясу пользователя', () => {
    const now = new Date('2026-11-01T20:00:00Z')
    const { tomorrow } = collectMorningSummaryPlants([
        {
            id: 1,
            name: 'Владивосток',
            next_watering_at: new Date('2026-11-02T23:00:00Z'),
            notify_morning: true,
            notify_day_before: true,
            watering_interval_days: 1
        }
    ], {
        now,
        end: new Date('2026-11-02T14:00:00Z'),
        timeZone: 'Asia/Vladivostok'
    })

    assert.deepEqual(tomorrow.map(plant => plant.id), [1])
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

test('BE-05: маркер отложенного push в notifications.payload', () => {
    const payload = buildDeferredPushPayload({
        tag: 'on_day',
        deferredAt: new Date('2026-11-01T19:30:00Z')
    })

    assert.equal(isDeferredPushPayload(payload), true)
    assert.equal(readDeferredPushTag(payload), 'on_day')
    assert.equal(payload.push_deferred_at, '2026-11-01T19:30:00.000Z')
    assert.equal(isDeferredPushPayload({}), false)
    assert.equal(isDeferredPushPayload(null), false)
    assert.equal(readDeferredPushTag({}, 'reminder'), 'reminder')

    const delivered = markPushDeliveredPayload(payload, {
        sentAt: new Date('2026-11-01T20:05:00Z')
    })
    assert.equal(isDeferredPushPayload(delivered), false)
    assert.equal(delivered.push_sent_at, '2026-11-01T20:05:00.000Z')
    assert.equal(delivered.push_tag, 'on_day')
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

test('processPlantsConcurrently: ошибка одного растения не валит остальные', async () => {
    const counters = reminderService.createTickCounters()
    const processed = []
    const originalConsoleError = console.error

    try {
        console.error = () => {}
        await reminderService.processPlantsConcurrently(
            [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
            {
                failureLabel: 'test',
                failureText: 'напоминание не отправлено',
                counters,
                worker: async plant => {
                    if (plant.id === 2) throw new Error('boom')
                    processed.push(plant.id)
                    return plant.id === 3
                }
            }
        )
    } finally {
        console.error = originalConsoleError
    }

    assert.deepEqual(processed, [1, 3, 4])
    assert.equal(counters.errors, 1)
    assert.equal(counters.notificationsCreated, 1)
})

test('handleOverduePlant: политика preserve не сдвигает план, auto_skip сохраняет старое поведение', async () => {
    const called = []
    const original = {
        autoSkipPlant: reminderService.autoSkipPlant,
        preserveMissedPlant: reminderService.preserveMissedPlant
    }

    try {
        reminderService.autoSkipPlant = async () => {
            called.push('autoSkipPlant')
            return true
        }
        reminderService.preserveMissedPlant = async () => {
            called.push('preserveMissedPlant')
            return true
        }

        await reminderService.handleOverduePlant({ id: 1 }, {
            now: new Date('2026-10-25T06:00:00Z'),
            cutoff: new Date('2026-10-24T06:00:00Z'),
            zonesByUser: new Map(),
            missedPolicy: MISSED_POLICY.PRESERVE
        })
        await reminderService.handleOverduePlant({ id: 2 }, {
            now: new Date('2026-10-25T06:00:00Z'),
            cutoff: new Date('2026-10-24T06:00:00Z'),
            zonesByUser: new Map(),
            missedPolicy: MISSED_POLICY.AUTO_SKIP
        })
    } finally {
        reminderService.autoSkipPlant = original.autoSkipPlant
        reminderService.preserveMissedPlant = original.preserveMissedPlant
    }

    assert.deepEqual(called, ['preserveMissedPlant', 'autoSkipPlant'])
})

test('F41/F43: настройки доставки по умолчанию и тихие часы', () => {
    const fallback = reminderService.deliverySettingsFor(new Map(), 999)
    assert.equal(fallback.deliveryMode, 'per_plant', 'без строки prefs старое поведение')
    assert.equal(fallback.quietHours.enabled, false)

    const quietSettings = {
        timeZone: 'Europe/Moscow',
        deliveryMode: 'per_plant',
        quietHours: {
            enabled: true,
            start: '22:00',
            end: '08:00',
            startMinutes: 1320,
            endMinutes: 480
        }
    }
    assert.equal(
        reminderService.shouldSkipPush(quietSettings, new Date('2026-11-01T19:30:00Z')),
        true,
        '22:30 МСК — тихие часы'
    )
    assert.equal(
        reminderService.shouldSkipPush(quietSettings, new Date('2026-11-01T06:00:00Z')),
        false,
        '09:00 МСК — можно отправлять'
    )
    assert.equal(
        reminderService.shouldSkipPush({ ...quietSettings, quietHours: { enabled: false } }),
        false
    )
})

test('BE-03: sendMorningSummary берёт только digest и чинит legacy-флаг сводки', async () => {
    const preferences = [
        {
            user_id: 11,
            delivery_mode: 'digest',
            morning_summary_enabled: false,
            quiet_hours_enabled: false,
            quiet_hours_start: '22:00',
            quiet_hours_end: '08:00',
            last_morning_summary_date: null
        },
        {
            user_id: 12,
            delivery_mode: 'per_plant',
            morning_summary_enabled: true,
            quiet_hours_enabled: false,
            quiet_hours_start: '22:00',
            quiet_hours_end: '08:00',
            last_morning_summary_date: null
        },
        {
            user_id: 13,
            delivery_mode: 'digest',
            morning_summary_enabled: true,
            quiet_hours_enabled: false,
            quiet_hours_start: '22:00',
            quiet_hours_end: '08:00',
            last_morning_summary_date: '2026-11-01'
        },
        {
            user_id: 14,
            delivery_mode: 'digest',
            morning_summary_enabled: true,
            quiet_hours_enabled: true,
            quiet_hours_start: '08:00',
            quiet_hours_end: '09:30',
            last_morning_summary_date: null
        },
        {
            user_id: 15,
            delivery_mode: 'digest',
            morning_summary_enabled: true,
            quiet_hours_enabled: false,
            quiet_hours_start: '22:00',
            quiet_hours_end: '08:00',
            last_morning_summary_date: null
        }
    ]
    const captured = {}
    const sent = []
    const healed = []
    const originalConsole = console.log

    try {
        console.log = () => {}
        await withStubbedStatic(NotificationPreference, 'findAll', async options => {
            captured.where = options.where
            return preferences
        }, () => withStubbedStatic(NotificationPreference, 'update', async (values, options) => {
            healed.push({ values, where: options?.where })
            return [1]
        }, () => withStubbedStatic(User, 'findAll', async () => preferences.map(preference => ({
            id: preference.user_id,
            timezone: 'Europe/Moscow'
        })), () => withStubbedMethods({
            sendMorningSummaryTo: async (preference, options) => {
                sent.push({ userId: preference.user_id, options })
            }
        }, () => reminderService.sendMorningSummary(NOW_0900_MSK)))))
    } finally {
        console.log = originalConsole
    }

    assert.equal(captured.where.delivery_mode, 'digest', 'BE-03: выборка только digest-режима')
    assert.deepEqual(healed.map(item => item.where.user_id), [11], 'legacy digest+false чинится')
    assert.deepEqual(sent.map(item => item.userId), [11, 15])
    assert.equal(sent[0].options.timeZone, 'Europe/Moscow')
    assert.equal(sent[0].options.now.toISOString(), NOW_0900_MSK.toISOString())
})

test('BE-03: resolveMorningSummaryEnabled не чинит флаг, если режим уже сменился', async () => {
    const preference = { user_id: 7, delivery_mode: 'digest', morning_summary_enabled: false }

    await withStubbedStatic(NotificationPreference, 'update', async () => [0], async () => {
        const originalConsoleError = console.error
        try {
            console.error = () => {}
            assert.equal(await reminderService.resolveMorningSummaryEnabled(preference), false)
        } finally {
            console.error = originalConsoleError
        }
    })
    assert.equal(preference.morning_summary_enabled, false)
    assert.equal(await reminderService.resolveMorningSummaryEnabled({ user_id: 8, morning_summary_enabled: true }), true)
    assert.equal(await reminderService.resolveMorningSummaryEnabled({ user_id: 9 }), true)
})

test('BE-04: пустая сводка не создаётся, но last_morning_summary_date обновляется', async () => {
    const updates = []
    const preference = {
        user_id: 5,
        async update(values) {
            updates.push(values)
        }
    }
    const captured = {}

    const result = await withStubbedStatic(Plant, 'findAll', async options => {
        captured.options = options
        return []
    }, () => reminderService.sendMorningSummaryTo(preference, {
        date: '2026-11-01',
        end: END_OF_TODAY_MSK,
        now: NOW_0900_MSK,
        timeZone: MSK
    }))

    assert.equal(result.skipped, 'empty')
    assert.deepEqual(updates, [{ last_morning_summary_date: '2026-11-01' }])
    assert.equal(captured.options.where.user_id, 5)
    assert.equal(captured.options.attributes.includes('notify_morning'), true)
    assert.equal(captured.options.attributes.includes('notify_day_before'), true)
    assert.equal(captured.options.attributes.includes('metadata'), true)
})

test('BE-05: flushDeferredPushes досылает отложенный push ровно один раз', async () => {
    const calls = []
    const counters = await withStubbedMethods({
        findDeferredPushes: async () => [{ id: 5, user_id: 7 }],
        loadRecipientSettings: async () => new Map([[
            7,
            { timeZone: MSK, quietHours: resolveQuietHours({ enabled: false }) }
        ]]),
        claimDeferredPush: async notification => {
            calls.push(['claim', notification.id])
            return true
        },
        sendDeferredPush: async notification => {
            calls.push(['send', notification.id])
        },
        completeDeferredPush: async (notification, now) => {
            calls.push(['complete', notification.id, now.toISOString()])
        },
        restoreDeferredPush: async notification => {
            calls.push(['restore', notification.id])
        }
    }, () => reminderService.flushDeferredPushes(new Date('2026-11-01T07:00:00Z')))

    assert.equal(counters.pushesSent, 1)
    assert.equal(counters.errors, 0)
    assert.deepEqual(calls.map(call => call[0]), ['claim', 'send', 'complete'])
})

test('BE-05: во время тихих часов отложенный push ждёт, во время ошибки — восстанавливается', async () => {
    const quietCounters = await withStubbedMethods({
        findDeferredPushes: async () => [{ id: 5, user_id: 7 }],
        loadRecipientSettings: async () => new Map([[
            7,
            {
                timeZone: MSK,
                quietHours: resolveQuietHours({ enabled: true, start: '22:00', end: '08:00' })
            }
        ]]),
        claimDeferredPush: async () => {
            throw new Error('claim не должен вызываться в тихие часы')
        }
    }, () => reminderService.flushDeferredPushes(new Date('2026-11-01T19:30:00Z')))

    assert.equal(quietCounters.pushesSent, 0)
    assert.equal(quietCounters.deferredPushes, 1)

    const calls = []
    const originalConsoleError = console.error
    try {
        console.error = () => {}
        const failedCounters = await withStubbedMethods({
            findDeferredPushes: async () => [{ id: 6, user_id: 7 }],
            loadRecipientSettings: async () => new Map([[
                7,
                { timeZone: MSK, quietHours: resolveQuietHours({ enabled: false }) }
            ]]),
            claimDeferredPush: async () => true,
            sendDeferredPush: async () => {
                throw new Error('push service down')
            },
            completeDeferredPush: async notification => calls.push(['complete', notification.id]),
            restoreDeferredPush: async notification => calls.push(['restore', notification.id])
        }, () => reminderService.flushDeferredPushes(new Date('2026-11-01T07:00:00Z')))

        assert.equal(failedCounters.pushesSent, 0)
        assert.equal(failedCounters.errors, 1)
        assert.deepEqual(calls, [['restore', 6]])
    } finally {
        console.error = originalConsoleError
    }
})

test('BE-05: flushDeferredPushes не отправляет push, если claim не достался', async () => {
    let sent = 0
    const counters = await withStubbedMethods({
        findDeferredPushes: async () => [{ id: 7, user_id: 7 }],
        loadRecipientSettings: async () => new Map([[
            7,
            { timeZone: MSK, quietHours: resolveQuietHours({ enabled: false }) }
        ]]),
        claimDeferredPush: async () => false,
        sendDeferredPush: async () => {
            sent += 1
        }
    }, () => reminderService.flushDeferredPushes(new Date('2026-11-01T07:00:00Z')))

    assert.equal(sent, 0)
    assert.equal(counters.pushesSent, 0)
    assert.equal(counters.errors, 0)
})

test('BE-05: flushDeferredPushes без отложенных push ничего не делает', async () => {
    const counters = await withStubbedMethods({
        findDeferredPushes: async () => []
    }, () => reminderService.flushDeferredPushes(new Date('2026-11-01T07:00:00Z')))

    assert.equal(counters.pushesSent, 0)
    assert.equal(counters.deferredPushes, 0)
    assert.equal(counters.errors, 0)
})

test('BE-03: в digest пер-растение push не дублируется со сводкой', async () => {
    const calls = []
    await withStubbedMethods({
        notify: async (plant, options) => {
            calls.push(options)
            return { created: true, notification: { id: 1 } }
        },
        markNotified: async () => true
    }, async () => {
        const settingsByUser = new Map([[
            1,
            { timeZone: MSK, deliveryMode: 'digest', quietHours: resolveQuietHours({ enabled: false }) }
        ]])
        const onlinePlant = {
            id: 1,
            user_id: 1,
            name: 'Фикус',
            next_watering_at: NOW_0900_MSK,
            watering_interval_days: 1,
            metadata: {}
        }
        const tomorrowPlant = {
            ...onlinePlant,
            next_watering_at: new Date('2026-11-02T06:00:00Z')
        }

        assert.equal(
            await reminderService.sendOnDayTo(onlinePlant, {
                now: NOW_0900_MSK,
                to: new Date('2026-11-01T06:05:00Z'),
                settingsByUser
            }),
            false
        )
        assert.equal(
            await reminderService.sendDayBeforeTo(tomorrowPlant, {
                now: NOW_0900_MSK,
                settingsByUser
            }),
            false
        )
    })

    assert.deepEqual(calls, [], 'digest-режим: только сводка, без пер-растение push')
})

test('BE-05: в per_plant тихие часы передают notify отложенный skipPush', async () => {
    const calls = []
    const now = NOW_0900_MSK
    const quietSettingsByUser = new Map([[
        1,
        {
            timeZone: MSK,
            deliveryMode: 'per_plant',
            quietHours: resolveQuietHours({ enabled: true, start: '08:00', end: '10:00' })
        }
    ]])

    await withStubbedMethods({
        notify: async (plant, options) => {
            calls.push(options)
            return { created: true, notification: { id: 2 }, deferred: true }
        },
        markNotified: async () => true
    }, async () => {
        const plant = {
            id: 2,
            user_id: 1,
            name: 'Фикус',
            next_watering_at: now,
            watering_interval_days: 1,
            metadata: {}
        }
        await reminderService.sendOnDayTo(plant, {
            now,
            to: new Date('2026-11-01T06:05:00Z'),
            settingsByUser: quietSettingsByUser
        })
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].skipPush, true)
    assert.equal(calls[0].now, now)
    assert.equal(calls[0].tag, 'on_day')
})

test('reminderTick: агрегирует счётчики, пишет метрику и JSON-строку', async () => {
    const originalMethods = {
        autoSkipOverdue: reminderService.autoSkipOverdue,
        sendDayBefore: reminderService.sendDayBefore,
        sendOnDay: reminderService.sendOnDay,
        flushDeferredPushes: reminderService.flushDeferredPushes
    }
    const originalConsole = {
        log: console.log,
        info: console.info,
        error: console.error
    }
    const infoCalls = []
    const order = []
    resetReminderTickMetrics()

    try {
        console.log = () => {}
        console.error = () => {}
        console.info = (...args) => infoCalls.push(args)

        reminderService.autoSkipOverdue = async () => {
            order.push('autoSkipOverdue')
            return { batches: 2, plantsProcessed: 7, notificationsCreated: 1, errors: 2 }
        }
        reminderService.sendDayBefore = async () => {
            order.push('sendDayBefore')
            return { batches: 1, plantsProcessed: 3, notificationsCreated: 2, errors: 0 }
        }
        reminderService.sendOnDay = async () => {
            order.push('sendOnDay')
            throw new Error('db down')
        }
        reminderService.flushDeferredPushes = async () => {
            order.push('flushDeferredPushes')
            return { pushesSent: 1, deferredPushes: 2 }
        }

        await reminderService.reminderTick(new Date('2026-10-25T06:00:00Z'))

        assert.deepEqual(order, [
            'autoSkipOverdue',
            'sendDayBefore',
            'sendOnDay',
            'flushDeferredPushes'
        ])

        const metrics = getReminderTickMetrics()
        assert.equal(metrics.count, 1)
        const [tick] = metrics.ticks
        assert.equal(tick.batches, 3)
        assert.equal(tick.plantsProcessed, 10)
        assert.equal(tick.notificationsCreated, 3)
        assert.equal(tick.errors, 3, 'ошибки шагов + упавший шаг тика')
        assert.ok(tick.durationMs >= 0)
        assert.match(tick.startedAt, /^\d{4}-\d{2}-\d{2}T/)

        assert.equal(infoCalls.length, 1, 'ровно одна структурированная строка на тик')
        assert.equal(infoCalls[0][0], '[reminder-tick]')
        const logged = JSON.parse(infoCalls[0][1])
        assert.equal(logged.batches, 3)
        assert.equal(logged.plantsProcessed, 10)
        assert.equal(logged.notificationsCreated, 3)
        assert.equal(logged.errors, 3)
    } finally {
        for (const key of Object.keys(originalMethods)) delete reminderService[key]
        console.log = originalConsole.log
        console.info = originalConsole.info
        console.error = originalConsole.error
        resetReminderTickMetrics()
    }
})
