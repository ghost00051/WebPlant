import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isoDayDiff,
  missedWateringLabel,
  splitNeedWateringPlants,
  zonedIsoDay
} from './wateringNeeds.js'

const MSK = 'Europe/Moscow'

test('zonedIsoDay: момент после полуночи по Москве относится к следующему дню', () => {
  assert.equal(zonedIsoDay('2026-10-21T22:30:00.000Z', MSK), '2026-10-22')
  assert.equal(zonedIsoDay('2026-10-21T22:30:00.000Z', 'UTC'), '2026-10-21')
})

test('zonedIsoDay: некорректная дата даёт null', () => {
  assert.equal(zonedIsoDay('не дата', MSK), null)
  assert.equal(zonedIsoDay(null, MSK), null)
})

test('zonedIsoDay: неизвестный часовой пояс откатывается на пояс приложения', () => {
  assert.equal(zonedIsoDay('2026-10-21T22:30:00.000Z', 'Not/AZone'), '2026-10-22')
})

test('isoDayDiff: считает разницу календарных дней', () => {
  assert.equal(isoDayDiff('2026-10-22', '2026-10-20'), 2)
  assert.equal(isoDayDiff('2026-10-20', '2026-10-22'), -2)
  assert.equal(isoDayDiff('2026-10-22', '2026-10-22'), 0)
  assert.equal(isoDayDiff('2026-10-22', 'мусор'), null)
})

test('split: растение с поливом на сегодня остаётся в «Сегодня»', () => {
  const now = new Date('2026-10-22T07:00:00.000Z') // 10:00 MSK
  const dueToday = { id: 1, next_watering_at: '2026-10-22T15:00:00.000Z' } // 18:00 MSK
  const dueEarlierToday = { id: 2, next_watering_at: '2026-10-22T04:00:00.000Z' } // 07:00 MSK

  const { today, missed } = splitNeedWateringPlants([dueToday, dueEarlierToday], {
    now,
    timeZone: MSK
  })

  assert.deepEqual(today.map(item => item.id), [1, 2])
  assert.equal(missed.length, 0)
})

test('split: просроченный next_watering_at попадает в «Пропущенные» с днями просрочки', () => {
  const now = new Date('2026-10-22T07:00:00.000Z') // 10:00 MSK
  const overdue = { id: 3, next_watering_at: '2026-10-20T06:00:00.000Z' } // 20 октября, 09:00 MSK

  const { today, missed } = splitNeedWateringPlants([overdue], { now, timeZone: MSK })

  assert.equal(today.length, 0)
  assert.equal(missed.length, 1)
  assert.equal(missed[0].plant.id, 3)
  assert.equal(missed[0].dueDay, '2026-10-20')
  assert.equal(missed[0].daysLate, 2)
})

