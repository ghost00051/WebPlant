import test from 'node:test'
import assert from 'node:assert/strict'

import {
    backupIntervalHours,
    backupScheduleFromEnv,
    getTimeZoneOffsetMs,
    mapBackupRun,
    nextBackupRun,
    parseBackupTimes,
    summarizeBackupStatus
} from './backupStatus.js'

const MSK = 'Europe/Moscow'

test('parseBackupTimes: разбирает строку, сортирует и убирает дубли', () => {
    assert.deepEqual(parseBackupTimes('14:00,02:00').map(slot => slot.label), ['02:00', '14:00'])
    assert.deepEqual(parseBackupTimes(['02:00', '02:00']).map(slot => slot.label), ['02:00'])
    assert.deepEqual(parseBackupTimes([' 09:30 ']).map(slot => slot.minutes), [570])
})

test('parseBackupTimes: мусор отбрасывается, пустое значение даёт расписание по умолчанию', () => {
    assert.deepEqual(parseBackupTimes('25:00,02:00').map(slot => slot.label), ['02:00'])
    assert.deepEqual(parseBackupTimes('').map(slot => slot.label), ['02:00', '14:00'])
    assert.deepEqual(parseBackupTimes(null).map(slot => slot.label), ['02:00', '14:00'])
    assert.deepEqual(parseBackupTimes('abc,def').map(slot => slot.label), ['02:00', '14:00'])
})

test('backupScheduleFromEnv: пояс берётся из BACKUP_TIME_ZONE, затем APP_TIME_ZONE', () => {
    assert.equal(backupScheduleFromEnv({}).timeZone, 'Europe/Moscow')
    assert.equal(backupScheduleFromEnv({ APP_TIME_ZONE: 'Asia/Vladivostok' }).timeZone, 'Asia/Vladivostok')
    assert.equal(
        backupScheduleFromEnv({ BACKUP_TIME_ZONE: 'Asia/Novosibirsk', APP_TIME_ZONE: 'Asia/Vladivostok' }).timeZone,
        'Asia/Novosibirsk'
    )
    assert.deepEqual(backupScheduleFromEnv({ BACKUP_TIMES: '03:15' }).times.map(slot => slot.label), ['03:15'])
    assert.equal(backupScheduleFromEnv({ BACKUP_TIMES: '03:15' }).timeZone, MSK)
})

test('backupIntervalHours: интервал выводится из количества слотов', () => {
    assert.equal(backupIntervalHours(['02:00', '14:00']), 12)
    assert.equal(backupIntervalHours(['02:00']), 24)
    assert.equal(backupIntervalHours(['00:00', '06:00', '12:00', '18:00']), 6)
})

test('getTimeZoneOffsetMs: Москва держит +3 часа круглый год', () => {
    assert.equal(getTimeZoneOffsetMs(new Date('2026-01-15T12:00:00Z'), MSK), 3 * 3600000)
    assert.equal(getTimeZoneOffsetMs(new Date('2026-07-15T12:00:00Z'), MSK), 3 * 3600000)
})

test('nextBackupRun: 02:00 и 14:00 по Москве в UTC — это 23:00 и 11:00', () => {
    // 2026-10-25T20:00Z = 23:00 МСК — оба слота прошли, ждём 02:00 МСК следующих суток.
    assert.equal(
        nextBackupRun({ now: new Date('2026-10-25T20:00:00Z'), timeZone: MSK }).toISOString(),
        '2026-10-25T23:00:00.000Z'
    )

    // 2026-10-25T00:00Z = 03:00 МСК — следующий слот 14:00 МСК = 11:00Z.
    assert.equal(
        nextBackupRun({ now: new Date('2026-10-25T00:00:00Z'), timeZone: MSK }).toISOString(),
        '2026-10-25T11:00:00.000Z'
    )

    // За секунду до слота: 13:59:59 МСК.
    assert.equal(
        nextBackupRun({ now: new Date('2026-10-25T10:59:59Z'), timeZone: MSK }).toISOString(),
        '2026-10-25T11:00:00.000Z'
    )

    // Ровно в момент запуска следующий — уже противоположный слот.
    assert.equal(
        nextBackupRun({ now: new Date('2026-10-25T11:00:00Z'), timeZone: MSK }).toISOString(),
        '2026-10-25T23:00:00.000Z'
    )
})

