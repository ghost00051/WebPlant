import { api } from '../api.js'
import { PALETTE, barChart, donutChart, gridChartWidth, hBarChart, lineChart } from '../charts.js'
import { badge, barMeter, card, grid, h, loadInto, pagination, statCard, table } from '../ui.js'
import {
    downloadCsv,
    formatDateTime,
    formatNumber,
    formatPercent,
    formatShortDay,
    maskEmail,
    plural
} from '../format.js'

const SEASON_LABELS = { winter: 'зима', spring: 'весна', summer: 'лето', autumn: 'осень' }
const CONFIDENCE_LABELS = { high: 'высокая', medium: 'средняя', low: 'низкая' }
const CONFIDENCE_TONES = { high: 'success', medium: 'warning', low: 'danger' }
const TIME_LABELS = { morning: 'утро', day: 'день', evening: 'вечер' }
const SOURCE_TONES = { ai: 'accent', cache: 'neutral', fallback: 'warning' }

const KIND_FILTERS = [
    { id: '', label: 'Все' },
    { id: 'watering', label: 'Частота полива' },
    { id: 'time', label: 'Время полива' },
    { id: 'species', label: 'Определение вида' }
]

function formatSeconds(ms) {
    const value = Number(ms)
    if (!Number.isFinite(value) || value <= 0) return '—'
    if (value < 1000) return `${Math.round(value)} мс`
    return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} с`
}

function formatCost(cost) {
    if (!cost) return 'тариф не задан'
    const value = Number(cost.total) || 0
    return `${value.toFixed(value < 10 ? 2 : 0)} ${cost.currency}`
}

function emptyMetricsNotice() {
    return h('div', { class: 'notice notice-info' }, [
        h('p', {
            text: 'Телеметрия пока пуста. Цифры появятся после первых обращений к Алисе — ' +
                'счётчики растут на каждый запрос к модели, попадание в кэш и ошибку.'
        })
    ])
}

function budgetSection({ budget, config }) {
    if (!budget.limit) {
        return h('div', { class: 'notice notice-info' }, [
            h('p', {
                text: 'Дневной бюджет обращений к модели не задан (AI_DAILY_REQUEST_BUDGET). ' +
                    'Ограничения нет — при необходимости задайте лимит в .env и перезапустите backend.'
            })
        ])
    }

    const used = budget.usedToday
    const limit = budget.limit

    return h('div', { class: `notice ${budget.exceeded ? 'notice-warn' : 'notice-info'}` }, [
        h('p', {
            text: budget.exceeded
                ? `Дневной бюджет исчерпан: ${formatNumber(used)} из ${formatNumber(limit)} обращений. ` +
                    'Алиса отвечает без модели (по данным приложения), пока не наступит новый день.'
                : `Дневной бюджет: ${formatNumber(used)} из ${formatNumber(limit)} обращений сегодня.`
        }),
        barMeter(used, limit, budget.exceeded ? 'danger' : 'accent'),
        h('p', {
            class: 'muted small',
            text: `Таймауты: чат ${formatSeconds(config.chatTimeoutMs)}, подсказки ${formatSeconds(config.adviceTimeoutMs)}, ` +
                `анализ фото ${formatSeconds(config.visionTimeoutMs)}. ` +
                `Лимит уточняющих вопросов: ${config.maxAdviceQuestions}.`
        })
    ])
}

function summarySection({ summary, days }) {
    const { totals, derived } = summary
    const cacheTotal = totals.cacheHits + totals.cacheMisses
    const perDay = Math.round(totals.requests / Math.max(1, days))

    return h('div', { class: 'stack' }, [
        grid(4, [
            statCard({
                label: 'Обращений к модели',
                value: formatNumber(totals.requests),
                hint: `Попаданий в кэш: ${formatNumber(totals.cacheHits)}`,
                tone: 'accent'
            }),
            statCard({
                label: 'Ошибки',
                value: formatNumber(totals.errors),
                hint: `${formatPercent(totals.errors, totals.requests)} запросов, таймаутов: ${formatNumber(totals.timeouts)}`,
                tone: derived.errorRate > 0.05 ? 'danger' : undefined
            }),
            statCard({
                label: 'Доля кэша',
                value: formatPercent(totals.cacheHits, cacheTotal),
                hint: cacheTotal
                    ? `${formatNumber(totals.cacheHits)} из ${formatNumber(cacheTotal)} ответов без обращения к модели`
                    : 'Кэш ещё не использовался'
            }),
            statCard({
                label: 'Средняя задержка',
                value: formatSeconds(derived.avgLatencyMs),
                hint: `По ${plural(totals.latencyCount, ['одному замеру', 'двум замерам', `${formatNumber(totals.latencyCount)} замерам`])}`
            })
        ]),
        grid(4, [
            statCard({
                label: 'Токены на вход',
                value: formatNumber(totals.tokensIn),
                hint: totals.tokensCached
                    ? `в том числе из кэша: ${formatNumber(totals.tokensCached)}`
                    : 'Кешированных токенов не было'
            }),
            statCard({ label: 'Токены на выход', value: formatNumber(totals.tokensOut) }),
            statCard({
                label: 'Оценка стоимости',
                value: formatCost(summary.cost),
                hint: summary.cost
                    ? (summary.cost.cachedPer1k === null
                        ? 'Кеш входа считается по цене входа — задайте AI_PRICE_CACHED_PER_1K'
                        : `Кеш входа учтён по ${summary.cost.cachedPer1k} ${summary.cost.currency}/1000`)
                    : 'Задайте AI_PRICE_INPUT_PER_1K и AI_PRICE_OUTPUT_PER_1K'
            }),
            statCard({
                label: 'Запросов в день',
                value: formatNumber(perDay),
                hint: `Среднее за ${days} ${plural(days, ['день', 'дня', 'дней'])}`
            })
        ])
    ])
}

function dynamicsSection({ series, summary }, contentWidth) {
    const chartWidth = gridChartWidth(contentWidth)
    const line = lineChart({
        width: chartWidth,
        title: 'Обращения к модели и попадания в кэш по дням',
        table: {
            columns: [
                { label: 'День', value: day => formatShortDay(day.day) },
                { label: 'Обращения', align: 'right', value: day => formatNumber(day.requests) },
                { label: 'Из кэша', align: 'right', value: day => formatNumber(day.cacheHits) },
                { label: 'Ошибки', align: 'right', value: day => formatNumber(day.errors) }
            ],
            rows: series
        },
        series: [
            {
                name: 'Обращения к модели',
                color: PALETTE[0],
                points: series.map(day => ({ x: day.day, y: day.requests }))
            },
            {
                name: 'Из кэша',
                color: PALETTE[1],
                points: series.map(day => ({ x: day.day, y: day.cacheHits }))
            },
            {
                name: 'Ошибки',
                color: PALETTE[3],
                points: series.map(day => ({ x: day.day, y: day.errors }))
            }
        ],
        formatValue: value => formatNumber(value),
        formatX: formatShortDay
    })

    const tokens = barChart({
        width: chartWidth,
        title: 'Токены по дням (вход и выход)',
        table: {
            columns: [
                { label: 'День', value: day => formatShortDay(day.day) },
                { label: 'Токены', align: 'right', value: day => formatNumber(day.tokensIn + day.tokensOut) }
            ],
            rows: series
        },
        items: series.map(day => ({
            label: formatShortDay(day.day),
            value: day.tokensIn + day.tokensOut
        })),
        color: PALETTE[4],
        formatValue: value => formatNumber(value)
    })

    const cacheDonut = donutChart({
        title: 'Эффект кэша: ответы из кэша и запросы к модели',
        table: {
            columns: [
                { label: 'Источник', value: row => row.label },
                { label: 'Ответов', align: 'right', value: row => formatNumber(row.value) }
            ],
            rows: [
                { label: 'Из кэша', value: summary.totals.cacheHits },
                { label: 'Запросы к модели', value: summary.totals.cacheMisses }
            ]
        },
        items: [
            { label: 'Из кэша', value: summary.totals.cacheHits, color: PALETTE[1] },
            { label: 'Запросы к модели', value: summary.totals.cacheMisses, color: PALETTE[0] }
        ],
        centerValue: formatPercent(summary.totals.cacheHits, summary.totals.cacheHits + summary.totals.cacheMisses),
        centerLabel: 'кэш'
    })

    const latency = hBarChart({
        title: 'Распределение задержек',
        items: summary.latencyBuckets.map((bucket, index) => ({
            label: bucket.label,
            value: bucket.count,
            color: PALETTE[index % PALETTE.length],
            hint: `${formatNumber(bucket.count)} ответов`
        })),
        formatValue: value => formatNumber(value)
    })

    return h('div', { class: 'stack' }, [
        grid(2, [
            card('Обращения и кэш по дням', 'Сколько раз ходили к модели и сколько ответов взяли из Redis', line),
            card('Токены по дням', 'Суммарный расход токенов (вход и выход)', tokens)
        ]),
        grid(2, [
            card('Эффект кэша', 'Доля ответов, полученных без обращения к модели', cacheDonut),
            card('Распределение задержек', 'Сколько ответов уложилось в каждую корзину времени', latency)
        ])
    ])
}

function scopesSection({ summary, scopes }) {
    const rows = Object.entries(summary.scopes || {}).map(([scope, value]) => {
        const cacheTotal = value.cacheHits + value.cacheMisses
        return {
            scope,
            label: scopes[scope] || scope,
            requests: value.requests,
            errors: value.errors,
            cacheRate: cacheTotal ? value.cacheHits / cacheTotal : 0,
            tokens: value.tokensIn + value.tokensOut,
            avgLatency: value.latencyCount ? value.latencyMs / value.latencyCount : 0
        }
    })

    return card('По сценариям', 'Чат, определение вида, частота и время полива, анализ фото', table({
        label: 'ИИ по сценариям',
        columns: [
            { key: 'label', label: 'Сценарий' },
            { key: 'requests', label: 'Запросы', align: 'right', render: row => formatNumber(row.requests) },
            {
                key: 'errors',
                label: 'Ошибки',
                align: 'right',
                render: row => row.errors
                    ? badge(formatNumber(row.errors), 'danger')
                    : h('span', { class: 'muted', text: '0' })
            },
            {
                key: 'cacheRate',
                label: 'Кэш',
                align: 'right',
                render: row => formatPercent(row.cacheRate * 100, 100)
            },
            { key: 'tokens', label: 'Токены', align: 'right', render: row => formatNumber(row.tokens) },
            { key: 'avgLatency', label: 'Средняя задержка', align: 'right', render: row => formatSeconds(row.avgLatency) }
        ],
        rows,
        emptyText: 'Обращений к ИИ ещё не было'
    }))
}

function adviceResult(item) {
    if (item.kind === 'watering') {
        return item.resultType === 'recommendation'
            ? `${item.intervalDays ?? '—'} дн.`
            : 'уточняющий вопрос'
    }
    if (item.kind === 'time') return TIME_LABELS[item.timeOfDay] || item.timeOfDay || '—'
    return item.species || '—'
}

function logSection(logs, ctx, { kind, limit, offset }) {
    const total = logs.total || 0
    const page = Math.floor(offset / limit) + 1
    const pages = Math.max(1, Math.ceil(total / limit))

    const filters = h('div', { class: 'row-actions' }, KIND_FILTERS.map(filter => h('button', {
        class: ['btn', 'btn-small', (kind || '') === filter.id ? 'btn-primary' : 'btn-secondary'],
        type: 'button',
        text: filter.label,
        onClick: () => ctx.setParams({ kind: filter.id || undefined, offset: undefined })
    })))

    const exportButton = h('button', {
        class: 'btn btn-secondary btn-small',
        type: 'button',
        text: 'Скачать CSV',
        disabled: !logs.items?.length,
        onClick: () => downloadCsv('alisa-advice-log.csv', [
            { label: 'Дата', value: row => formatDateTime(row.createdAt) },
            { label: 'Тип', value: row => row.kindLabel },
            { label: 'Растение', value: row => row.plantName || '' },
            { label: 'Вид', value: row => row.species || '' },
            { label: 'Сезон', value: row => SEASON_LABELS[row.season] || row.season || '' },
            { label: 'Результат', value: row => adviceResult(row) },
            { label: 'Уверенность', value: row => CONFIDENCE_LABELS[row.confidence] || row.confidence || '' },
            { label: 'Вопросов', value: row => row.questionsAsked ?? 0 },
            { label: 'Источник', value: row => row.sourceLabel || row.source || '' },
            { label: 'Задержка, мс', value: row => row.latencyMs ?? '' },
            { label: 'Пользователь', value: row => row.user?.email || 'гость' }
        ], logs.items)
    })

    const body = logs.pendingMigration
        ? h('div', { class: 'notice notice-warn' }, [
            h('p', { text: 'Таблица журнала ещё не создана: примените миграцию 20261016_create_ai_advice_logs.sql.' })
        ])
        : table({
            label: 'Журнал подсказок',
            columns: [
                { key: 'createdAt', label: 'Когда', render: row => formatDateTime(row.createdAt) },
                {
                    key: 'kind',
                    label: 'Тип',
                    render: row => badge(row.kindLabel || row.kind, row.kind === 'watering' ? 'accent' : 'neutral')
                },
                {
                    key: 'plant',
                    label: 'Растение',
                    render: row => row.plantName
                        ? `${row.plantName}${row.species ? ` (${row.species})` : ''}`
                        : '—'
                },
                { key: 'season', label: 'Сезон', render: row => SEASON_LABELS[row.season] || row.season || '—' },
                { key: 'result', label: 'Результат', render: row => adviceResult(row) },
                {
                    key: 'confidence',
                    label: 'Уверенность',
                    render: row => row.confidence
                        ? badge(CONFIDENCE_LABELS[row.confidence] || row.confidence,
                            CONFIDENCE_TONES[row.confidence] || 'neutral')
                        : '—'
                },
                {
                    key: 'questionsAsked',
                    label: 'Вопросов',
                    align: 'right',
                    render: row => formatNumber(row.questionsAsked)
                },
                {
                    key: 'source',
                    label: 'Источник',
                    render: row => badge(row.sourceLabel || row.source, SOURCE_TONES[row.source] || 'neutral')
                },
                { key: 'latencyMs', label: 'Задержка', align: 'right', render: row => formatSeconds(row.latencyMs) },
                {
                    key: 'user',
                    label: 'Пользователь',
                    render: row => row.user?.email
                        ? maskEmail(row.user.email)
                        : h('span', { class: 'muted', text: 'гость' })
                }
            ],
            rows: logs.items || [],
            emptyText: 'Подсказок пока не было'
        })

    const counters = h('div', { class: 'row-actions' }, Object.entries(logs.byKind || {}).map(([key, value]) =>
        badge(`${logs.kindLabels?.[key] || key}: ${formatNumber(value)}`, 'neutral')
    ))

    return card(
        'Журнал подсказок',
        `Что и когда советовала Алиса — всего ${formatNumber(total)} записей`,
        h('div', { class: 'stack' }, [
            counters,
            filters,
            body,
            pages > 1
                ? pagination({
                    page,
                    pages,
                    total,
                    limit,
                    onPage: nextPage => ctx.setParams({
                        offset: nextPage === 1 ? undefined : String((nextPage - 1) * limit)
                    })
                })
                : null
        ]),
        exportButton
    )
}

function processCacheSection({ cache }) {
    if (!cache) return null

    return card('Кэш текущего процесса', 'Счётчики в памяти пода — обнуляются при перезапуске', table({
        label: 'Кэш текущего процесса',
        columns: [
            { key: 'label', label: 'Показатель' },
            { key: 'value', label: 'Значение', align: 'right' }
        ],
        rows: [
            { label: 'Состояние', value: cache.enabled ? 'включён' : 'выключен' },
            { label: 'Попадания', value: formatNumber(cache.hits) },
            { label: 'Промахи', value: formatNumber(cache.misses) },
            { label: 'Записи', value: formatNumber(cache.writes) },
            { label: 'Ошибки', value: formatNumber(cache.errors) },
            { label: 'Пропущено', value: formatNumber(cache.skipped) }
        ],
        emptyText: 'Нет данных'
    }))
}

export const aiView = {
    id: 'ai',
    title: 'Алиса и ИИ',
    subtitle: 'Обращения к модели, кэш, ошибки, задержки, бюджет и журнал подсказок',
    needsRange: true,
    async render(root, ctx) {
        const kind = ctx.params.kind || ''
        const limit = Math.min(Math.max(Number(ctx.params.limit) || 50, 10), 100)
        const offset = Math.max(Number(ctx.params.offset) || 0, 0)

        await loadInto(root, async () => {
            const [metrics, logs] = await Promise.all([
                api.aiMetrics(ctx.days),
                api.aiLogs({ kind: kind || undefined, limit, offset })
            ])
            return { metrics, logs }
        }, ({ metrics, logs }) => {
            const hasData = metrics.summary.totals.requests > 0 ||
                metrics.summary.totals.cacheHits > 0 ||
                metrics.summary.totals.cacheMisses > 0

            return h('div', { class: 'stack' }, [
                budgetSection(metrics),
                hasData ? null : emptyMetricsNotice(),
                summarySection(metrics),
                hasData ? dynamicsSection(metrics, ctx.contentWidth) : null,
                scopesSection(metrics),
                logSection(logs, ctx, { kind, limit, offset }),
                processCacheSection(metrics)
            ])
        }, 'Собираем телеметрию Алисы…')
    }
}
