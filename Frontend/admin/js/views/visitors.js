import { api } from '../api.js'
import { card, grid, h, loadInto, statCard, table } from '../ui.js'
import { donutChart, hBarChart, lineChart, PALETTE } from '../charts.js'
import { downloadCsv, formatDate, formatNumber, formatShortDay } from '../format.js'
import { DEVICE_LABELS } from '../config.js'

function explanation() {
    return h('div', { class: 'notice notice-info' }, [
        h('p', { text: 'Посещения считает собственный маяк сайта: он срабатывает при загрузке страницы ' +
            'и только если посетитель дал согласие на аналитику. IP не сохраняется — только случайный ' +
            'идентификатор браузера, путь входа, хост перехода и тип устройства.' }),
        h('p', { text: 'Один посетитель в сутки = одна строка. «Просмотры» — сколько страниц он открыл за день. ' +
            'Для сравнения с общей статистикой трафика используйте Яндекс.Метрику.' })
    ])
}

function dayRows(visits) {
    return visits.days.map(day => ({
        day: day.day,
        uniqueVisitors: day.uniqueVisitors,
        views: day.views,
        newVisitors: day.newVisitors,
        registeredVisitors: day.registeredVisitors
    }))
}

function utmCard(breakdown) {
    const sources = Array.isArray(breakdown?.utmSources) ? breakdown.utmSources : []
    if (!sources.length) return null

    return card('UTM-источники', 'Первое касание: source / medium / campaign',
        table({
            columns: [
                { key: 'source', label: 'Источник', render: row => row.source || '—' },
                { key: 'medium', label: 'Канал', render: row => row.medium || '—' },
                { key: 'campaign', label: 'Кампания', render: row => row.campaign || '—' },
                {
                    key: 'visitors',
                    label: 'Посетителей',
                    align: 'right',
                    render: row => formatNumber(row.visitors)
                }
            ],
            rows: sources,
            emptyText: 'UTM-метки ещё не встречались',
            label: 'UTM-источники'
        }))
}

