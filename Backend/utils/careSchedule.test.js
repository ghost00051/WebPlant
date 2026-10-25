import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCareSchedule } from './careSchedule.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-10-25T09:00:00+03:00')

const ALL_SEASONS = ['winter', 'spring', 'summer', 'autumn']

function action(overrides = {}) {
    return { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS, ...overrides }
}

function plant(id, plan, name = `Растение ${id}`) {
    return { id, name, plan }
}

test('планирует ближайшее действие каждого вида в горизонте', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, {
            spray: action({ minIntervalDays: 14 }),
            fertilize: action({ minIntervalDays: 14, seasons: ['spring', 'summer'] })
        }, 'Монстера')],
        logs: [],
        now: NOW,
        timeZone: MSK
    })

    assert.deepEqual(items, [{
        date: '2026-11-08',
        action_code: 'spray',
        title: 'Опрыскивание',
        plant_id: 1,
        plant_name: 'Монстера'
    }])
})

test('база — последний лог этого действия, сортировка по дате', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, {
            spray: action({ minIntervalDays: 14 }),
            rotate: action({ minIntervalDays: 30 })
        })],
        logs: [
            { plant_id: 1, action_code: 'spray', performed_at: '2026-10-20T09:00:00+03:00' },
            { plant_id: 1, action_code: 'rotate', performed_at: '2026-01-01T09:00:00+03:00' }
        ],
        now: NOW,
        timeZone: MSK
    })

    assert.deepEqual(items.map(item => [item.date, item.action_code]), [
        ['2026-10-25', 'rotate'],
        ['2026-11-03', 'spray']
    ])
})

test('из нескольких логов берётся самый свежий', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, { spray: action({ minIntervalDays: 14 }) })],
        logs: [
            { plant_id: 1, action_code: 'spray', performed_at: '2026-10-10T09:00:00+03:00' },
            { plant_id: 1, action_code: 'spray', performed_at: '2026-10-20T09:00:00+03:00' }
        ],
        now: NOW,
        timeZone: MSK
    })

    assert.equal(items.length, 1)
    assert.equal(items[0].date, '2026-11-03')
})

test('maxPerMonth = 0 и пустой список сезонов убирают действие', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, {
            spray: action({ minIntervalDays: 120, maxPerMonth: 0 }),
            rotate: action({ minIntervalDays: 7, seasons: [] }),
            pest_check: action({ minIntervalDays: 7 })
        })],
        logs: [],
        now: NOW,
        timeZone: MSK
    })

    assert.deepEqual(items.map(item => item.action_code), ['pest_check'])
})

test('горизонт days ограничивает ближайшие даты', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, {
            spray: action({ minIntervalDays: 14 }),
            rotate: action({ minIntervalDays: 1 })
        })],
        logs: [{ plant_id: 1, action_code: 'rotate', performed_at: '2026-09-01T09:00:00+03:00' }],
        now: NOW,
        days: 10,
        timeZone: MSK
    })

    assert.deepEqual(items.map(item => [item.date, item.action_code]), [
        ['2026-10-25', 'rotate']
    ])
})

test('просроченное плановое действие переносится на сегодня', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, { rotate: action({ minIntervalDays: 1 }) })],
        logs: [{ plant_id: 1, action_code: 'rotate', performed_at: '2026-08-01T09:00:00+03:00' }],
        now: NOW,
        timeZone: MSK
    })

    assert.equal(items.length, 1)
    assert.equal(items[0].date, '2026-10-25')
    assert.equal(items[0].title, 'Поворот к свету')
})

test('сезон проверяется на дату следующего действия', () => {
    const winterNow = new Date('2026-02-20T09:00:00+03:00')

    const springAllowed = buildCareSchedule({
        plants: [plant(1, { fertilize: action({ minIntervalDays: 10, seasons: ['spring'] }) })],
        logs: [],
        now: winterNow,
        timeZone: MSK
    })
    assert.deepEqual(springAllowed.items.map(item => item.date), ['2026-03-02'])

    const winterOnly = buildCareSchedule({
        plants: [plant(1, { fertilize: action({ minIntervalDays: 10, seasons: ['winter'] }) })],
        logs: [],
        now: winterNow,
        timeZone: MSK
    })
    assert.deepEqual(winterOnly.items, [])
})

test('локальная дата зависит от часового пояса', () => {
    const log = [{ plant_id: 1, action_code: 'rotate', performed_at: '2020-01-01T09:00:00Z' }]
    const plan = { rotate: action({ minIntervalDays: 1 }) }
    const lateEvening = new Date('2026-10-25T23:30:00Z')

    const moscow = buildCareSchedule({
        plants: [plant(1, plan)],
        logs: log,
        now: lateEvening,
        timeZone: MSK
    })
    assert.equal(moscow.items[0].date, '2026-10-26')

    const utc = buildCareSchedule({
        plants: [plant(1, plan)],
        logs: log,
        now: lateEvening,
        timeZone: 'UTC'
    })
    assert.equal(utc.items[0].date, '2026-10-25')
})

test('сортировка по date, plant_id и action_code', () => {
    const { items } = buildCareSchedule({
        plants: [
            plant(2, { rotate: action({ minIntervalDays: 1 }) }, 'Второе'),
            plant(1, {
                pest_check: action({ minIntervalDays: 1 }),
                rotate: action({ minIntervalDays: 1 })
            }, 'Первое')
        ],
        logs: [],
        now: NOW,
        timeZone: MSK
    })

    assert.deepEqual(items.map(item => [item.date, item.plant_id, item.action_code]), [
        ['2026-10-26', 1, 'pest_check'],
        ['2026-10-26', 1, 'rotate'],
        ['2026-10-26', 2, 'rotate']
    ])
})

test('некорректные данные не ломают расчёт', () => {
    const { items } = buildCareSchedule({
        plants: [
            { id: 'нет', name: 'Битое', plan: { rotate: action() } },
            { id: 1, name: 'Нормальное', plan: null },
            { id: 2, name: 'Без интервала', plan: { rotate: { maxPerMonth: 2 } } },
            { id: 3, name: 'Отрицательный', plan: { rotate: action({ minIntervalDays: -5 }) } }
        ],
        logs: [
            { plant_id: 'x', action_code: 'rotate', performed_at: NOW },
            { plant_id: 1, action_code: 'unknown', performed_at: NOW },
            { plant_id: 1, action_code: 'rotate', performed_at: 'битая дата' }
        ],
        now: NOW,
        timeZone: MSK
    })

    assert.deepEqual(items, [])
})

test('по умолчанию горизонт 90 дней', () => {
    const { items } = buildCareSchedule({
        plants: [plant(1, { fertilize: action({ minIntervalDays: 89 }) })],
        logs: [],
        now: NOW,
        timeZone: MSK
    })
    assert.equal(items.length, 1)
    assert.equal(items[0].date, '2027-01-22')

    const beyond = buildCareSchedule({
        plants: [plant(1, { fertilize: action({ minIntervalDays: 91 }) })],
        logs: [],
        now: NOW,
        timeZone: MSK
    })
    assert.deepEqual(beyond.items, [])
})
