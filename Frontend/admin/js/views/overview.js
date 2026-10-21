import { api } from '../api.js'
import { card, grid, h, loadInto, statCard, table, badge } from '../ui.js'
import { barChart, donutChart, gridChartWidth, hBarChart, lineChart, PALETTE } from '../charts.js'
import { formatDateTime, formatNumber, formatPercent, formatShortDay, maskEmail } from '../format.js'
import { DEVICE_LABELS, WEEKDAYS } from '../config.js'

function warnings(overview, visits) {
    const items = []

    if (!overview.userCreatedAtTracked) {
        items.push('Таблица users без колонки created_at: даты регистраций берутся из согласий, ' +
            'часть старых аккаунтов не попадёт в динамику. Примените миграцию ' +
            'Backend/migrations/20261012_create_admin_analytics.sql.')
    }
    if (!overview.visitsTracked) {
        items.push('Таблица site_visit_days не создана: раздел посещений показывает нули. ' +
            'Примените миграцию Backend/migrations/20261012_create_admin_analytics.sql.')
    } else if (visits && visits.tracked && !visits.totals.uniqueVisitors &&
        !overview.visits.uniqueTotal) {
        items.push('Маяк посещений ещё не получал данные. Он начинает считать визиты после ' +
            'обновления основного сайта (раздел «Посетители» просит согласие на аналитику). ' +
            'Пока аудиторию смотрите в Яндекс.Метрике.')
    }

    if (!items.length) return null

    return h('div', { class: 'notice' }, items.map(text => h('p', { text })))
}

function kpiCards(overview) {
    const { users, plants, waterings, chat, photos, visits, guests, sessions, push } = overview
    const conversion = guests.uniqueInRange
        ? formatPercent(users.newInRange, guests.uniqueInRange)
        : '—'

    return grid(4, [
        statCard({
            label: 'Посетителей за период',
            value: formatNumber(visits.uniqueInRange),
            hint: `${formatNumber(visits.viewsInRange)} просмотров, новых ${formatNumber(visits.newInRange)}`,
            tone: 'accent'
        }),
        statCard({
            label: 'Посетителей сегодня',
            value: formatNumber(visits.uniqueToday),
            hint: `${formatNumber(visits.viewsToday)} просмотров`
        }),
        statCard({
            label: 'Пользователей всего',
            value: formatNumber(users.total),
            hint: `+${formatNumber(users.newInRange)} за период, +${formatNumber(users.new7d)} за 7 дней`
        }),
        statCard({
            label: 'Регистраций сегодня',
            value: formatNumber(users.newToday),
            hint: `Админов: ${formatNumber(users.admins)}`
        }),
        statCard({
            label: 'Растений всего',
            value: formatNumber(plants.total),
            hint: `${formatNumber(plants.active)} активных, +${formatNumber(plants.newInRange)} за период`
        }),
        statCard({
            label: 'Поливов за период',
            value: formatNumber(waterings.inRange),
            hint: `Всего ${formatNumber(waterings.total)}, пропусков ${formatNumber(waterings.skipped)}`
        }),
        statCard({
            label: 'Сообщений чату',
            value: formatNumber(chat.inRange),
            hint: `Всего ${formatNumber(chat.messages)}, сессий ${formatNumber(chat.sessions)}`
        }),
        statCard({
            label: 'Фотографий',
            value: formatNumber(photos.total),
            hint: `+${formatNumber(photos.inRange)} за период`
        }),
        statCard({
            label: 'Гостей с активностью',
            value: formatNumber(guests.uniqueInRange),
            hint: `Всего ${formatNumber(guests.uniqueTotal)}`
        }),
        statCard({
            label: 'Конверсия гостей',
            value: conversion,
            hint: 'Регистрации за период / гости за период'
        }),
        statCard({
            label: 'Push-подписки',
            value: formatNumber(push.subscriptions),
            hint: `У пользователей ${formatNumber(push.usersWithPush)}`
        }),
        statCard({
            label: 'Активных сессий',
            value: formatNumber(sessions.active),
            hint: `Создано за период ${formatNumber(sessions.createdInRange)}`
        })
    ])
}

