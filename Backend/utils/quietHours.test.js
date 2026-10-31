import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_DELIVERY_MODE,
    DEFAULT_DIGEST_HOUR,
    DEFAULT_QUIET_HOURS_END,
    DEFAULT_QUIET_HOURS_START,
    DELIVERY_MODES,
    DELIVERY_MODE,
    describeQuietHoursWindow,
    formatClockMinutes,
    isMinuteInQuietWindow,
    isQuietTime,
    isQuietTimeForPreference,
    isValidClockTime,
    isValidDeliveryMode,
    minuteOfLocalDay,
    normalizeClockTime,
    parseClockMinutes,
    quietHoursFromPreference,
    resolveDeliveryMode,
    resolveDigestHour,
    resolveQuietHours
} from './quietHours.js'

const MSK = 'Europe/Moscow'

test('константы F41/F43', () => {
    assert.equal(DEFAULT_DELIVERY_MODE, 'digest')
    assert.deepEqual([...DELIVERY_MODES], ['digest', 'per_plant'])
    assert.equal(DELIVERY_MODE.PER_PLANT, 'per_plant')
    assert.equal(DEFAULT_QUIET_HOURS_START, '22:00')
    assert.equal(DEFAULT_QUIET_HOURS_END, '08:00')
    assert.equal(DEFAULT_DIGEST_HOUR, 9)
})

test('delivery_mode: валидация и дефолт digest', () => {
    assert.equal(isValidDeliveryMode('digest'), true)
    assert.equal(isValidDeliveryMode('per_plant'), true)
    assert.equal(isValidDeliveryMode('hourly'), false)
    assert.equal(isValidDeliveryMode(undefined), false)
    assert.equal(resolveDeliveryMode('per_plant'), 'per_plant')
    assert.equal(resolveDeliveryMode(undefined), 'digest')
    assert.equal(resolveDeliveryMode(null), 'digest')
})

test('isValidClockTime: только строгий HH:MM 24ч', () => {
    for (const valid of ['00:00', '07:05', '09:30', '22:00', '23:59']) {
        assert.equal(isValidClockTime(valid), true, valid)
    }
    for (const invalid of ['24:00', '9:00', '09:60', '09:5', 'ab:cd', '', null, undefined, 900]) {
        assert.equal(isValidClockTime(invalid), false, String(invalid))
    }
    assert.equal(isValidClockTime(' 08:15 '), true)
})

test('parseClockMinutes / formatClockMinutes: обратимость', () => {
    assert.equal(parseClockMinutes('00:00'), 0)
    assert.equal(parseClockMinutes('07:05'), 425)
    assert.equal(parseClockMinutes('23:59'), 1439)
    assert.equal(parseClockMinutes('24:00'), null)
    assert.equal(parseClockMinutes(null), null)

    assert.equal(formatClockMinutes(0), '00:00')
    assert.equal(formatClockMinutes(425), '07:05')
    assert.equal(formatClockMinutes(1439), '23:59')
    assert.equal(formatClockMinutes(1440), null)
    assert.equal(formatClockMinutes(-1), null)
    assert.equal(formatClockMinutes('x'), null)
})

test('resolveQuietHours: дефолты, нормализация и переход через полночь', () => {
    const defaults = resolveQuietHours({})
    assert.equal(defaults.enabled, false)
    assert.equal(defaults.start, '22:00')
    assert.equal(defaults.end, '08:00')
    assert.equal(defaults.startMinutes, 1320)
    assert.equal(defaults.endMinutes, 480)
    assert.equal(defaults.wrapsMidnight, true)

    const day = resolveQuietHours({ enabled: true, start: '10:00', end: '12:00' })
    assert.equal(day.wrapsMidnight, false)

    const broken = resolveQuietHours({ enabled: true, start: 'мусор', end: '25:00' })
    assert.equal(broken.start, '22:00')
    assert.equal(broken.end, '08:00')

    assert.equal(normalizeClockTime('09:15', '22:00'), '09:15')
    assert.equal(normalizeClockTime('09:75', '22:00'), '22:00')
})

test('minuteOfLocalDay: минутa локальных суток с часовым поясом', () => {
    assert.equal(minuteOfLocalDay(new Date('2026-11-01T06:00:00Z'), MSK), 9 * 60)
    assert.equal(minuteOfLocalDay(new Date('2026-11-01T21:30:00Z'), MSK), 30)
    assert.equal(minuteOfLocalDay('не дата', MSK), null)
})

