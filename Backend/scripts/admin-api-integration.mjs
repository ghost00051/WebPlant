import { writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:5099'
const ORIGIN = 'http://localhost:5173'
const ADMIN_ORIGIN = 'http://localhost:5599'
const STATE_FILE = process.env.TEST_STATE || path.join(os.tmpdir(), 'admin-test-state.json')

const STAMP = Date.now().toString(36)
const USER_A = `admin.a.${STAMP}@example.com`
const USER_B = `user.b.${STAMP}@example.com`
const USER_C = `user.c.${STAMP}@example.com`
const PASSWORD = 'TestPassword123!'

let failures = 0
let checks = 0

function check(name, condition, extra = '') {
    checks += 1
    if (condition) {
        console.log(`  ✔ ${name}`)
    } else {
        failures += 1
        console.log(`  ✖ ${name}${extra ? ` — ${extra}` : ''}`)
    }
}

function section(title) {
    console.log(`\n== ${title}`)
}

function jarFrom(setCookies, jar = {}) {
    for (const cookie of setCookies || []) {
        const [pair] = cookie.split(';')
        const index = pair.indexOf('=')
        const name = pair.slice(0, index)
        const value = pair.slice(index + 1)
        if (!value) delete jar[name]
        else jar[name] = value
    }
    return jar
}

function cookieHeader(jar) {
    return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ')
}

async function api(path, { method = 'GET', body, jar, origin = ORIGIN } = {}) {
    const headers = { Origin: origin, Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar)

    const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    const raw = await response.text()
    let data = null
    try {
        data = raw ? JSON.parse(raw) : null
    } catch {
        data = raw
    }
    return { status: response.status, data, setCookies: response.headers.getSetCookie() }
}

async function register(email) {
    return api('/api/users/registration', {
        method: 'POST',
        body: {
            email,
            password: PASSWORD,
            name: `Тест ${email.split('.')[1]}`,
            privacyPolicyAccepted: true,
            termsAccepted: true
        }
    })
}

async function login(email) {
    const jar = {}
    const response = await api('/api/users/login', {
        method: 'POST',
        body: { email, password: PASSWORD, rememberMe: true }
    })
    if (response.setCookies) jarFrom(response.setCookies, jar)
    return { jar, status: response.status, data: response.data }
}

async function seed() {
    section('Seed: регистрация пользователей')
    const a = await register(USER_A)
    check('регистрация админа-кандидата', a.status === 201, `status ${a.status} ${JSON.stringify(a.data)}`)
    const b = await register(USER_B)
    check('регистрация второго пользователя', b.status === 201, `status ${b.status} ${JSON.stringify(b.data)}`)
    const c = await register(USER_C)
    check('регистрация третьего пользователя', c.status === 201, `status ${c.status} ${JSON.stringify(c.data)}`)

    section('Seed: растения и поливы пользователя B')
    const { jar } = await login(USER_B)
    check('вход пользователя B', Object.keys(jar).length > 0)

    const plantIds = []
    for (const name of ['Монстера', 'Фикус', 'Сансевиерия']) {
        const created = await api('/api/plants', {
            method: 'POST',
            jar,
            body: {
                name,
                species: name,
                location: 'Подоконник',
                watering_interval_days: 7,
                watering_time_of_day: 'morning'
            }
        })
        if (created.status === 201 || created.status === 200) {
            plantIds.push(created.data?.id ?? created.data?.plant?.id)
        } else {
            console.log('  ! не удалось создать растение:', created.status, JSON.stringify(created.data))
        }
    }
    check('создано три растения', plantIds.length === 3, JSON.stringify(plantIds))

    let watered = 0
    for (const plantId of plantIds) {
        const response = await api(`/api/plants/${plantId}/water`, { method: 'POST', jar, body: {} })
        if (response.status === 200 || response.status === 201) watered += 1
        else console.log('  ! полив не удался:', response.status, JSON.stringify(response.data))
    }
    check('отмечены поливы', watered >= 1, `успешных: ${watered}`)

    section('Seed: маяк посещений')
    const visitors = [`visitor-${STAMP}-1`, `visitor-${STAMP}-2`, `visitor-${STAMP}-3`]
    for (const [index, visitorId] of visitors.entries()) {
        const first = await api('/api/system/visit', {
            method: 'POST',
            body: { visitorId, path: index === 0 ? '/' : '/home' }
        })
        check(`визит ${index + 1} принят`, first.status === 200 && first.data?.counted === true,
            `${first.status} ${JSON.stringify(first.data)}`)
    }
    const repeat = await api('/api/system/visit', {
        method: 'POST',
        jar,
        body: { visitorId: visitors[0], path: '/my-plants' }
    })
    check('повторный визит увеличивает просмотры', repeat.data?.views >= 2, JSON.stringify(repeat.data))

    const badVisit = await api('/api/system/visit', { method: 'POST', body: { visitorId: 'x', path: '/' } })
    check('мусорный визит отклоняется', badVisit.status === 400, `status ${badVisit.status}`)

    const state = {
        userA: USER_A,
        userB: USER_B,
        userC: USER_C,
        password: PASSWORD,
        plantIds: plantIds.filter(Boolean),
        visitors,
        stamp: STAMP
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
    console.log(`\nСостояние сохранено: ${STATE_FILE}`)
    console.log(`Пользователь A: ${USER_A}`)
    console.log(failures ? `\nSEED FAILURES: ${failures}/${checks}` : `\nSEED OK: ${checks} проверок`)
    process.exit(failures ? 1 : 0)
}

async function verify() {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    const admin = await login(state.userA)
    check('вход администратора', admin.status === 200, `status ${admin.status}`)
    const jar = admin.jar
    const me = await api('/api/users/me', { jar })
    check('роль ADMIN подтверждена', me.data?.role === 'ADMIN', JSON.stringify(me.data))

    section('Доступ')
    const anonymous = await api('/api/admin/users')
    check('без сессии — 401', anonymous.status === 401, `status ${anonymous.status}`)
    const outsiderJar = (await login(state.userC)).jar
    const forbidden = await api('/api/admin/users', { jar: outsiderJar })
    check('обычный пользователь — 403', forbidden.status === 403, `status ${forbidden.status}`)

    section('Права и валидация')
    const badDays = await api('/api/admin/analytics/overview?days=999', { jar })
    check('days=999 — 400', badDays.status === 400, `status ${badDays.status}`)
    const badPage = await api('/api/admin/users?page=0', { jar })
    check('page=0 — 400', badPage.status === 400, `status ${badPage.status}`)
    const badId = await api('/api/admin/plants/abc', { method: 'DELETE', jar })
    check('нечисловой id — 400', badId.status === 400, `status ${badId.status}`)
    const notFound = await api('/api/admin/plants/999999', { method: 'DELETE', jar })
    check('несуществующее растение — 404', notFound.status === 404, `status ${notFound.status}`)

    section('Аналитика: overview')
    const overview = await api('/api/admin/analytics/overview?days=30', { jar, origin: ADMIN_ORIGIN })
    check('overview отвечает 200', overview.status === 200, `status ${overview.status} ${JSON.stringify(overview.data)?.slice(0, 200)}`)
    const ov = overview.data || {}
    check('users.created_at учитывается', ov.userCreatedAtTracked === true, String(ov.userCreatedAtTracked))
    check('таблица посещений создана', ov.visitsTracked === true, String(ov.visitsTracked))
    check('пользователей >= 3', ov.users?.total >= 3, String(ov.users?.total))
    check('регистрации за 30 дней >= 3', ov.users?.new30d >= 3, String(ov.users?.new30d))
    check('растений >= 3', ov.plants?.total >= 3, String(ov.plants?.total))
    check('поливов >= 1', ov.waterings?.total >= 1, String(ov.waterings?.total))
    check('фото >= 1', ov.photos?.total >= 1, String(ov.photos?.total))
    check('сообщений чата >= 2', ov.chat?.messages >= 2, String(ov.chat?.messages))
    check('посетителей за период >= 3', ov.visits?.uniqueInRange >= 3, String(ov.visits?.uniqueInRange))
    check('просмотров за период >= 4', ov.visits?.viewsInRange >= 4, String(ov.visits?.viewsInRange))
    check('гостей с согласиями >= 1', ov.guests?.uniqueTotal >= 1, String(ov.guests?.uniqueTotal))
    check('push-подписок >= 1', ov.push?.subscriptions >= 1, String(ov.push?.subscriptions))
    check('уведомлений >= 1', ov.push?.notifications >= 1, String(ov.push?.notifications))
    check('cookie-согласия посчитаны', Array.isArray(ov.consents) && ov.consents.length >= 1)
    check('активных сессий >= 1', ov.sessions?.active >= 1, String(ov.sessions?.active))

    section('Аналитика: timeseries')
    const series = await api('/api/admin/analytics/timeseries?days=7', { jar })
    check('timeseries отвечает 200', series.status === 200, `status ${series.status}`)
    const points = series.data?.points || []
    check('ровно 7 дней', points.length === 7, String(points.length))
    const sum = key => points.reduce((total, point) => total + Number(point[key] || 0), 0)
    check('регистрации попали в ряд', sum('registrations') >= 3, String(sum('registrations')))
    check('растения попали в ряд', sum('plantsAdded') >= 3, String(sum('plantsAdded')))
    check('поливы попали в ряд', sum('waterings') >= 1, String(sum('waterings')))
    check('посетители попали в ряд', sum('visitors') >= 3, String(sum('visitors')))
    check('сообщения чата попали в ряд', sum('chatMessages') >= 2, String(sum('chatMessages')))
    check('дни идут по возрастанию', points.every((point, index) =>
        index === 0 || point.date > points[index - 1].date))

    section('Аналитика: breakdown')
    const breakdown = await api('/api/admin/analytics/breakdown?days=30', { jar })
    check('breakdown отвечает 200', breakdown.status === 200, `status ${breakdown.status}`)
    const bd = breakdown.data || {}
    check('топ видов не пуст', (bd.topSpecies || []).length >= 1, JSON.stringify(bd.topSpecies))
    check('топ по растениям не пуст', (bd.topUsersByPlants || []).length >= 1)
    check('поливы по дням недели посчитаны', (bd.wateringsByWeekday || []).length >= 1)
    check('поливы по часам посчитаны', (bd.wateringsByHour || []).length >= 1)
    check('средние значения посчитаны', bd.averages?.plantsPerUser > 0, JSON.stringify(bd.averages))
    check('последние регистрации не пусты', (bd.recentUsers || []).length >= 3)
    check('последняя регистрация с датой', Boolean(bd.recentUsers?.[0]?.createdAt))

    section('Аналитика: visits')
    const visits = await api('/api/admin/visits', { jar })
    check('visits отвечает 200', visits.status === 200, `status ${visits.status}`)
    check('уникальные посетители >= 3', visits.data?.totals?.uniqueVisitors >= 3,
        String(visits.data?.totals?.uniqueVisitors))
    check('просмотры >= 4', visits.data?.totals?.views >= 4, String(visits.data?.totals?.views))
    check('дни присутствуют', (visits.data?.days || []).length >= 1)
    check('устройства посчитаны', (visits.data?.devices || []).length >= 1)
    check('страницы входа посчитаны', (visits.data?.pages || []).length >= 1)

    section('Списки')
    const users = await api('/api/admin/users?sort=plants&order=desc&limit=10', { jar })
    check('users отвечает 200', users.status === 200, `status ${users.status}`)
    check('пользователей >= 3', users.data?.total >= 3, String(users.data?.total))
    check('первый по растениям — пользователь B', users.data?.items?.[0]?.plants >= 3,
        JSON.stringify(users.data?.items?.[0]))
    check('дата регистрации заполнена', Boolean(users.data?.items?.[0]?.createdAt))
    check('активность заполнена', Boolean(users.data?.items?.[0]?.lastActivityAt))

    const search = await api('/api/admin/users?search=user.b', { jar })
    check('поиск по email работает', search.data?.total === 1, String(search.data?.total))

    const userB = users.data.items.find(item => item.email === state.userB)
    const detail = await api(`/api/admin/users/${userB.id}`, { jar })
    check('карточка пользователя отвечает 200', detail.status === 200, `status ${detail.status}`)
    check('в карточке есть растения', (detail.data?.plants || []).length === 3,
        String((detail.data?.plants || []).length))
    check('в карточке есть поливы', (detail.data?.waterings || []).length >= 1)
    check('в карточке есть сессии', (detail.data?.sessions || []).length >= 1)
    check('в карточке есть согласия', (detail.data?.legalConsents || []).length >= 2)

    const plants = await api('/api/admin/plants?limit=50', { jar })
    check('plants отвечает 200', plants.status === 200, `status ${plants.status}`)
    check('растений >= 3', plants.data?.total >= 3, String(plants.data?.total))
    check('владелец в списке растений', Boolean(plants.data?.items?.[0]?.user?.email))
    const plantA = plants.data.items.find(item => item.user.email === state.userB)
    check('главное фото растения отдано', Boolean(plantA?.mainPhotoUrl), JSON.stringify(plantA?.mainPhotoUrl))

    const waterings = await api('/api/admin/waterings?action=watered&limit=50', { jar })
    check('waterings отвечает 200', waterings.status === 200, `status ${waterings.status}`)
    check('поливов >= 1', waterings.data?.total >= 1, String(waterings.data?.total))
    check('сводка по поливам', waterings.data?.summary?.watered >= 1, JSON.stringify(waterings.data?.summary))
    const watering = waterings.data.items[0]

    const photos = await api('/api/admin/photos?limit=50', { jar })
    check('photos отвечает 200', photos.status === 200, `status ${photos.status}`)
    check('фото >= 1', photos.data?.total >= 1, String(photos.data?.total))

    const chat = await api('/api/admin/chat?limit=50', { jar })
    check('chat отвечает 200', chat.status === 200, `status ${chat.status}`)
    check('сообщений >= 2', chat.data?.total >= 2, String(chat.data?.total))
    check('автор сообщения определён', Boolean(chat.data?.items?.[0]?.userEmail))
    const chatMessage = chat.data.items[0]

    section('Удаление записей')
    const deletedWatering = await api(`/api/admin/waterings/${watering.id}`, { method: 'DELETE', jar })
    check('удаление полива — 200', deletedWatering.status === 200,
        `${deletedWatering.status} ${JSON.stringify(deletedWatering.data)}`)
    check('расписание восстановлено', deletedWatering.data?.scheduleRestored === true,
        JSON.stringify(deletedWatering.data))
    const wateringAgain = await api(`/api/admin/waterings/${watering.id}`, { method: 'DELETE', jar })
    check('повторное удаление — 404', wateringAgain.status === 404, `status ${wateringAgain.status}`)

    const deletedPhoto = await api(`/api/admin/photos/${photos.data.items[0].id}`, { method: 'DELETE', jar })
    check('удаление фото — 200', deletedPhoto.status === 200, `status ${deletedPhoto.status}`)
    check('файл фото обработан', typeof deletedPhoto.data?.filesRemoved === 'number',
        JSON.stringify(deletedPhoto.data))

    const deletedChat = await api(`/api/admin/chat/${chatMessage.id}`, { method: 'DELETE', jar })
    check('удаление сообщения — 200', deletedChat.status === 200, `status ${deletedChat.status}`)

    const sessionId = chatMessage.sessionId
    const deletedSession = await api(`/api/admin/chat/session/${sessionId}`, { method: 'DELETE', jar })
    check('удаление переписки — 200', deletedSession.status === 200, `status ${deletedSession.status}`)
    const badSession = await api('/api/admin/chat/session/not-a-uuid', { method: 'DELETE', jar })
    check('некорректная сессия — 400', badSession.status === 400, `status ${badSession.status}`)

    const deletedPlant = await api(`/api/admin/plants/${plantA.id}`, { method: 'DELETE', jar })
    check('удаление растения — 200', deletedPlant.status === 200,
        `${deletedPlant.status} ${JSON.stringify(deletedPlant.data)}`)
    check('вместе с растением убраны поливы', deletedPlant.data?.removed?.waterings >= 1,
        JSON.stringify(deletedPlant.data?.removed))
    const plantGone = await api(`/api/admin/plants/${plantA.id}`, { method: 'DELETE', jar })
    check('растение исчезло — 404', plantGone.status === 404, `status ${plantGone.status}`)

    section('Защита администраторов')
    const adminId = me.data.id
    const selfDelete = await api(`/api/admin/users/${adminId}`, { method: 'DELETE', jar })
    check('нельзя удалить себя — 400', selfDelete.status === 400, `status ${selfDelete.status}`)
    const selfRole = await api(`/api/admin/users/${adminId}`, { method: 'PATCH', jar, body: { role: 'USER' } })
    check('нельзя снять свою роль — 400', selfRole.status === 400, `status ${selfRole.status}`)
    const badRole = await api(`/api/admin/users/${userB.id}`, { method: 'PATCH', jar, body: { role: 'SUPER' } })
    check('некорректная роль — 400', badRole.status === 400, `status ${badRole.status}`)
    const badPrivilege = await api(`/api/admin/users/${userB.id}`, {
        method: 'PATCH', jar, body: { privilegeLevel: 'gold' }
    })
    check('некорректный тариф — 400', badPrivilege.status === 400, `status ${badPrivilege.status}`)

    const promote = await api(`/api/admin/users/${userB.id}`, { method: 'PATCH', jar, body: { role: 'ADMIN' } })
    check('повышение до администратора', promote.status === 200 && promote.data?.user?.role === 'ADMIN',
        JSON.stringify(promote.data))
    const demote = await api(`/api/admin/users/${userB.id}`, { method: 'PATCH', jar, body: { role: 'USER' } })
    check('возврат роли пользователя', demote.status === 200 && demote.data?.user?.role === 'USER',
        JSON.stringify(demote.data))

    section('Удаление пользователя')
    const removed = await api(`/api/admin/users/${userB.id}`, { method: 'DELETE', jar })
    check('удаление пользователя — 200', removed.status === 200,
        `${removed.status} ${JSON.stringify(removed.data)}`)
    check('посчитаны растения', removed.data?.removed?.plants === 2,
        JSON.stringify(removed.data?.removed))
    check('посчитаны поливы', removed.data?.removed?.waterings >= 1, JSON.stringify(removed.data?.removed))
    check('посчитаны согласия', removed.data?.removed?.legalConsents >= 2, JSON.stringify(removed.data?.removed))
    check('посчитаны сессии', removed.data?.removed?.sessions >= 1, JSON.stringify(removed.data?.removed))
    const gone = await api(`/api/admin/users/${userB.id}`, { jar })
    check('пользователь исчез — 404', gone.status === 404, `status ${gone.status}`)

    const after = await api('/api/admin/analytics/overview?days=30', { jar })
    check('пользователей осталось 2', after.data?.users?.total === 2, String(after.data?.users?.total))
    check('растения пользователя удалены', (after.data?.plants?.total || 0) === 0,
        String(after.data?.plants?.total))

    console.log(`\n${failures ? '❌' : '✅'} Проверок: ${checks}, ошибок: ${failures}`)
    process.exit(failures ? 1 : 0)
}

const phase = process.argv[2]
if (phase === 'seed') await seed()
else if (phase === 'verify') await verify()
else {
    console.error('Укажите фазу: seed или verify')
    process.exit(2)
}