function dynamics(overview, timeseries, contentWidth) {
    const points = timeseries.points || []
    const chartWidth = gridChartWidth(contentWidth)

    const audience = lineChart({
        height: 250,
        width: chartWidth,
        title: 'Аудитория: посетители, просмотры и активные пользователи по дням',
        table: {
            columns: [
                { label: 'Дата', value: point => formatShortDay(point.date) },
                { label: 'Посетители', align: 'right', value: point => formatNumber(point.visitors) },
                { label: 'Просмотры', align: 'right', value: point => formatNumber(point.views) },
                { label: 'Активные', align: 'right', value: point => formatNumber(point.activeUsers) }
            ],
            rows: points
        },
        formatX: formatShortDay,
        formatValue: formatNumber,
        series: [
            { name: 'Посетители', color: PALETTE[0], points: points.map(p => ({ x: p.date, y: p.visitors })) },
            { name: 'Просмотры', color: PALETTE[1], points: points.map(p => ({ x: p.date, y: p.views })) },
            { name: 'Активные пользователи', color: PALETTE[2], points: points.map(p => ({ x: p.date, y: p.activeUsers })) }
        ]
    })

    const created = lineChart({
        height: 250,
        width: chartWidth,
        title: 'Что создавали: регистрации, растения, поливы и сообщения по дням',
        table: {
            columns: [
                { label: 'Дата', value: point => formatShortDay(point.date) },
                { label: 'Регистрации', align: 'right', value: point => formatNumber(point.registrations) },
                { label: 'Растения', align: 'right', value: point => formatNumber(point.plantsAdded) },
                { label: 'Поливы', align: 'right', value: point => formatNumber(point.waterings) },
                { label: 'Сообщения', align: 'right', value: point => formatNumber(point.chatMessages) }
            ],
            rows: points
        },
        formatX: formatShortDay,
        formatValue: formatNumber,
        series: [
            { name: 'Регистрации', color: PALETTE[1], points: points.map(p => ({ x: p.date, y: p.registrations })) },
            { name: 'Новые растения', color: PALETTE[0], points: points.map(p => ({ x: p.date, y: p.plantsAdded })) },
            { name: 'Поливы', color: PALETTE[5], points: points.map(p => ({ x: p.date, y: p.waterings })) },
            { name: 'Сообщения чата', color: PALETTE[3], points: points.map(p => ({ x: p.date, y: p.chatMessages })) }
        ]
    })

    return grid(2, [
        card('Аудитория', `Уникальные посетители, просмотры и активные пользователи за ${overview.days} дн.`, audience),
        card('Что создавали', 'Регистрации, растения, поливы и сообщения по дням', created)
    ])
}

function weekdayHours(breakdown, contentWidth) {
    const chartWidth = gridChartWidth(contentWidth)
    const byWeekday = WEEKDAYS.map((label, index) => ({
        label,
        value: (breakdown.wateringsByWeekday.find(item => item.weekday === index + 1) || {}).count || 0
    }))

    const byHour = Array.from({ length: 24 }, (_, hour) => ({
        label: String(hour).padStart(2, '0'),
        value: (breakdown.wateringsByHour.find(item => item.hour === hour) || {}).count || 0
    }))

    return grid(2, [
        card('Поливы по дням недели', 'Когда чаще всего поливают (московское время)',
            barChart({
                title: 'Поливы по дням недели',
                width: chartWidth,
                items: byWeekday,
                formatValue: formatNumber,
                table: {
                    columns: [
                        { label: 'День', value: row => row.label },
                        { label: 'Поливов', align: 'right', value: row => formatNumber(row.value) }
                    ],
                    rows: byWeekday
                }
            })),
        card('Поливы по часам', 'Распределение отметок о поливе по часам суток',
            barChart({
                title: 'Поливы по часам суток',
                width: chartWidth,
                items: byHour,
                color: PALETTE[5],
                formatValue: formatNumber,
                table: {
                    columns: [
                        { label: 'Час', value: row => row.label },
                        { label: 'Поливов', align: 'right', value: row => formatNumber(row.value) }
                    ],
                    rows: byHour
                }
            }))
    ])
}

