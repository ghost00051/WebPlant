import test from 'node:test'
import assert from 'node:assert/strict'

import {
    RETENTION_MAX_DAYS,
    RETENTION_WINDOWS,
    buildActivity,
    buildMetricItem,
    buildMetricsSummary,
    buildPushMetrics,
    computeFunnel,
    computeRetention,
    formatCohortLabel,
    formatMetricPercent,
    formatMetricRub,
    formatMetricSeconds,
    formatMetricValue,
    normalizeMetricStatus,
    percent,
    targetAtLeast,
    targetAtMost,
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

test('formatMetricSeconds: целые секунды с суффиксом и прочерк без данных', () => {
    assert.equal(formatMetricSeconds(142), '142 с')
    assert.equal(formatMetricSeconds(101.6), '102 с')
    assert.equal(formatMetricSeconds('60'), '60 с')
    assert.equal(formatMetricSeconds(0), '0 с')
    assert.equal(formatMetricSeconds(null), '—')
    assert.equal(formatMetricSeconds(undefined), '—')
    assert.equal(formatMetricSeconds('broken'), '—')
})

test('formatMetricPercent: один знак, запятая, без хвостового ,0', () => {
    assert.equal(formatMetricPercent(38.9), '38,9%')
    assert.equal(formatMetricPercent(41), '41%')
    assert.equal(formatMetricPercent(0), '0%')
    assert.equal(formatMetricPercent(100), '100%')
    assert.equal(formatMetricPercent(12.04), '12%')
    assert.equal(formatMetricPercent(null), '—')
})

test('formatMetricRub: рубли с запятой и прочерк без данных', () => {
    assert.equal(formatMetricRub(2.1), '2,1 ₽')
    assert.equal(formatMetricRub(3), '3 ₽')
    assert.equal(formatMetricRub(0.133), '0,13 ₽')
    assert.equal(formatMetricRub(0), '0 ₽')
    assert.equal(formatMetricRub(null), '—')
    assert.equal(formatMetricRub(NaN), '—')
})

test('formatMetricValue: выбирает формат по unit, неизвестный unit — число', () => {
    assert.equal(formatMetricValue(142, 'seconds'), '142 с')
    assert.equal(formatMetricValue(38.9, 'percent'), '38,9%')
    assert.equal(formatMetricValue(2.1, 'rub'), '2,1 ₽')
    assert.equal(formatMetricValue(7, undefined), '7')
    assert.equal(formatMetricValue(null, 'percent'), '—')
})

test('normalizeMetricStatus: неизвестный статус — unavailable', () => {
    assert.equal(normalizeMetricStatus('measured'), 'measured')
    assert.equal(normalizeMetricStatus('partial'), 'partial')
    assert.equal(normalizeMetricStatus('unavailable'), 'unavailable')
    assert.equal(normalizeMetricStatus('nope'), 'unavailable')
    assert.equal(normalizeMetricStatus(undefined), 'unavailable')
})

test('targetAtLeast / targetAtMost: null без значения, границы включительно', () => {
    assert.equal(targetAtLeast(40, 40), true)
    assert.equal(targetAtLeast(39.9, 40), false)
    assert.equal(targetAtMost(5, 5), true)
    assert.equal(targetAtMost(5.01, 5), false)
    assert.equal(targetAtLeast(null, 40), null)
    assert.equal(targetAtMost(undefined, 5), null)
    assert.equal(targetAtLeast('broken', 40), null)
})

test('buildMetricItem: полный контракт MetricItem для measured-метрики', () => {
    const definition = {
        id: 'ttfv',
        label: 'TTFV — время до первой ценности',
        priority: 'P0',
        horizon: '3 недели',
        target: '< 60 сек у 60% новых',
        source: 'product_events; admin → Продукт',
        unit: 'seconds'
    }

    assert.deepEqual(buildMetricItem(definition, {
        status: 'measured',
        value: 142,
        targetMet: false,
        detail: 'медиана; n=2; 50% ≤ 60 с'
    }), {
        id: 'ttfv',
        label: 'TTFV — время до первой ценности',
        priority: 'P0',
        horizon: '3 недели',
        target: '< 60 сек у 60% новых',
        status: 'measured',
        value: 142,
        unit: 'seconds',
        display: '142 с',
        detail: 'медиана; n=2; 50% ≤ 60 с',
        source: 'product_events; admin → Продукт',
        targetMet: false
    })
})

test('buildMetricItem: partial сохраняет значение, unavailable обнуляет и display —', () => {
    const definition = { id: 'premium', label: 'Конверсия в Premium', unit: 'percent' }

    const partialItem = buildMetricItem(definition, {
        status: 'partial',
        value: 0,
        targetMet: false,
        detail: 'биллинг не внедрён (F15)'
    })
    assert.equal(partialItem.status, 'partial')
    assert.equal(partialItem.value, 0)
    assert.equal(partialItem.display, '0%')
    assert.equal(partialItem.targetMet, false)
    assert.equal(partialItem.display, '0%')
    assert.equal(partialItem.priority, 'P2')

    const unavailableItem = buildMetricItem(definition, {
        status: 'unavailable',
        value: 12,
        targetMet: true,
        detail: 'нет таблицы'
    })
    assert.equal(unavailableItem.status, 'unavailable')
    assert.equal(unavailableItem.value, null)
    assert.equal(unavailableItem.display, '—')
    assert.equal(unavailableItem.targetMet, null)
})

test('buildMetricItem: metric без значения получает null и targetMet null', () => {
    const item = buildMetricItem({ id: 'd1', unit: 'percent' }, {
        status: 'partial',
        value: null,
        targetMet: true,
        detail: 'нет пользователей с завершённым окном D1'
    })
    assert.equal(item.value, null)
    assert.equal(item.display, '—')
    assert.equal(item.targetMet, null)
    assert.equal(item.unit, 'percent')
    assert.equal(item.label, 'd1')
})

test('buildMetricItem: неизвестный unit откатывается к unit из определения', () => {
    const item = buildMetricItem({ id: 'ai_cost', unit: 'rub' }, { status: 'measured', value: 2.1, unit: 'unknown' })
    assert.equal(item.unit, 'rub')
    assert.equal(item.display, '2,1 ₽')
})

test('buildMetricsSummary: считает measured/partial/unavailable и total', () => {
    const summary = buildMetricsSummary([
        { status: 'measured' },
        { status: 'measured' },
        { status: 'partial' },
        { status: 'unavailable' },
        { status: 'unknown' }
    ])
    assert.deepEqual(summary, { total: 5, measured: 2, partial: 1, unavailable: 2 })
    assert.deepEqual(buildMetricsSummary([]), { total: 0, measured: 0, partial: 0, unavailable: 0 })
    assert.deepEqual(buildMetricsSummary(null), { total: 0, measured: 0, partial: 0, unavailable: 0 })
})
