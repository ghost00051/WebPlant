import test from 'node:test'
import assert from 'node:assert/strict'

import {
    RETENTION_MAX_DAYS,
    RETENTION_WINDOWS,
    buildActivity,
    buildPushMetrics,
    computeFunnel,
    computeRetention,
    formatCohortLabel,
    percent,
    toCount
} from './productMetrics.js'

test('RETENTION_WINDOWS: окна d1/d7/d30 и максимум 30 дней', () => {
    assert.deepEqual(RETENTION_WINDOWS, [
        { key: 'd1', days: 1 },
        { key: 'd7', days: 7 },
        { key: 'd30', days: 30 }
    ])
    assert.equal(RETENTION_MAX_DAYS, 30)
})

test('toCount: нечисла и отрицательные значения сводятся к 0', () => {
    assert.equal(toCount(5), 5)
    assert.equal(toCount('7'), 7)
    assert.equal(toCount('abc'), 0)
    assert.equal(toCount(-3), 0)
    assert.equal(toCount(null), 0)
    assert.equal(toCount(4.9), 4)
})

test('percent: проценты с одним знаком, нулевой знаменатель — 0', () => {
    assert.equal(percent(1, 3), 33.3)
    assert.equal(percent(2, 3), 66.7)
    assert.equal(percent(3, 3), 100)
    assert.equal(percent(0, 0), 0)
    assert.equal(percent(5, 0), 0)
    assert.equal(percent(2, 3, 2), 66.67)
})

test('computeFunnel: конверсии считаются от registered, 1 знак', () => {
    const funnel = computeFunnel({
        registered: 40,
        plantCreated: 20,
        wateringMarked: 10,
        pushSubscribed: 4
    })

    assert.deepEqual(funnel, {
        registered: 40,
        plantCreated: 20,
        wateringMarked: 10,
        pushSubscribed: 4,
        rates: {
            plantCreated: 50,
            wateringMarked: 25,
            pushSubscribed: 10
        }
    })
})

test('computeFunnel: без зарегистрированных конверсии нулевые', () => {
    const funnel = computeFunnel({ registered: 0, plantCreated: 0, wateringMarked: 0, pushSubscribed: 0 })
    assert.deepEqual(funnel.rates, { plantCreated: 0, wateringMarked: 0, pushSubscribed: 0 })
})

test('computeRetention: размеры, dN и проценты с подписью когорты', () => {
    const retention = computeRetention([
        { cohort: '2026-10-12', size: 4, d1: 2, d7: 3, d30: 4 },
        { cohort: '2026-10-19', size: 2, d1: 0, d7: 1, d30: 2 }
    ])

    assert.deepEqual(retention[0], {
        cohort: '2026-10-19',
        cohortLabel: '19.10',
        size: 2,
        d1: 0,
        d7: 1,
        d30: 2,
        d1Rate: 0,
        d7Rate: 50,
        d30Rate: 100
    })
    assert.deepEqual(retention[1], {
        cohort: '2026-10-12',
        cohortLabel: '12.10',
        size: 4,
        d1: 2,
        d7: 3,
        d30: 4,
        d1Rate: 50,
        d7Rate: 75,
        d30Rate: 100
    })
})

test('computeRetention: сортировка от новых к старым', () => {
    const retention = computeRetention([
        { cohort: '2026-09-28', size: 1, d1: 1, d7: 1, d30: 1 },
        { cohort: '2026-10-19', size: 1, d1: 0, d7: 0, d30: 0 },
        { cohort: '2026-10-05', size: 1, d1: 0, d7: 1, d30: 1 }
    ])
    assert.deepEqual(retention.map(point => point.cohort), ['2026-10-19', '2026-10-05', '2026-09-28'])
})

test('computeRetention: незаполненные окна будущего считаются нулями', () => {
    const retention = computeRetention([{ cohort: '2026-10-19', size: 3 }])
    assert.deepEqual(retention[0], {
        cohort: '2026-10-19',
        cohortLabel: '19.10',
        size: 3,
        d1: 0,
        d7: 0,
        d30: 0,
        d1Rate: 0,
        d7Rate: 0,
        d30Rate: 0
    })
})

test('computeRetention: пустые и битые входы не роняют расчёт', () => {
    assert.deepEqual(computeRetention([]), [])
    assert.deepEqual(computeRetention(null), [])
    assert.deepEqual(computeRetention([null, { size: 1 }]), [])
})

test('formatCohortLabel: DD.MM из YYYY-MM-DD', () => {
    assert.equal(formatCohortLabel('2026-10-19'), '19.10')
    assert.equal(formatCohortLabel('2026-01-05'), '05.01')
    assert.equal(formatCohortLabel('broken'), '')
    assert.equal(formatCohortLabel(null), '')
})

test('buildActivity: нормализует счётчики активности', () => {
    assert.deepEqual(buildActivity({
        dau: 5,
        wau: '11',
        mau: 20,
        activeUsers: 15,
        newUsers: 7,
        eventsToday: '3',
        eventsInRange: 123
    }), {
        dau: 5,
        wau: 11,
        mau: 20,
        activeUsers: 15,
        newUsers: 7,
        eventsToday: 3,
        eventsInRange: 123
    })
})

test('buildPushMetrics: CTR кликов по уведомлениям, 1 знак', () => {
    assert.deepEqual(buildPushMetrics({ notifications: 100, clicks: 25, clickedToday: 2 }), {
        notifications: 100,
        clicks: 25,
        ctr: 25,
        clickedToday: 2
    })
    assert.equal(buildPushMetrics({ notifications: 0, clicks: 0 }).ctr, 0)
    assert.equal(buildPushMetrics({ notifications: 3, clicks: 1 }).ctr, 33.3)
})