function breakdownCards(breakdown, visits) {
    const species = breakdown.topSpecies.map(item => ({
        label: item.species,
        value: item.count
    }))

    const topPlants = breakdown.topUsersByPlants.map(item => ({
        label: item.name || item.username || item.email,
        value: item.plants,
        hint: item.email
    }))

    const topWaterings = breakdown.topUsersByWaterings.map(item => ({
        label: item.name || item.username || item.email,
        value: item.waterings,
        hint: item.email
    }))

    const devices = (visits?.devices || []).map(item => ({
        label: DEVICE_LABELS[item.device] || item.device,
        value: item.visitors
    }))

    const consents = breakdown.consentTypes.map((item, index) => ({
        label: item.type,
        value: item.total,
        color: PALETTE[index % PALETTE.length]
    }))

    return grid(2, [
        card('Виды растений', 'Все коллекции пользователей',
            hBarChart({ items: species, formatValue: formatNumber })),
        card('Устройства посетителей', 'По данным маяка посещений за период',
            devices.length ? donutChart({
                title: 'Устройства посетителей',
                items: devices,
                centerValue: formatNumber(devices.reduce((sum, item) => sum + item.value, 0)),
                centerLabel: 'визитов',
                table: {
                    columns: [
                        { label: 'Устройство', value: row => row.label },
                        { label: 'Посетителей', align: 'right', value: row => formatNumber(row.value) }
                    ],
                    rows: devices
                }
            }) : h('p', { class: 'muted', text: 'Нет данных о посещениях' })),
        card('Топ по растениям', 'Кто добавил больше всего растений',
            hBarChart({ items: topPlants, formatValue: formatNumber })),
        card('Топ по поливам', 'Самые дисциплинированные за период',
            hBarChart({ items: topWaterings, formatValue: formatNumber, max: undefined })),
        card('Cookie-согласия', 'Всего записей по типам согласий',
            hBarChart({ items: consents, formatValue: formatNumber })),
        card('Средние значения', 'На одного пользователя', h('div', { class: 'facts' }, [
            h('p', {}, [h('span', { class: 'fact-label', text: 'Растений на пользователя' }),
                h('span', { class: 'fact-value', text: formatNumber(breakdown.averages?.plantsPerUser ?? 0) })]),
            h('p', {}, [h('span', { class: 'fact-label', text: 'Поливов на пользователя' }),
                h('span', { class: 'fact-value', text: formatNumber(breakdown.averages?.wateringsPerUser ?? 0) })]),
            h('p', {}, [h('span', { class: 'fact-label', text: 'Сообщений на пользователя' }),
                h('span', { class: 'fact-value', text: formatNumber(breakdown.averages?.messagesPerUser ?? 0) })]),
            h('p', {}, [h('span', { class: 'fact-label', text: 'Фото на растение' }),
                h('span', { class: 'fact-value', text: formatNumber(breakdown.averages?.photosPerPlant ?? 0) })])
        ]))
    ])
}

function recentUsers(breakdown) {
    return card('Последние регистрации', `Новые пользователи (${breakdown.days} дн.)`,
        table({
            columns: [
                { key: 'id', label: 'ID', align: 'right' },
                { key: 'email', label: 'Email', render: row => maskEmail(row.email) },
                {
                    key: 'name',
                    label: 'Имя',
                    render: row => row.name || row.username || '—'
                },
                {
                    key: 'role',
                    label: 'Роль',
                    render: row => badge(row.role === 'ADMIN' ? 'админ' : 'пользователь',
                        row.role === 'ADMIN' ? 'warning' : 'neutral')
                },
                {
                    key: 'createdAt',
                    label: 'Дата регистрации',
                    render: row => formatDateTime(row.createdAt)
                }
            ],
            rows: breakdown.recentUsers,
            emptyText: 'Регистраций пока нет',
            label: 'Последние регистрации'
        }))
}

export const overviewView = {
    id: 'overview',
    title: 'Обзор',
    subtitle: 'Главные показатели «Лейки»',
    needsRange: true,
    async render(root, ctx) {
        await loadInto(root, () => Promise.all([
            api.overview(ctx.days),
            api.timeseries(ctx.days),
            api.breakdown(ctx.days),
            api.visits({ from: ctx.from, to: ctx.to })
        ]).then(([overview, timeseries, breakdown, visits]) => ({ overview, timeseries, breakdown, visits })),
        ({ overview, timeseries, breakdown, visits }) => h('div', { class: 'stack' }, [
            warnings(overview, visits),
            kpiCards(overview),
            dynamics(overview, timeseries, ctx.contentWidth),
            weekdayHours(breakdown, ctx.contentWidth),
            breakdownCards(breakdown, visits),
            recentUsers(breakdown),
            h('p', {
                class: 'muted small',
                text: `Данные на ${formatDateTime(overview.generatedAt)} · ${overview.timezone}`
            })
        ]), 'Считаем аналитику…')
    }
}
