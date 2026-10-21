import test from 'node:test'
import assert from 'node:assert/strict'

import {
    advanceZonedWatering,
    generateWateringOccurrences,
    isReminderWeekday,
    isWateringMissed,
    localDayRange,
    MISSED_GRACE_MS,
    nextWateringInstant,
    normalizeReminderWeekdays,
    parseWateringSlot,
    pickWateringLogForSlot,
    reminderWeekdaysForInterval,
    resolveMissedLateness,
    resolvePastWatering,
    splitMissedWaterings,
    weekdayRestrictionApplies
} from './wateringSchedule.js'

const MSK = 'Europe/Moscow'
const BERLIN = 'Europe/Berlin'
const VLADIVOSTOK = 'Asia/Vladivostok'
const HONOLULU = 'Pacific/Honolulu'

const iso = value => (value === null ? null : new Date(value).toISOString())
const localTime = (value, timeZone) => new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
}).format(value)

test('nextWateringInstant: локальный час полива сохраняется', () => {
    assert.equal(
        iso(nextWateringInstant(new Date('2026-10-19T06:00:00Z'), 7, 'morning', { timeZone: MSK })),
        '2026-10-26T06:00:00.000Z'
    )
    assert.equal(
        iso(nextWateringInstant(new Date('2026-10-19T06:00:00Z'), 1, 'evening', { timeZone: MSK })),
        '2026-10-20T16:00:00.000Z'
    )
    assert.equal(nextWateringInstant('не дата', 7), null)
})

test('nextWateringInstant: переход на летнее время не сдвигает 09:00', () => {
    const next = nextWateringInstant(
        new Date('2026-03-25T08:00:00Z'),
        7,
        'morning',
        { timeZone: BERLIN }
    )
    assert.equal(iso(next), '2026-04-01T07:00:00.000Z')
    assert.match(localTime(next, BERLIN), /09:00$/)
})

test('generateWateringOccurrences: прогноз идёт по локальным дням через DST', () => {
    const occurrences = generateWateringOccurrences(
        new Date('2026-03-25T08:00:00Z'),
        7,
        {
            now: new Date('2026-03-26T00:00:00Z'),
            daysAhead: 30,
            timeZone: BERLIN
        }
    )

    assert.deepEqual(occurrences.map(iso), [
        '2026-03-25T08:00:00.000Z',
        '2026-04-01T07:00:00.000Z',
        '2026-04-08T07:00:00.000Z',
        '2026-04-15T07:00:00.000Z',
        '2026-04-22T07:00:00.000Z'
    ])
    for (const occurrence of occurrences) {
        assert.match(localTime(occurrence, BERLIN), /09:00$/)
    }
})

test('generateWateringOccurrences: невалидные аргументы дают пустой список', () => {
    assert.deepEqual(generateWateringOccurrences(new Date('2026-10-01T06:00:00Z'), 0, {}), [])
    assert.deepEqual(generateWateringOccurrences('не дата', 7, {}), [])
    assert.deepEqual(generateWateringOccurrences(new Date('2026-10-01T06:00:00Z'), 7, { daysAhead: -1 }), [])
})

test('advanceZonedWatering: первый будущий слот в локальном поясе', () => {
    assert.equal(
        iso(advanceZonedWatering(
            new Date('2026-10-16T06:00:00Z'),
            7,
            9,
            MSK,
            new Date('2026-10-19T12:00:00Z')
        )),
        '2026-10-23T06:00:00.000Z'
    )
    assert.equal(
        iso(advanceZonedWatering(
            new Date('2026-10-01T06:00:00Z'),
            1,
            9,
            MSK,
            new Date('2026-10-19T12:00:00Z')
        )),
        '2026-10-20T06:00:00.000Z'
    )
    assert.equal(advanceZonedWatering('не дата', 7, 9, MSK), null)
})

test('advanceZonedWatering: fast-forward из далёкого прошлого не блокирует event loop', () => {
    const startedAt = performance.now()
    const next = advanceZonedWatering(
        new Date('1900-01-01T00:00:00Z'),
        1,
        9,
        MSK,
        new Date('2026-10-19T06:10:00Z')
    )
    const elapsed = performance.now() - startedAt
    assert.equal(iso(next), '2026-10-20T06:00:00.000Z')
    assert.ok(elapsed < 2000, `advanceZonedWatering занял ${elapsed.toFixed(0)} мс`)
})

test('splitMissedWaterings: ежедневный график — сегодняшний слот ещё не пропущен (grace-aware)', () => {
    const result = splitMissedWaterings(
        new Date('2026-10-19T06:00:00Z'),
        1,
        9,
        MSK,
        new Date('2026-10-20T06:10:00Z')
    )

    assert.deepEqual(result.missed.map(iso), ['2026-10-19T06:00:00.000Z'])
    assert.equal(iso(result.next), '2026-10-20T06:00:00.000Z')
})