export const visitorsView = {
    id: 'visitors',
    title: 'Посетители',
    subtitle: 'Уникальные визиты, просмотры, источники и устройства',
    needsRange: true,
    async render(root, ctx) {
        await loadInto(root, () => Promise.all([
            api.visits({ from: ctx.from, to: ctx.to }),
            api.breakdown(ctx.days).catch(error => {
                if (error?.status === 401) throw error
                return null
            })
        ]).then(([visits, breakdown]) => ({ visits, breakdown })),
            ({ visits, breakdown }) => {
                if (!visits.tracked) {
                    return h('div', { class: 'stack' }, [
                        h('div', { class: 'notice notice-warn' }, [
                            h('p', { text: 'Таблица site_visit_days не создана, поэтому раздел пуст. ' +
                                'Примените миграцию Backend/migrations/20261012_create_admin_analytics.sql ' +
                                'и перезапустите backend.' })
                        ]),
                        explanation()
                    ])
                }

                const totals = visits.totals
                const rows = dayRows(visits)

                return h('div', { class: 'stack' }, [
                    explanation(),
                    grid(4, [
                        statCard({
                            label: 'Уникальных посетителей',
                            value: formatNumber(totals.uniqueVisitors),
                            hint: `${formatDate(visits.from)} — ${formatDate(visits.to)}`,
                            tone: 'accent'
                        }),
                        statCard({
                            label: 'Просмотров страниц',
                            value: formatNumber(totals.views),
                            hint: totals.uniqueVisitors
                                ? `${(totals.views / totals.uniqueVisitors).toFixed(2)} на посетителя`
                                : '—'
                        }),
                        statCard({
                            label: 'Новых посетителей',
                            value: formatNumber(totals.newVisitors),
                            hint: 'Первый визит попал в период'
                        }),
                        statCard({
                            label: 'Авторизованных',
                            value: formatNumber(totals.registeredVisitors),
                            hint: 'Визиты с активной сессией'
                        })
                    ]),

                    card('Динамика посещений', 'Уникальные посетители и просмотры по дням',
                        lineChart({
                            height: 260,
                            width: ctx.contentWidth,
                            title: 'Динамика посещений по дням',
                            table: {
                                columns: [
                                    { label: 'День', value: row => formatDate(row.day) },
                                    { label: 'Посетители', align: 'right', value: row => formatNumber(row.uniqueVisitors) },
                                    { label: 'Просмотры', align: 'right', value: row => formatNumber(row.views) },
                                    { label: 'Новые', align: 'right', value: row => formatNumber(row.newVisitors) }
                                ],
                                rows
                            },
                            formatX: formatShortDay,
                            formatValue: formatNumber,
                            series: [
                                {
                                    name: 'Посетители',
                                    color: PALETTE[0],
                                    points: rows.map(row => ({ x: row.day, y: row.uniqueVisitors }))
                                },
                                {
                                    name: 'Просмотры',
                                    color: PALETTE[1],
                                    points: rows.map(row => ({ x: row.day, y: row.views }))
                                },
                                {
                                    name: 'Новые',
                                    color: PALETTE[2],
                                    points: rows.map(row => ({ x: row.day, y: row.newVisitors }))
                                }
                            ]
                        })),

                    grid(2, [
                        card('Устройства', 'Тип устройства посетителей',
                            donutChart({
                                title: 'Устройства посетителей',
                                table: {
                                    columns: [
                                        { label: 'Устройство', value: row => row.label },
                                        { label: 'Посетителей', align: 'right', value: row => formatNumber(row.value) }
                                    ],
                                    rows: visits.devices.map(item => ({
                                        label: DEVICE_LABELS[item.device] || item.device,
                                        value: item.visitors
                                    }))
                                },
                                items: visits.devices.map(item => ({
                                    label: DEVICE_LABELS[item.device] || item.device,
                                    value: item.visitors
                                })),
                                centerValue: formatNumber(totals.uniqueVisitors),
                                centerLabel: 'посетителей'
                            })),
                        card('Источники переходов', 'Откуда пришли посетители',
                            hBarChart({
                                items: visits.referrers.map(item => ({
                                    label: item.host,
                                    value: item.visitors
                                })),
                                formatValue: formatNumber
                            }))
                    ]),

                    utmCard(breakdown),

                    card('Страницы входа', 'Первая страница посетителя за день',
                        hBarChart({
                            items: visits.pages.map(item => ({ label: item.path, value: item.views })),
                            formatValue: formatNumber
                        })),

                    card('По дням', 'Полная таблица с выгрузкой в CSV',
                        table({
                            columns: [
                                { key: 'day', label: 'День', render: row => formatDate(row.day) },
                                { key: 'uniqueVisitors', label: 'Посетители', align: 'right' },
                                { key: 'views', label: 'Просмотры', align: 'right' },
                                { key: 'newVisitors', label: 'Новые', align: 'right' },
                                { key: 'registeredVisitors', label: 'Авторизованные', align: 'right' }
                            ],
                            rows: [...rows].reverse(),
                            emptyText: 'За выбранный период посещений нет',
                            label: 'Посещения по дням'
                        }),
                        h('button', {
                            class: 'btn btn-secondary',
                            type: 'button',
                            text: 'Выгрузить CSV',
                            onClick: () => downloadCsv(
                                `visits-${visits.from}-${visits.to}.csv`,
                                [
                                    { key: 'day', label: 'День' },
                                    { key: 'uniqueVisitors', label: 'Посетители' },
                                    { key: 'views', label: 'Просмотры' },
                                    { key: 'newVisitors', label: 'Новые' },
                                    { key: 'registeredVisitors', label: 'Авторизованные' }
                                ],
                                rows
                            )
                        }))
                ])
            },
            'Считаем посещения…')
    }
}