test('isMinuteInQuietWindow: окно [start, end), в т.ч. через полночь', () => {
    const night = resolveQuietHours({ enabled: true, start: '22:00', end: '08:00' })
    const day = resolveQuietHours({ enabled: true, start: '10:00', end: '12:00' })
    const disabled = resolveQuietHours({ enabled: false, start: '22:00', end: '08:00' })

    assert.equal(isMinuteInQuietWindow(22 * 60, night), true)
    assert.equal(isMinuteInQuietWindow(23 * 60 + 30, night), true)
    assert.equal(isMinuteInQuietWindow(7 * 60 + 59, night), true)
    assert.equal(isMinuteInQuietWindow(8 * 60, night), false)
    assert.equal(isMinuteInQuietWindow(12 * 60, night), false)
    assert.equal(isMinuteInQuietWindow(21 * 60 + 59, night), false)

    assert.equal(isMinuteInQuietWindow(9 * 60 + 59, day), false)
    assert.equal(isMinuteInQuietWindow(10 * 60, day), true)
    assert.equal(isMinuteInQuietWindow(11 * 60 + 59, day), true)
    assert.equal(isMinuteInQuietWindow(12 * 60, day), false)

    assert.equal(isMinuteInQuietWindow(23 * 60, disabled), false)
    assert.equal(isMinuteInQuietWindow(null, night), false)
    assert.equal(isMinuteInQuietWindow(60, resolveQuietHours({ enabled: true, start: '09:00', end: '09:00' })), false)
})

test('isQuietTime и isQuietTimeForPreference: с учётом пояса пользователя', () => {
    const quietHours = resolveQuietHours({ enabled: true, start: '22:00', end: '08:00' })

    assert.equal(isQuietTime({ now: new Date('2026-11-01T19:30:00Z'), timeZone: MSK, quietHours }), true)
    assert.equal(isQuietTime({ now: new Date('2026-11-01T06:00:00Z'), timeZone: MSK, quietHours }), false)
    assert.equal(isQuietTime({ now: new Date('2026-11-01T19:30:00Z'), timeZone: 'UTC', quietHours }), false)

    assert.equal(isQuietTimeForPreference({
        quiet_hours_enabled: true,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00'
    }, { now: new Date('2026-11-01T19:30:00Z'), timeZone: MSK }), true)

    assert.equal(isQuietTimeForPreference({}, { now: new Date('2026-11-01T19:30:00Z'), timeZone: MSK }), false)
})

test('quietHoursFromPreference: дефолты для строки без колонок (до миграции)', () => {
    const legacy = quietHoursFromPreference({ user_id: 1 })
    assert.equal(legacy.enabled, false)
    assert.equal(legacy.start, '22:00')
    assert.equal(legacy.end, '08:00')

    const broken = quietHoursFromPreference({
        quiet_hours_enabled: true,
        quiet_hours_start: '29:00',
        quiet_hours_end: null
    })
    assert.equal(broken.start, '22:00')
    assert.equal(broken.end, '08:00')
})

test('resolveDigestHour: 09:00 или конец тихих часов', () => {
    assert.equal(resolveDigestHour({}), 9)
    assert.equal(resolveDigestHour({ digestHour: 9, quietHours: resolveQuietHours({ enabled: true, start: '22:00', end: '08:00' }) }), 9)
    assert.equal(resolveDigestHour({ digestHour: 9, quietHours: resolveQuietHours({ enabled: true, start: '08:00', end: '10:00' }) }), 10)
    assert.equal(resolveDigestHour({ digestHour: 9, quietHours: resolveQuietHours({ enabled: true, start: '09:00', end: '12:00' }) }), 12)
    assert.equal(resolveDigestHour({ digestHour: 9, quietHours: resolveQuietHours({ enabled: false, start: '09:00', end: '12:00' }) }), 9)
    assert.equal(resolveDigestHour({ digestHour: 40 }), 9)
    assert.equal(resolveDigestHour({ digestHour: 9, quietHours: resolveQuietHours({ enabled: true, start: '23:00', end: '07:00' }) }), 9)
})

test('describeQuietHoursWindow: человекочитаемое окно', () => {
    assert.equal(describeQuietHoursWindow({ start: '22:00', end: '08:00' }), '22:00–08:00 (через полночь)')
    assert.equal(describeQuietHoursWindow({ start: '10:00', end: '12:00' }), '10:00–12:00')
    assert.equal(describeQuietHoursWindow({}), '22:00–08:00 (через полночь)')
})

test('BE-08: равные границы тихих часов не образуют окно', () => {
    const same = resolveQuietHours({ enabled: true, start: '22:00', end: '22:00' })
    assert.equal(same.enabled, true)
    assert.equal(same.startMinutes, same.endMinutes)

    for (const minute of [0, 60, 720, 1320, 1439]) {
        assert.equal(isMinuteInQuietWindow(minute, same), false, String(minute))
    }
    assert.equal(isQuietTime({
        now: new Date('2026-11-01T19:30:00Z'),
        timeZone: MSK,
        quietHours: same
    }), false)

    const invalid = resolveQuietHours({ enabled: true, start: '25:00', end: '25:00' })
    assert.equal(invalid.start, '22:00')
    assert.equal(invalid.end, '08:00')
    assert.equal(invalid.startMinutes === invalid.endMinutes, false)
})