test('splitMissedWaterings: слот в пределах grace не пропущен и возвращается как next', () => {
    const slot = new Date('2026-10-19T06:00:00Z')
    const result = splitMissedWaterings(slot, 1, 9, MSK, new Date('2026-10-19T08:00:00Z'))
    assert.deepEqual(result.missed, [])
    assert.equal(iso(result.next), '2026-10-19T06:00:00.000Z')
})

test('splitMissedWaterings: ровно на границе grace (slot + grace === now) слот пропущен', () => {
    const slot = new Date('2026-10-19T06:00:00Z')
    const now = new Date(slot.getTime() + MISSED_GRACE_MS)
    const result = splitMissedWaterings(slot, 1, 9, MSK, now)
    assert.deepEqual(result.missed.map(iso), ['2026-10-19T06:00:00.000Z'])
    assert.equal(iso(result.next), '2026-10-20T06:00:00.000Z')
})

test('splitMissedWaterings: простой сервиса на неделю — пропущен только старый слот', () => {
    const result = splitMissedWaterings(
        new Date('2026-10-12T06:00:00Z'),
        7,
        9,
        MSK,
        new Date('2026-10-19T06:10:00Z')
    )
    assert.deepEqual(result.missed.map(iso), ['2026-10-12T06:00:00.000Z'])
    assert.equal(iso(result.next), '2026-10-19T06:00:00.000Z')
})

test('splitMissedWaterings: graceMs можно переопределить (0 — пропущен любой прошедший слот)', () => {
    const result = splitMissedWaterings(
        new Date('2026-10-19T06:00:00Z'),
        1,
        9,
        MSK,
        new Date('2026-10-19T06:10:00Z'),
        { graceMs: 0 }
    )
    assert.deepEqual(result.missed.map(iso), ['2026-10-19T06:00:00.000Z'])
    assert.equal(iso(result.next), '2026-10-20T06:00:00.000Z')
})

test('splitMissedWaterings: для недельного графика пропущен ровно один слот', () => {
    const result = splitMissedWaterings(
        new Date('2026-10-12T06:00:00Z'),
        7,
        9,
        MSK,
        new Date('2026-10-13T06:10:00Z')
    )
    assert.deepEqual(result.missed.map(iso), ['2026-10-12T06:00:00.000Z'])
    assert.equal(iso(result.next), '2026-10-19T06:00:00.000Z')
})

test('localDayRange: сутки считаются в поясе пользователя', () => {
    const range = localDayRange(new Date('2026-10-18T23:00:00Z'), VLADIVOSTOK)
    assert.equal(iso(range.from), '2026-10-18T14:00:00.000Z')
    assert.equal(iso(range.to), '2026-10-19T13:59:59.999Z')
    assert.equal(localDayRange(null, MSK), null)
})

test('pickWateringLogForSlot: находит отметку того же локального дня вне UTC-суток', () => {
    const slot = new Date('2026-10-18T23:00:00Z')
    const log = {
        id: 1,
        action: 'watered',
        action_at: new Date('2026-10-19T10:00:00Z'),
        scheduled_for: null
    }
    assert.equal(pickWateringLogForSlot([log], 'watered', slot, VLADIVOSTOK), log)

    const moscowSlot = new Date('2026-10-19T06:00:00Z')
    const moscowLog = {
        id: 2,
        action: 'watered',
        action_at: new Date('2026-10-18T21:30:00Z'),
        scheduled_for: null
    }
    assert.equal(pickWateringLogForSlot([moscowLog], 'watered', moscowSlot, MSK), moscowLog)
})

test('pickWateringLogForSlot: точное совпадение слота важнее соседнего', () => {
    const slot = new Date('2026-10-19T06:00:00Z')
    const target = { id: 1, action: 'skipped', scheduled_for: slot, action_at: new Date('2026-10-20T06:00:00Z') }
    const neighbour = { id: 2, action: 'skipped', scheduled_for: new Date('2026-10-18T06:00:00Z'), action_at: slot }
    assert.equal(pickWateringLogForSlot([neighbour, target], 'skipped', slot, MSK), target)
    assert.equal(pickWateringLogForSlot([neighbour], 'skipped', slot, MSK), null)
})

test('parseWateringSlot: принимает дату и ISO с таймзоной, отвергает naive и мусор', () => {
    assert.equal(iso(parseWateringSlot('2026-10-19', 9, MSK)), '2026-10-19T06:00:00.000Z')
    assert.equal(iso(parseWateringSlot('2026-10-19T09:00:00+03:00', 9, MSK)), '2026-10-19T06:00:00.000Z')
    assert.equal(iso(parseWateringSlot('2026-10-19T06:00:00.000Z', 9, MSK)), '2026-10-19T06:00:00.000Z')
    assert.equal(parseWateringSlot('2026-10-19T09:00', 9, MSK), null)
    assert.equal(parseWateringSlot('2026-02-31', 9, MSK), null)
    assert.equal(parseWateringSlot('1999-10-19T09:00:00Z', 9, MSK), null)
    assert.equal(parseWateringSlot('3000-01-01T09:00:00Z', 9, MSK), null)
    assert.equal(parseWateringSlot('', 9, MSK), null)
    assert.equal(parseWateringSlot(1759600000000, 9, MSK), null)
})

