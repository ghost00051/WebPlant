import test from 'node:test'
import assert from 'node:assert/strict'

import {
    MAX_SEARCH_LENGTH,
    TIMEZONE,
    buildDayList,
    deviceFromUserAgent,
    escapeLike,
    isValidDay,
    isValidPrivilegeLevel,
    isValidRole,
    normalizeSeries,
    parseDay,
    parseOptionalId,
    parseOrder,
    parsePagination,
    parseRangeDays,
    parseReferrerHost,
    parseSearch,
    parseSort,
    parseVisitPath,
    parseVisitorId,
    sumSeries,
    userCreatedAtSql
} from './adminAnalytics.js'

test('parseRangeDays принимает корректные значения и подставляет значение по умолчанию', () => {
    assert.equal(parseRangeDays(undefined), 30)
    assert.equal(parseRangeDays(''), 30)
    assert.equal(parseRangeDays('1'), 1)
    assert.equal(parseRangeDays('365'), 365)
    assert.equal(parseRangeDays('30'), 30)
})

test('parseRangeDays отклоняет мусор и выход за границы', () => {
    for (const value of ['0', '366', '-5', '3.5', 'abc', ' 30', '1e2', ['30']]) {
        assert.equal(parseRangeDays(value), null, `значение ${String(value)}`)
    }
})

test('parsePagination считает offset и отклоняет некорректные параметры', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 25, offset: 0 })
    assert.deepEqual(parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 })
    assert.deepEqual(
        parsePagination({}, { defaultLimit: 50, maxLimit: 200 }),
        { page: 1, limit: 50, offset: 0 }
    )
    for (const query of [{ page: '0' }, { page: 'x' }, { limit: '0' }, { limit: '201' }, { limit: '1.5' }]) {
        assert.equal(parsePagination(query), null, `query ${JSON.stringify(query)}`)
    }
    assert.equal(parsePagination({ limit: '200' })?.limit, 200)
})

test('parseSearch ограничивает длину и типы', () => {
    assert.equal(parseSearch(undefined), '')
    assert.equal(parseSearch('  иван  '), 'иван')
    assert.equal(parseSearch(42), null)
    assert.equal(parseSearch('x'.repeat(MAX_SEARCH_LENGTH + 1)), null)
    assert.equal(parseSearch('x'.repeat(MAX_SEARCH_LENGTH)), 'x'.repeat(MAX_SEARCH_LENGTH))
})

test('escapeLike экранирует спецсимволы LIKE', () => {
    assert.equal(escapeLike('100%_test\\'), '100\\%\\_test\\\\')
    assert.equal(escapeLike('обычный текст'), 'обычный текст')
})

test('parseOptionalId понимает пустые значения и мусор', () => {
    assert.equal(parseOptionalId(undefined), undefined)
    assert.equal(parseOptionalId(''), undefined)
    assert.equal(parseOptionalId('17'), 17)
    assert.equal(parseOptionalId('0'), null)
    assert.equal(parseOptionalId('-1'), null)
    assert.equal(parseOptionalId('abc'), null)
})

test('isValidDay и buildDayList работают с реальными датами', () => {
    assert.equal(isValidDay('2026-10-12'), true)
    assert.equal(isValidDay('2026-02-30'), false)
    assert.equal(isValidDay('2026-13-01'), false)
    assert.equal(isValidDay('12.10.2026'), false)
    assert.equal(isValidDay(null), false)

    assert.deepEqual(buildDayList('2026-10-01', '2026-10-04'), [
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04'
    ])
    assert.deepEqual(buildDayList('2026-10-04', '2026-10-01'), [])
    assert.deepEqual(buildDayList('2026-02-27', '2026-03-01'), [
        '2026-02-27',
        '2026-02-28',
        '2026-03-01'
    ])
})

test('parseDay принимает пустое значение как «фильтр не задан»', () => {
    assert.equal(parseDay(undefined), undefined)
    assert.equal(parseDay(''), undefined)
    assert.equal(parseDay('2026-10-12'), '2026-10-12')
    assert.equal(parseDay('2026-10-32'), null)
})

test('normalizeSeries заполняет пропущенные дни нулями и приводит числа', () => {
    const rows = [
        { day: new Date('2026-10-02T00:00:00.000Z'), registrations: '3', visitors: '1' },
        { day: '2026-10-04', registrations: 2, visitors: '7' }
    ]
    const points = normalizeSeries(rows, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], [
        'registrations',
        'visitors'
    ])

    assert.deepEqual(points, [
        { date: '2026-10-01', registrations: 0, visitors: 0 },
        { date: '2026-10-02', registrations: 3, visitors: 1 },
        { date: '2026-10-03', registrations: 0, visitors: 0 },
        { date: '2026-10-04', registrations: 2, visitors: 7 }
    ])
    assert.equal(sumSeries(points, 'registrations'), 5)
    assert.equal(sumSeries(points, 'visitors'), 8)
})