test('nextBackupRun: кастомное время и другой пояс считаются от локальных часов', () => {
    // 04:30 по Москве: now 01:30Z, слот 04:30 МСК = 01:30Z уже наступил -> следующий 16:30 МСК = 13:30Z.
    assert.equal(
        nextBackupRun({
            now: new Date('2026-10-25T01:30:00Z'),
            times: ['04:30', '16:30'],
            timeZone: MSK
        }).toISOString(),
        '2026-10-25T13:30:00.000Z'
    )

    // Владивосток (+10): слот 09:00 местного = 23:00Z предыдущих суток.
    assert.equal(
        nextBackupRun({
            now: new Date('2026-10-25T20:00:00Z'),
            times: ['09:00'],
            timeZone: 'Asia/Vladivostok'
        }).toISOString(),
        '2026-10-25T23:00:00.000Z'
    )
})

test('mapBackupRun: приводит строку из БД к форме ответа', () => {
    const mapped = mapBackupRun({
        id: 7,
        source: 'host',
        status: 'ok',
        started_at: '2026-10-25T11:00:00Z',
        finished_at: '2026-10-25T11:00:42Z',
        database_bytes: '1048576',
        files: ['/backups/webplant_1.dump']
    })

    assert.equal(mapped.id, 7)
    assert.equal(mapped.status, 'ok')
    assert.equal(mapped.durationSeconds, 42)
    assert.equal(mapped.databaseBytes, 1048576)
    assert.deepEqual(mapped.files, ['/backups/webplant_1.dump'])
    assert.equal(mapped.error, null)
})

test('mapBackupRun: неизвестный статус считается ошибкой, пустые поля — null', () => {
    const mapped = mapBackupRun({ source: 'cluster', status: 'whatever' })
    assert.equal(mapped.status, 'failed')
    assert.equal(mapped.startedAt, null)
    assert.equal(mapped.finishedAt, null)
    assert.equal(mapped.databaseBytes, null)
    assert.equal(mapped.durationSeconds, null)
})

test('summarizeBackupStatus: пустой журнал — статус never и корректный следующий запуск', () => {
    const now = new Date('2026-10-25T20:00:00Z')
    const status = summarizeBackupStatus({ runs: [], now, times: ['02:00', '14:00'], timeZone: MSK })

    assert.equal(status.available, true)
    assert.equal(status.health.status, 'never')
    assert.equal(status.lastSuccess, null)
    assert.equal(status.next.at, '2026-10-25T23:00:00.000Z')
    assert.equal(status.next.inSeconds, 3 * 3600)
    assert.equal(status.bySource.host.last, null)
    assert.equal(status.bySource.cluster.last, null)
})

test('summarizeBackupStatus: свежий успешный бэкап — ok, последний по каждому источнику', () => {
    const now = new Date('2026-10-25T20:00:00Z')
    const status = summarizeBackupStatus({
        now,
        times: ['02:00', '14:00'],
        timeZone: MSK,
        runs: [
            { id: 3, source: 'host', status: 'ok', started_at: '2026-10-25T11:00:00Z', finished_at: '2026-10-25T11:00:30Z' },
            { id: 2, source: 'cluster', status: 'ok', started_at: '2026-10-25T11:00:00Z', finished_at: '2026-10-25T11:00:20Z' },
            { id: 1, source: 'host', status: 'failed', started_at: '2026-10-24T23:00:00Z', finished_at: '2026-10-24T23:00:05Z' }
        ]
    })

    assert.equal(status.health.status, 'ok')
    assert.equal(status.lastSuccess.id, 3)
    assert.equal(status.lastSuccess.hoursAgo, 9)
    assert.equal(status.lastSuccess.intervalPercent, 75)
    assert.equal(status.bySource.host.last.id, 3)
    assert.equal(status.bySource.cluster.last.id, 2)
})

test('summarizeBackupStatus: пропущенный слот — stale', () => {
    const now = new Date('2026-10-26T20:00:00Z')
    const status = summarizeBackupStatus({
        now,
        times: ['02:00', '14:00'],
        timeZone: MSK,
        runs: [
            { id: 1, source: 'host', status: 'ok', started_at: '2026-10-25T11:00:00Z', finished_at: '2026-10-25T11:00:30Z' }
        ]
    })

    assert.equal(status.health.status, 'stale')
    assert.match(status.health.message, /33 ч/)
})

test('summarizeBackupStatus: упавший последний запуск важнее возраста успешного', () => {
    const now = new Date('2026-10-25T11:05:00Z')
    const status = summarizeBackupStatus({
        now,
        times: ['02:00', '14:00'],
        timeZone: MSK,
        runs: [
            { id: 2, source: 'host', status: 'failed', started_at: '2026-10-25T11:00:00Z', finished_at: '2026-10-25T11:00:02Z', error: 'pg_dump failed' },
            { id: 1, source: 'host', status: 'ok', started_at: '2026-10-24T23:00:00Z', finished_at: '2026-10-24T23:00:30Z' }
        ]
    })

    assert.equal(status.health.status, 'failing')
    assert.match(status.health.message, /pg_dump failed/)
})