test('resolvePastWatering: фиксирует фактическое опоздание и не откатывает план', () => {
    const plan = resolvePastWatering(new Date('2026-10-10T06:00:00Z'), {
        now: new Date('2026-10-14T12:00:00Z'),
        lastWateredAt: new Date('2026-10-03T06:00:00Z'),
        nextWateringAt: new Date('2026-10-17T06:00:00Z'),
        intervalDays: 7,
        timeOfDayHours: 9,
        timeZone: MSK
    })

    assert.equal(plan.hoursLate, 102)
    assert.equal(iso(plan.actionAt), '2026-10-10T06:00:00.000Z')
    assert.equal(iso(plan.lastWateredAt), '2026-10-10T06:00:00.000Z')
    assert.equal(iso(plan.nextWateringAt), '2026-10-17T06:00:00.000Z')
    assert.equal(plan.scheduleChanged, false)
})

test('resolvePastWatering: без текущего плана продолжает интервал от слота', () => {
    const plan = resolvePastWatering(new Date('2026-10-10T06:00:00Z'), {
        now: new Date('2026-10-12T12:00:00Z'),
        intervalDays: 7,
        timeOfDayHours: 9,
        timeZone: MSK
    })
    assert.equal(iso(plan.nextWateringAt), '2026-10-17T06:00:00.000Z')
    assert.equal(plan.scheduleChanged, true)
    assert.equal(plan.hoursLate, 54)
})

test('resolvePastWatering: будущий и некорректный слот отвергаются', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    assert.equal(resolvePastWatering(new Date('2026-10-12T06:00:00Z'), { now }), null)
    assert.equal(resolvePastWatering('не дата', { now }), null)
    assert.equal(resolvePastWatering(null, { now }), null)
})

test('reminderWeekdaysForInterval и normalizeReminderWeekdays: дни недели следуют за планом', () => {
    const monday = new Date('2026-10-19T06:00:00Z')
    const tuesday = new Date('2026-10-20T06:00:00Z')

    assert.deepEqual(reminderWeekdaysForInterval(7, monday, MSK), [1])
    assert.deepEqual(reminderWeekdaysForInterval(14, monday, MSK), [1])
    assert.deepEqual(reminderWeekdaysForInterval(1, monday, MSK), [0, 1, 2, 3, 4, 5, 6])
    assert.deepEqual(reminderWeekdaysForInterval(3, monday, MSK), [])

    assert.deepEqual(normalizeReminderWeekdays(7, [1], tuesday, MSK), [2])
    assert.deepEqual(normalizeReminderWeekdays(7, [2], tuesday, MSK), [2])
    assert.deepEqual(normalizeReminderWeekdays(7, [], tuesday, MSK), [])
    assert.deepEqual(normalizeReminderWeekdays(1, [2, 2, 5], tuesday, MSK), [2, 5])
    assert.deepEqual(normalizeReminderWeekdays(3, [1, 2], tuesday, MSK), [])
})

test('isReminderWeekday: день недели берётся из пояса пользователя', () => {
    const mondayMorningMsk = new Date('2026-10-19T06:00:00Z')
    assert.equal(isReminderWeekday([1], mondayMorningMsk, MSK), true)
    assert.equal(isReminderWeekday([1], mondayMorningMsk, HONOLULU), false)
    assert.equal(isReminderWeekday([0], mondayMorningMsk, HONOLULU), true)
    assert.equal(isReminderWeekday([], mondayMorningMsk, MSK), true)
})

test('weekdayRestrictionApplies: только ежедневный и кратные неделе интервалы', () => {
    assert.equal(weekdayRestrictionApplies(1), true)
    assert.equal(weekdayRestrictionApplies(7), true)
    assert.equal(weekdayRestrictionApplies(14), true)
    assert.equal(weekdayRestrictionApplies(3), false)
    assert.equal(weekdayRestrictionApplies(0), false)
    assert.equal(weekdayRestrictionApplies('7'), false)
})

test('isWateringMissed: просрочка наступает в локальную полночь', () => {
    const scheduled = new Date('2026-10-19T06:00:00Z')
    assert.equal(isWateringMissed(scheduled, {
        now: new Date('2026-10-19T20:59:00Z'),
        timeZone: MSK
    }), false)
    assert.equal(isWateringMissed(scheduled, {
        now: new Date('2026-10-19T21:00:00Z'),
        timeZone: MSK
    }), true)
    assert.equal(isWateringMissed(null, {}), false)
})

test('resolveMissedLateness: опоздание замирает на первом поливе после слота', () => {
    assert.deepEqual(
        resolveMissedLateness('2026-09-01T16:00:00.000Z', {
            now: new Date('2026-10-20T09:00:00.000Z'),
            wateredAt: new Date('2026-09-08T16:00:00.000Z')
        }),
        { hoursLate: 168, daysLate: 7 }
    )
    assert.equal(resolveMissedLateness(undefined, {}), null)
})