test('normalizeSeries устойчив к пустым данным', () => {
    assert.deepEqual(normalizeSeries(null, ['2026-10-01'], ['a']), [{ date: '2026-10-01', a: 0 }])
    assert.deepEqual(normalizeSeries([{ day: '2026-10-01', a: 'нет' }], ['2026-10-01'], ['a']), [
        { date: '2026-10-01', a: 0 }
    ])
})

test('normalizeSeries понимает соответствие «ключ ответа → колонка SQL»', () => {
    const rows = [{
        day: '2026-10-01',
        plants_added: '4',
        chat_messages: '9',
        active_users: '2'
    }]

    assert.deepEqual(normalizeSeries(rows, ['2026-10-01', '2026-10-02'], {
        plantsAdded: 'plants_added',
        chatMessages: 'chat_messages',
        activeUsers: 'active_users'
    }), [
        { date: '2026-10-01', plantsAdded: 4, chatMessages: 9, activeUsers: 2 },
        { date: '2026-10-02', plantsAdded: 0, chatMessages: 0, activeUsers: 0 }
    ])
})

test('deviceFromUserAgent различает телефоны, планшеты и компьютеры', () => {
    assert.equal(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile')
    assert.equal(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S901B) Mobile'), 'mobile')
    assert.equal(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet')
    assert.equal(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X200)'), 'tablet')
    assert.equal(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop')
    assert.equal(deviceFromUserAgent(undefined), 'unknown')
})

test('parseVisitorId принимает только безопасные идентификаторы', () => {
    assert.equal(parseVisitorId('2f1c9a54-3b4a-4a5b-8c3d-1234567890ab'), '2f1c9a54-3b4a-4a5b-8c3d-1234567890ab')
    assert.equal(parseVisitorId('  visitor-123456  '), 'visitor-123456')
    assert.equal(parseVisitorId('short'), null)
    assert.equal(parseVisitorId('плохой-id-12345'), null)
    assert.equal(parseVisitorId('x'.repeat(65)), null)
    assert.equal(parseVisitorId(undefined), null)
})

test('parseVisitPath пускает только относительные пути без пробелов', () => {
    assert.equal(parseVisitPath('/home'), '/home')
    assert.equal(parseVisitPath('/plants/monstera?tab=1'), '/plants/monstera?tab=1')
    assert.equal(parseVisitPath('https://checktheplants.ru/'), null)
    assert.equal(parseVisitPath('home'), null)
    assert.equal(parseVisitPath('/плохой путь'), null)
    assert.equal(parseVisitPath(`/${'x'.repeat(300)}`), null)
})

test('parseReferrerHost достаёт только http(s) хост', () => {
    assert.equal(parseReferrerHost('https://yandex.ru/search?text=plant'), 'yandex.ru')
    assert.equal(parseReferrerHost('http://vk.com'), 'vk.com')
    assert.equal(parseReferrerHost('javascript:alert(1)'), null)
    assert.equal(parseReferrerHost('не url'), null)
    assert.equal(parseReferrerHost(''), null)
})

test('parseSort и parseOrder работают по белому списку', () => {
    assert.equal(parseSort('plants', ['plants', 'email'], 'created_at'), 'plants')
    assert.equal(parseSort('password', ['plants', 'email'], 'created_at'), 'created_at')
    assert.equal(parseSort(undefined, ['plants'], 'id'), 'id')
    assert.equal(parseOrder('asc'), 'asc')
    assert.equal(parseOrder('ASC'), 'desc')
})

test('userCreatedAtSql использует колонку либо резервный источник', () => {
    assert.equal(userCreatedAtSql(true), 'u.created_at')
    assert.match(userCreatedAtSql(false), /user_legal_consents/)
})

test('валидаторы роли и уровня привилегий', () => {
    assert.equal(isValidRole('ADMIN'), true)
    assert.equal(isValidRole('admin'), false)
    assert.equal(isValidRole('SUPER'), false)
    assert.equal(isValidPrivilegeLevel('free'), true)
    assert.equal(isValidPrivilegeLevel('premium'), true)
    assert.equal(isValidPrivilegeLevel('gold'), false)
})

test('TIMEZONE зафиксирован на московском времени', () => {
    assert.equal(TIMEZONE, 'Europe/Moscow')
})
