import { api } from '../api.js'
import { badge, barMeter, card, emptyState, grid, h, loadInto, statCard, table } from '../ui.js'
import { donutChart, PALETTE } from '../charts.js'
import { formatDateTime, formatNumber, formatPercent, formatShortDay } from '../format.js'

const FUNNEL_STAGES = [
    { key: 'registered', label: 'Зарегистрировались' },
    { key: 'plantCreated', label: 'Добавили растение' },
    { key: 'wateringMarked', label: 'Отметили полив' },
    { key: 'pushSubscribed', label: 'Подписались на push' }
]

function numberOrZero(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function retentionCell(count, size) {
    const value = Number(count)
    if (!Number.isFinite(value)) return '—'
    const total = Number(size)
    const share = Number.isFinite(total) && total > 0 ? formatPercent(value, total) : '—'
    return `${formatNumber(value)} · ${share}`
}

function warnings(data) {
    const items = []

    if (!data.eventsTracked) {
        items.push('События начнут собираться после обновления сайта: текущая версия «Лейки» их ещё не отправляет. ' +
            'DAU/WAU/MAU, топ событий и удержание по событиям будут нулевыми — воронка по регистрациям, растениям и поливам работает и без трекера.')
    }
    if (!data.usersCreatedAtTracked) {
        items.push('У таблицы users нет колонки created_at: даты регистраций берутся из cookie-согласий, ' +
            'часть старых аккаунтов не попадёт в когорты. Примените миграцию ' +
            'Backend/migrations/20261027_add_users_created_at.sql.')
    }

    if (!items.length) return null

    return h('div', { class: 'notice notice-warn', role: 'status' }, items.map(text => h('p', { text })))
}

function activityCards(data) {
    const activity = data.activity || {}

    return grid(4, [
        statCard({
            label: 'DAU',
            value: formatNumber(activity.dau),
            hint: 'Активные за последние сутки',
            tone: 'accent'
        }),
        statCard({
            label: 'WAU',
            value: formatNumber(activity.wau),
            hint: 'Активные за 7 дней'
        }),
        statCard({
            label: 'MAU',
            value: formatNumber(activity.mau),
            hint: 'Активные за 30 дней'
        }),
        statCard({
            label: 'Активные за период',
            value: formatNumber(activity.activeUsers),
            hint: 'Пользователи с событиями в выбранном диапазоне'
        }),
        statCard({
            label: 'Новые пользователи',
            value: formatNumber(activity.newUsers),
            hint: `Регистрации за ${formatNumber(data.days)} дн.`
        }),
        statCard({
            label: 'События за период',
            value: formatNumber(activity.eventsInRange),
            hint: `Сегодня: ${formatNumber(activity.eventsToday)}`
        })
    ])
}

function funnelCard(data) {
    const funnel = data.funnel || {}
    const registered = numberOrZero(funnel.registered)
    const rows = FUNNEL_STAGES.map(stage => ({
        key: stage.key,
        label: stage.label,
        count: numberOrZero(funnel[stage.key])
    }))
    const max = Math.max(...rows.map(row => row.count), 1)

    return card('Воронка активации', 'Регистрация → первое растение → полив → push',
        table({
            columns: [
                { key: 'label', label: 'Этап' },
                {
                    key: 'count',
                    label: 'Пользователей',
                    align: 'right',
                    render: row => formatNumber(row.count)
                },
                {
                    key: 'share',
                    label: 'Доля от регистраций',
                    align: 'right',
                    render: row => formatPercent(row.count, registered)
                },
                {
                    key: 'meter',
                    label: '',
                    width: '160px',
                    render: row => barMeter(row.count, max)
                }
            ],
            rows,
            emptyText: 'Пока нет регистраций за период',
            label: 'Воронка активации'
        }))
}

function retentionCard(data) {
    const retention = Array.isArray(data.retention) ? data.retention : []

    return card('Удержание по когортам', 'D1 / D7 / D30 — сколько пользователей вернулось после регистрации',
        table({
            columns: [
                {
                    key: 'cohortLabel',
                    label: 'Когорта',
                    render: row => row.cohortLabel || formatShortDay(row.cohort)
                },
                {
                    key: 'size',
                    label: 'Пользователей',
                    align: 'right',
                    render: row => formatNumber(row.size)
                },
                {
                    key: 'd1',
                    label: 'D1',
                    align: 'right',
                    render: row => retentionCell(row.d1, row.size)
                },
                {
                    key: 'd7',
                    label: 'D7',
                    align: 'right',
                    render: row => retentionCell(row.d7, row.size)
                },
                {
                    key: 'd30',
                    label: 'D30',
                    align: 'right',
                    render: row => retentionCell(row.d30, row.size)
                }
            ],
            rows: retention,
            emptyText: 'Когорты появятся, когда накопится история регистраций',
            label: 'Удержание по когортам'
        }))
}

function eventsCard(data) {
    const events = Array.isArray(data.events) ? data.events.slice(0, 10) : []

    return card('Топ-10 событий', 'Самые частые действия пользователей за период',
        table({
            columns: [
                { key: 'event', label: 'Событие' },
                {
                    key: 'count',
                    label: 'Событий',
                    align: 'right',
                    render: row => formatNumber(row.count)
                },
                {
                    key: 'users',
                    label: 'Пользователей',
                    align: 'right',
                    render: row => formatNumber(row.users)
                }
            ],
            rows: events,
            emptyText: 'События пока не собираются — данные появятся после обновления сайта',
            label: 'Топ-10 событий'
        }))
}

function pushCard(data) {
    const push = data.push || {}
    const notifications = numberOrZero(push.notifications)
    const clicks = numberOrZero(push.clicks)
    const noClicks = Math.max(0, notifications - clicks)
    const ctr = formatPercent(clicks, notifications)

    const chart = notifications > 0
        ? donutChart({
            title: 'Клики по push-уведомлениям',
            items: [
                { label: 'Кликнули', value: clicks, color: PALETTE[0] },
                { label: 'Без клика', value: noClicks, color: PALETTE[3] }
            ],
            centerValue: ctr,
            centerLabel: 'CTR',
            table: {
                columns: [
                    { label: 'Показатель', value: row => row.label },
                    { label: 'Уведомлений', align: 'right', value: row => formatNumber(row.value) }
                ],
                rows: [
                    { label: 'Кликнули', value: clicks },
                    { label: 'Без клика', value: noClicks }
                ]
            }
        })
        : h('p', { class: 'muted', text: 'Push за период не отправлялись' })

    return card('Push-уведомления', 'Отправки и переходы из уведомлений',
        h('div', { class: 'stack' }, [
            grid(2, [
                statCard({
                    label: 'Push отправлено',
                    value: formatNumber(notifications),
                    hint: `Кликов сегодня: ${formatNumber(push.clickedToday)}`
                }),
                statCard({
                    label: 'Push CTR',
                    value: ctr,
                    hint: `${formatNumber(clicks)} кликов из ${formatNumber(notifications)}`,
                    tone: 'accent'
                })
            ]),
            chart
        ]))
}

function metricDisplay(item) {
    if (typeof item.display === 'string' && item.display.trim()) return item.display.trim()
    if (item.value === null || item.value === undefined) return '—'

    const value = Number(item.value)
    if (!Number.isFinite(value)) return '—'
    if (item.unit === 'seconds') return `${formatNumber(value)} с`
    if (item.unit === 'percent') return `${formatNumber(value)}%`
    if (item.unit === 'rub') return `${formatNumber(value)} ₽`
    return formatNumber(value)
}

function metricStatusBadge(item) {
    if (item.status === 'measured') {
        if (item.targetMet === true) return badge('в цели', 'success')
        if (item.targetMet === false) return badge('ниже цели', 'warning')
        return badge('измеряется')
    }
    if (item.status === 'partial') return badge('частично')
    return badge('нет данных')
}

function metricLabel(item) {
    const label = item.label || item.id || '—'
    const detail = typeof item.detail === 'string' ? item.detail.trim() : ''

    return h('div', {}, [
        h('div', { text: label }),
        detail ? h('div', { class: 'muted small', text: detail }) : null
    ])
}

function metricsCard(data) {
    const metrics = data.metrics || {}
    const summary = metrics.summary || {}
    const items = Array.isArray(metrics.items) ? metrics.items : []
    const total = Number.isFinite(Number(summary.total)) ? Number(summary.total) : items.length
    const measured = Number.isFinite(Number(summary.measured))
        ? Number(summary.measured)
        : items.filter(item => item.status === 'measured').length

    const body = items.length
        ? table({
            columns: [
                { key: 'label', label: 'Метрика', render: metricLabel },
                {
                    key: 'display',
                    label: 'Сейчас',
                    align: 'right',
                    render: metricDisplay
                },
                { key: 'target', label: 'Цель', align: 'right', render: row => row.target || '—' },
                { key: 'horizon', label: 'Горизонт', render: row => row.horizon || '—' },
                { key: 'status', label: 'Статус', render: metricStatusBadge }
            ],
            rows: items,
            emptyText: 'Метрики появятся после накопления событий',
            label: 'Метрики продукта'
        })
        : emptyState('Метрики появятся после накопления событий')

    const subtitle = items.length
        ? `${formatNumber(total)} метрик: текущее значение, цель и статус измерения · ` +
            `измеряется ${formatNumber(measured)} из ${formatNumber(total)}`
        : 'Текущее значение, цель и статус измерения'

    return card('Метрики продукта', subtitle, body)
}

function buildProductView(data) {
    return h('div', { class: 'stack' }, [
        warnings(data),
        activityCards(data),
        grid(2, [funnelCard(data), pushCard(data)]),
        metricsCard(data),
        retentionCard(data),
        eventsCard(data),
        h('p', {
            class: 'muted small',
            text: `Данные на ${formatDateTime(data.generatedAt)} · ${data.timezone || 'Europe/Moscow'} · ` +
                `период ${formatNumber(data.days)} дн.`
        })
    ])
}

export const productView = {
    id: 'product',
    title: 'Продукт',
    subtitle: 'DAU/WAU/MAU, активация, воронка, удержание и 12 метрик',
    needsRange: true,
    async render(root, ctx) {
        await loadInto(
            root,
            () => api.productAnalytics(ctx.days),
            data => buildProductView(data || {}),
            'Считаем продуктовую аналитику…'
        )
    }
}
