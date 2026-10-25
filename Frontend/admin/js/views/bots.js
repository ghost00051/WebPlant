import { api, isCanceled } from '../api.js'
import { badge, barMeter, card, clear, errorState, grid, h, spinner, statCard, table } from '../ui.js'
import { gridChartWidth, lineChart, PALETTE } from '../charts.js'
import { formatDateTime, formatNumber, formatPercent, formatShortDay, truncate } from '../format.js'

const CHANNELS = [
    { key: 'telegram', title: 'Telegram' },
    { key: 'max', title: 'MAX' }
]

const KIND_LABELS = {
    reminder: 'напоминание',
    summary: 'утренняя сводка',
    weekly_recap: 'итоги недели',
    notification: 'уведомление'
}

function numberOrZero(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function formatRate(value) {
    if (value === null || value === undefined || value === '') return '—'
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return '—'
    const percent = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed
    return `${formatNumber(percent)}%`
}

function channelOf(data, key) {
    const channels = data.channels && typeof data.channels === 'object' ? data.channels : {}
    const channel = channels[key]
    return channel && typeof channel === 'object' ? channel : {}
}

function channelTitle(key) {
    const found = CHANNELS.find(channel => channel.key === key)
    return found ? found.title : String(key || 'канал')
}

function channelBadge(key) {
    return badge(channelTitle(key), key === 'telegram' ? 'success' : 'neutral')
}

function factRow(label, value) {
    return h('p', {}, [
        h('span', { class: 'fact-label', text: label }),
        h('span', { class: 'fact-value' }, value)
    ])
}

function warnings(data) {
    const items = []

    if (data.tablesReady === false) {
        items.push('Таблицы ботов ещё не созданы — миграции ботов не применены, поэтому все показатели нулевые. ' +
            'Примените Backend/migrations/20261101_create_bot_channels.sql и ' +
            'Backend/migrations/20261102_add_weekly_recap.sql и обновите страницу.')
    }

    const telegram = channelOf(data, 'telegram')
    const max = channelOf(data, 'max')
    if (data.tablesReady !== false && !telegram.configured && !max.configured) {
        items.push('Ни один бот не настроен: задайте TELEGRAM_BOT_TOKEN и MAX_BOT_TOKEN в Backend/.env ' +
            'и включите BOTS_ENABLED. Пока каналы не подключены, доставка идёт только через push и e-mail.')
    }

    if (!items.length) return null

    return h('div', { class: 'notice notice-warn', role: 'status' }, items.map(text => h('p', { text })))
}

function kpiCards(data) {
    const totals = data.totals || {}
    const telegram = channelOf(data, 'telegram')
    const max = channelOf(data, 'max')
    const funnel = data.linkFunnel || {}
    const recap = data.recap || {}
    const streak = data.streak || {}

    return grid(4, [
        statCard({
            label: 'Подключено аккаунтов',
            value: formatNumber(totals.linkedActive),
            hint: `Telegram: ${formatNumber(telegram.linkedActive)} · MAX: ${formatNumber(max.linkedActive)}`,
            tone: 'accent'
        }),
        statCard({
            label: 'Новые подключения',
            value: formatNumber(totals.linkedNew),
            hint: `За ${formatNumber(data.days)} дн. по обоим каналам`
        }),
        statCard({
            label: 'Конверсия link-кодов',
            value: formatRate(funnel.conversion),
            hint: `Создано ${formatNumber(funnel.codesCreated)} · использовано ${formatNumber(funnel.codesUsed)}`
        }),
        statCard({
            label: 'Доставлено сообщений',
            value: formatNumber(totals.messagesSent),
            hint: `Ошибок ${formatNumber(totals.messagesFailed)} · доставка ${formatRate(totals.deliveryRate)}`
        }),
        statCard({
            label: 'Доля напоминаний в мессенджерах',
            value: formatRate(totals.reminderShare),
            hint: 'F16: напоминания, доставленные в Telegram и MAX',
            tone: 'accent'
        }),
        statCard({
            label: 'Recap-доставки',
            value: formatNumber(recap.delivered),
            hint: `Создано ${formatNumber(recap.notificationsCreated)} · ошибок ${formatNumber(recap.failed)} · ` +
                `получателей ${formatNumber(recap.users)}`
        }),
        statCard({
            label: 'Пользователей с серией',
            value: formatNumber(streak.usersWithStreak),
            hint: `Средняя серия ${formatNumber(streak.avgCurrentStreak)} · лучшая ${formatNumber(streak.bestCurrentStreak)}`
        }),
        statCard({
            label: 'Средняя серия ухода',
            value: formatNumber(streak.avgCurrentStreak),
            hint: `F10: лучшая текущая серия — ${formatNumber(streak.bestCurrentStreak)}`
        })
    ])
}

function deliveryDynamics(data, contentWidth) {
    const points = Array.isArray(data.series) ? data.series : []
    const width = gridChartWidth(contentWidth)

    const sent = lineChart({
        height: 250,
        width,
        title: 'Доставлено сообщений по каналам',
        formatX: formatShortDay,
        formatValue: formatNumber,
        series: [
            {
                name: 'Telegram',
                color: PALETTE[1],
                points: points.map(point => ({ x: point.day, y: point.telegramSent }))
            },
            {
                name: 'MAX',
                color: PALETTE[0],
                points: points.map(point => ({ x: point.day, y: point.maxSent }))
            }
        ],
        table: {
            columns: [
                { label: 'Дата', value: point => formatShortDay(point.day) },
                { label: 'Telegram', align: 'right', value: point => formatNumber(point.telegramSent) },
                { label: 'MAX', align: 'right', value: point => formatNumber(point.maxSent) }
            ],
            rows: points
        }
    })

    const failed = lineChart({
        height: 250,
        width,
        title: 'Ошибки доставки по каналам',
        formatX: formatShortDay,
        formatValue: formatNumber,
        series: [
            {
                name: 'Telegram',
                color: PALETTE[3],
                points: points.map(point => ({ x: point.day, y: point.telegramFailed }))
            },
            {
                name: 'MAX',
                color: PALETTE[2],
                points: points.map(point => ({ x: point.day, y: point.maxFailed }))
            }
        ],
        table: {
            columns: [
                { label: 'Дата', value: point => formatShortDay(point.day) },
                { label: 'Telegram', align: 'right', value: point => formatNumber(point.telegramFailed) },
                { label: 'MAX', align: 'right', value: point => formatNumber(point.maxFailed) }
            ],
            rows: points
        }
    })

    return grid(2, [
        card('Доставка по дням', `Отправленные сообщения Telegram и MAX за ${formatNumber(data.days)} дн.`, sent),
        card('Ошибки по дням', 'Неудачные доставки и ответы API по каналам', failed)
    ])
}

function channelsCard(data) {
    const rows = CHANNELS.map(channel => ({ key: channel.key, title: channel.title, ...channelOf(data, channel.key) }))

    return card('Каналы', 'Настройка ботов, привязки и последние доставки',
        table({
            columns: [
                {
                    key: 'title',
                    label: 'Канал',
                    render: row => h('div', { class: 'cell-main' }, [
                        h('span', { class: 'cell-title', text: channelTitle(row.key) }),
                        h('span', {
                            class: 'cell-sub',
                            text: row.configured ? 'настроен' : 'не настроен'
                        })
                    ])
                },
                {
                    key: 'botUsername',
                    label: 'Бот',
                    render: row => row.botUsername ? `@${String(row.botUsername).replace(/^@/, '')}` : '—'
                },
                {
                    key: 'linkedActive',
                    label: 'Активных привязок',
                    align: 'right',
                    render: row => h('div', { class: 'cell-main' }, [
                        h('span', { class: 'cell-title', text: formatNumber(row.linkedActive) }),
                        h('span', { class: 'cell-sub', text: `всего ${formatNumber(row.linkedTotal)}` })
                    ])
                },
                {
                    key: 'linkedInRange',
                    label: 'Новых за период',
                    align: 'right',
                    render: row => h('div', { class: 'cell-main' }, [
                        h('span', { class: 'cell-title', text: formatNumber(row.linkedInRange) }),
                        h('span', { class: 'cell-sub', text: `отвязались ${formatNumber(row.unlinkedInRange)}` })
                    ])
                },
                {
                    key: 'deliveryRate',
                    label: 'Доставка',
                    align: 'right',
                    render: row => formatRate(row.deliveryRate)
                },
                {
                    key: 'notificationsDisabled',
                    label: 'Уведомления',
                    render: row => Number(row.notificationsDisabled) > 0
                        ? badge(`выключены: ${formatNumber(row.notificationsDisabled)}`, 'warning')
                        : badge('включены', 'success')
                },
                {
                    key: 'lastSentAt',
                    label: 'Последняя отправка',
                    render: row => row.lastSentAt ? formatDateTime(row.lastSentAt) : '—'
                },
                {
                    key: 'lastError',
                    label: 'Последняя ошибка',
                    render: row => row.lastError
                        ? h('span', { class: 'cell-text', title: String(row.lastError), text: truncate(row.lastError, 80) })
                        : '—'
                }
            ],
            rows,
            emptyText: 'Каналы ещё не настроены',
            label: 'Каналы ботов'
        }))
}

function funnelCard(data) {
    const funnel = data.linkFunnel || {}
    const created = numberOrZero(funnel.codesCreated)
    const used = numberOrZero(funnel.codesUsed)
    const conversion = funnel.conversion === null || funnel.conversion === undefined
        ? formatPercent(used, created)
        : formatRate(funnel.conversion)

    return card('Воронка link-кодов', 'Одноразовый код в боте → привязанный аккаунт',
        h('div', { class: 'funnel' }, [
            h('div', { class: 'funnel-head' }, [
                h('span', { class: 'fact-label', text: 'Конверсия кодов' }),
                h('span', { class: 'funnel-rate', text: conversion })
            ]),
            h('div', { class: 'facts' }, [
                factRow('Кодов создано', formatNumber(created)),
                factRow('Кодов использовано', formatNumber(used)),
                factRow('Осталось неиспользованных', formatNumber(Math.max(0, created - used)))
            ]),
            barMeter(used, created),
            h('p', {
                class: 'muted small',
                text: 'Код живёт 15 минут: если пользователь не успел открыть бота, создайте новый.'
            })
        ]))
}

function errorsCard(data) {
    const errors = Array.isArray(data.recentErrors) ? data.recentErrors : []

    return card('Последние ошибки', 'Что помешало доставке сообщений',
        table({
            columns: [
                { key: 'channel', label: 'Канал', render: row => channelBadge(row.channel) },
                {
                    key: 'kind',
                    label: 'Тип',
                    render: row => KIND_LABELS[row.kind] || row.kind || '—'
                },
                {
                    key: 'error',
                    label: 'Ошибка',
                    render: row => h('span', {
                        class: 'cell-text',
                        title: String(row.error || ''),
                        text: truncate(row.error || 'Без текста ошибки', 140)
                    })
                },
                { key: 'createdAt', label: 'Когда', render: row => formatDateTime(row.createdAt) }
            ],
            rows: errors,
            emptyText: 'Ошибок доставки не было',
            label: 'Последние ошибки доставки'
        }))
}

function commandsCard(data) {
    const commands = Array.isArray(data.commands) ? data.commands : []

    return card('Команды ботов', 'Что пользователи чаще всего пишут ботам',
        table({
            columns: [
                { key: 'channel', label: 'Канал', render: row => channelBadge(row.channel) },
                {
                    key: 'command',
                    label: 'Команда',
                    render: row => {
                        const command = String(row.command || '—')
                        return command.startsWith('/') ? command : `/${command}`
                    }
                },
                {
                    key: 'count',
                    label: 'Сообщений',
                    align: 'right',
                    render: row => formatNumber(row.count)
                }
            ],
            rows: commands,
            emptyText: 'Команды пока не приходили',
            label: 'Команды ботов'
        }))
}

function recapStreakCards(data) {
    const recap = data.recap || {}
    const streak = data.streak || {}

    return grid(2, [
        card('Weekly recap', 'F10: итоги недели в push, ботах и e-mail',
            h('div', { class: 'facts' }, [
                factRow('Уведомлений создано', formatNumber(recap.notificationsCreated)),
                factRow('Доставлено', formatNumber(recap.delivered)),
                factRow('Ошибок', formatNumber(recap.failed)),
                factRow('Получателей', formatNumber(recap.users)),
                factRow('Через Telegram', formatNumber(recap.telegram)),
                factRow('Через MAX', formatNumber(recap.max))
            ])),
        card('Серия ухода', 'F10: поливы вовремя и личный рекорд',
            h('div', { class: 'facts' }, [
                factRow('Пользователей с серией', formatNumber(streak.usersWithStreak)),
                factRow('Средняя текущая серия', formatNumber(streak.avgCurrentStreak)),
                factRow('Лучшая текущая серия', formatNumber(streak.bestCurrentStreak))
            ]))
    ])
}

function buildBotsView(data, contentWidth) {
    return h('div', { class: 'stack' }, [
        warnings(data),
        kpiCards(data),
        deliveryDynamics(data, contentWidth),
        channelsCard(data),
        grid(2, [funnelCard(data), errorsCard(data)]),
        commandsCard(data),
        recapStreakCards(data),
        h('p', {
            class: 'muted small',
            text: `Данные на ${formatDateTime(data.generatedAt)} · ${data.timezone || 'Europe/Moscow'} · ` +
                `период ${formatNumber(data.days)} дн.`
        })
    ])
}

export const botsView = {
    id: 'bots',
    title: 'Боты',
    subtitle: 'Telegram и MAX: подключения, доставки, ошибки, recap и серия',
    needsRange: true,
    async render(root, ctx) {
        clear(root)
        root.appendChild(spinner('Собираем метрики ботов…'))

        let data
        try {
            data = await api.botAnalytics(ctx.days)
        } catch (error) {
            if (error?.status === 401 || isCanceled(error)) throw error
            clear(root)
            root.appendChild(error?.status === 404
                ? errorState(
                    'Раздел ботов ещё не подключён на сервере: endpoint /api/admin/bots/analytics не найден. ' +
                    'Обновите backend и повторите.',
                    () => botsView.render(root, ctx))
                : errorState(
                    error?.message || 'Не удалось загрузить метрики ботов',
                    () => botsView.render(root, ctx)))
            return
        }

        clear(root)
        root.appendChild(buildBotsView(data || {}, ctx.contentWidth))
    }
}