test('split: missed_since важнее будущего next_watering_at (после авто-пропуска)', () => {
  const now = new Date('2026-10-22T07:00:00.000Z') // 10:00 MSK
  const skipped = {
    id: 4,
    next_watering_at: '2026-10-25T06:00:00.000Z',
    metadata: { missed_since: '2026-10-19T06:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([skipped], { now, timeZone: MSK })

  assert.equal(today.length, 0)
  assert.equal(missed[0].dueDay, '2026-10-19')
  assert.equal(missed[0].daysLate, 3)
})

test('split: новый плановый полив сегодня остаётся в «Пропущенных» и попадает в «Сегодня»', () => {
  const now = new Date('2026-10-25T09:00:00.000Z') // 12:00 MSK
  const plant = {
    id: 9,
    next_watering_at: '2026-10-25T06:00:00.000Z', // 25 октября, 09:00 MSK — снова пора полить
    metadata: { missed_since: '2026-10-24T06:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.deepEqual(today.map(item => item.id), [9])
  assert.deepEqual(today[0].previousMissedWatering, {
    dueDay: '2026-10-24',
    daysLate: 1
  })
  assert.equal(missed.length, 1)
  assert.equal(missed[0].plant.id, 9)
  assert.equal(missed[0].dueDay, '2026-10-24')
  assert.equal(missed[0].daysLate, 1)
})

test('split: после интервала от missed_since растение в «Сегодня» и в «Пропущенных» (прод-кейс plant 17)', () => {
  const now = new Date('2026-10-30T17:26:00.000Z') // 30 октября, 20:26 MSK
  const plant = {
    id: 17,
    watering_interval_days: 1,
    watering_time_of_day: 'day',
    next_watering_at: '2026-10-29T11:00:00.000Z', // 29 октября, 14:00 MSK — план заморожен на пропуске
    metadata: { missed_since: '2026-10-29T11:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.deepEqual(today.map(item => item.id), [17])
  assert.deepEqual(today[0].previousMissedWatering, {
    dueDay: '2026-10-29',
    daysLate: 1
  })
  assert.equal(missed.length, 1)
  assert.equal(missed[0].plant.id, 17)
  assert.equal(missed[0].daysLate, 1)
})

test('split: очередной полив после пропуска ещё не наступил — только «Пропущенные»', () => {
  const now = new Date('2026-10-25T09:00:00.000Z') // 12:00 MSK
  const plant = {
    id: 10,
    watering_interval_days: 7,
    next_watering_at: '2026-10-27T06:00:00.000Z',
    metadata: { missed_since: '2026-10-24T06:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.equal(today.length, 0)
  assert.equal(missed.length, 1)
  assert.equal(missed[0].plant.id, 10)
})

test('split: пропуск остаётся в «Пропущенных», если следующий полив ещё не сегодня', () => {
  const now = new Date('2026-10-25T09:00:00.000Z')
  const plant = {
    id: 10,
    next_watering_at: '2026-10-27T06:00:00.000Z',
    metadata: { missed_since: '2026-10-24T06:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.equal(today.length, 0)
  assert.equal(missed.length, 1)
  assert.equal(missed[0].plant.id, 10)
})

test('split: растение после пропуска не дублируется в «Сегодня»', () => {
  const now = new Date('2026-10-30T17:26:00.000Z') // 30 октября, 20:26 MSK
  const plant = {
    id: 18,
    watering_interval_days: 1,
    next_watering_at: '2026-10-30T11:00:00.000Z', // сегодняшний слот тоже пропущен
    metadata: { missed_since: '2026-10-29T11:00:00.000Z' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.deepEqual(today.map(item => item.id), [18])
  assert.equal(missed.length, 1)
  assert.deepEqual(today[0].previousMissedWatering, {
    dueDay: '2026-10-29',
    daysLate: 1
  })
})

test('split: некорректный missed_since не превращает растение в пропущенное', () => {
  const now = new Date('2026-10-22T07:00:00.000Z')
  const plant = {
    id: 5,
    next_watering_at: '2026-10-23T06:00:00.000Z',
    metadata: { missed_since: 'не дата' }
  }

  const { today, missed } = splitNeedWateringPlants([plant], { now, timeZone: MSK })

  assert.deepEqual(today.map(item => item.id), [5])
  assert.equal(missed.length, 0)
})

test('split: день считается по часовому поясу пользователя, а не по UTC', () => {
  const now = new Date('2026-10-22T07:00:00.000Z') // 10:00 MSK
  const plant = { id: 6, next_watering_at: '2026-10-21T22:30:00.000Z' } // 22 октября, 01:30 MSK

  const msk = splitNeedWateringPlants([plant], { now, timeZone: MSK })
  const utc = splitNeedWateringPlants([plant], { now, timeZone: 'UTC' })

  assert.deepEqual(msk.today.map(item => item.id), [6])
  assert.equal(msk.missed.length, 0)
  assert.equal(utc.today.length, 0)
  assert.equal(utc.missed[0].daysLate, 1)
})

test('split: пропущенные сортируются от самого старого пропуска', () => {
  const now = new Date('2026-10-22T07:00:00.000Z')
  const fresh = { id: 7, next_watering_at: '2026-10-21T06:00:00.000Z' }
  const old = { id: 8, next_watering_at: '2026-10-01T06:00:00.000Z' }

  const { missed } = splitNeedWateringPlants([fresh, old], { now, timeZone: MSK })

  assert.deepEqual(missed.map(entry => entry.plant.id), [8, 7])
  assert.equal(missed[0].daysLate, 21)
})

test('split: пустой и некорректный список не роняют функцию', () => {
  assert.deepEqual(splitNeedWateringPlants(), { today: [], missed: [] })
  assert.deepEqual(splitNeedWateringPlants(null), { today: [], missed: [] })

  const { today, missed } = splitNeedWateringPlants([null, undefined, 42], {
    now: new Date()
  })

  assert.deepEqual(today, [])
  assert.deepEqual(missed, [])
})

test('missedWateringLabel: корректные формы слова «день»', () => {
  assert.equal(missedWateringLabel(1), 'Полив просрочен на 1 день')
  assert.equal(missedWateringLabel(2), 'Полив просрочен на 2 дня')
  assert.equal(missedWateringLabel(5), 'Полив просрочен на 5 дней')
  assert.equal(missedWateringLabel(21), 'Полив просрочен на 21 день')
  assert.equal(missedWateringLabel(0), 'Пропущен полив')
  assert.equal(missedWateringLabel(undefined), 'Пропущен полив')
})
