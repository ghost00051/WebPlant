import { api } from '../api.js'
import { SERVER_BASE } from '../config.js'
import {
    confirmDialog, h, loadInto, pagination, searchInput, select, table, toast
} from '../ui.js'
import { downloadCsv, formatDateTime, formatNumber, maskEmail, truncate } from '../format.js'

function photoUrl(url) {
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    return `${SERVER_BASE}${url.startsWith('/') ? url : `/${url}`}`
}

function userCell(row) {
    return h('div', { class: 'cell-main' }, [
        h('span', {
            class: 'cell-title',
            text: row.user?.name || row.user?.username ||
                maskEmail(row.user?.email || row.userEmail || row.user_email) || '—'
        }),
        h('span', { class: 'cell-sub', text: maskEmail(row.user?.email || row.userEmail || row.user_email || '') })
    ])
}

function buildResource(config) {
    return {
        id: config.id,
        title: config.title,
        subtitle: config.subtitle,
        async render(root, ctx) {
            const state = {
                page: Math.max(1, Number(ctx.params.page) || 1),
                search: ctx.params.q || ''
            }
            for (const filter of config.filters || []) {
                state[filter.key] = ctx.params[filter.key] || filter.defaultValue || ''
            }
            if (config.dateRange) {
                state.from = ctx.params.from || ''
                state.to = ctx.params.to || ''
            }

            const toolbar = h('div', { class: 'toolbar' }, [
                searchInput({
                    value: state.search,
                    placeholder: config.searchPlaceholder,
                    onInput: value => ctx.setParams({ q: value, page: 1 }, { replace: true, debounce: true })
                }),
                ...(config.filters || []).map(filter => select({
                    value: state[filter.key],
                    options: filter.options,
                    ariaLabel: filter.ariaLabel || filter.key,
                    onChange: value => ctx.setParams({ [filter.key]: value, page: 1 })
                })),
                ...(config.dateRange ? [
                    h('label', { class: 'field inline' }, [
                        h('span', { class: 'field-label', text: 'С даты' }),
                        h('input', {
                            class: 'input input-date',
                            type: 'date',
                            value: state.from,
                            onChange: event => ctx.setParams({ from: event.target.value, page: 1 })
                        })
                    ]),
                    h('label', { class: 'field inline' }, [
                        h('span', { class: 'field-label', text: 'По дату' }),
                        h('input', {
                            class: 'input input-date',
                            type: 'date',
                            value: state.to,
                            onChange: event => ctx.setParams({ to: event.target.value, page: 1 })
                        })
                    ])
                ] : []),
                h('button', {
                    class: 'btn btn-secondary',
                    type: 'button',
                    text: 'Обновить',
                    onClick: () => ctx.reload()
                })
            ])

            const body = h('div')
            root.replaceChildren(toolbar, body)

            const requestParams = {
                page: state.page,
                limit: config.limit || 25,
                search: state.search
            }
            for (const filter of config.filters || []) {
                if (state[filter.key]) requestParams[filter.param || filter.key] = state[filter.key]
            }
            if (config.dateRange) {
                if (state.from) requestParams.from = state.from
                if (state.to) requestParams.to = state.to
            }

            await loadInto(body, () => config.load(requestParams), data => {
                const deleteButton = row => h('button', {
                    class: 'btn btn-danger btn-small',
                    type: 'button',
                    text: 'Удалить',
                    onClick: async event => {
                        if (event) event.stopPropagation()
                        const prompt = config.confirm(row)
                        const confirmed = await confirmDialog({
                            title: prompt.title,
                            message: prompt.message,
                            details: prompt.details,
                            confirmLabel: prompt.confirmLabel || 'Удалить'
                        })
                        if (!confirmed) return
                        try {
                            await config.remove(row)
                            toast(prompt.successMessage || 'Удалено', 'success')
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })

                return h('div', { class: 'stack' }, [
                    h('div', { class: 'list-head' }, [
                        h('p', {
                            class: 'muted',
                            text: data.summary
                                ? `Всего записей: ${formatNumber(data.total)} · поливов ${formatNumber(data.summary.watered)} · пропусков ${formatNumber(data.summary.skipped)}`
                                : `Всего записей: ${formatNumber(data.total)}`
                        }),
                        h('button', {
                            class: 'btn btn-secondary btn-small',
                            type: 'button',
                            text: 'Выгрузить CSV',
                            onClick: () => downloadCsv(
                                `${config.id}-page${data.page}.csv`,
                                config.csv,
                                data.items
                            )
                        })
                    ]),
                    table({
                        label: config.title,
                        columns: [...config.columns, {
                            key: 'actions',
                            label: '',
                            align: 'right',
                            render: row => h('div', { class: 'row-actions' }, [
                                ...(config.extraActions ? config.extraActions(row, ctx) : []),
                                deleteButton(row)
                            ])
                        }],
                        rows: data.items,
                        emptyText: config.emptyText || 'Ничего не найдено'
                    }),
                    pagination({
                        page: data.page,
                        pages: data.pages,
                        total: data.total,
                        limit: data.limit,
                        onPage: page => ctx.setParams({ page })
                    })
                ])
            }, config.loadingText || 'Загружаем данные…')
        }
    }
}

export const plantsView = buildResource({
    id: 'plants',
    title: 'Растения',
    subtitle: 'Все коллекции: владелец, расписание и история поливов',
    searchPlaceholder: 'Поиск по названию, виду или владельцу',
    limit: 25,
    filters: [
        {
            key: 'active',
            ariaLabel: 'Фильтр по активности',
            options: [
                { value: '', label: 'Все растения' },
                { value: 'true', label: 'Активные' },
                { value: 'false', label: 'Архивные' }
            ]
        }
    ],
    load: params => api.plants(params),
    remove: row => api.deletePlant(row.id),
    confirm: row => ({
        title: 'Удалить растение?',
        message: `«${row.name}» будет удалено вместе с историей поливов и фотографиями.`,
        details: `Владелец: ${row.user.email}\nПоливов: ${row.waterings}\nФото: ${row.photos}`,
        confirmLabel: 'Удалить растение',
        successMessage: 'Растение удалено'
    }),
    columns: [
        {
            key: 'photo',
            label: '',
            width: '56px',
            render: row => row.mainPhotoUrl
                ? h('img', { class: 'thumb', src: photoUrl(row.mainPhotoUrl), alt: '', loading: 'lazy' })
                : h('span', { class: 'thumb thumb-empty', text: '🌿' })
        },
        { key: 'id', label: 'ID', align: 'right', width: '60px' },
        {
            key: 'name',
            label: 'Растение',
            render: row => h('div', { class: 'cell-main' }, [
                h('span', { class: 'cell-title', text: row.name }),
                h('span', { class: 'cell-sub', text: row.species || 'вид не указан' })
            ])
        },
        { key: 'user', label: 'Владелец', render: userCell },
        {
            key: 'wateringIntervalDays',
            label: 'Полив',
            render: row => row.wateringIntervalDays ? `каждые ${row.wateringIntervalDays} дн.` : '—'
        },
        { key: 'waterings', label: 'Поливов', align: 'right' },
        { key: 'photos', label: 'Фото', align: 'right' },
        { key: 'nextWateringAt', label: 'Следующий полив', render: row => formatDateTime(row.nextWateringAt) },
        { key: 'createdAt', label: 'Создано', render: row => formatDateTime(row.createdAt) }
    ],
    csv: [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Растение' },
        { key: 'species', label: 'Вид' },
        { key: 'location', label: 'Локация' },
        { key: 'isActive', label: 'Активно' },
        { key: 'wateringIntervalDays', label: 'Интервал, дней' },
        { key: 'waterings', label: 'Поливов' },
        { key: 'photos', label: 'Фото' },
        { key: 'createdAt', label: 'Создано' },
        { key: 'lastWateredAt', label: 'Последний полив' },
        { key: 'nextWateringAt', label: 'Следующий полив' },
        { key: 'user', label: 'Владелец', value: row => row.user.email }
    ],
    emptyText: 'Растений не найдено'
})

export const wateringsView = buildResource({
    id: 'waterings',
    title: 'Поливы',
    subtitle: 'Журнал отметок о поливе и пропусков',
    searchPlaceholder: 'Поиск по растению или владельцу',
    limit: 25,
    dateRange: true,
    loadingText: 'Загружаем журнал поливов…',
    filters: [
        {
            key: 'action',
            ariaLabel: 'Фильтр по действию',
            options: [
                { value: '', label: 'Все действия' },
                { value: 'watered', label: 'Поливы' },
                { value: 'skipped', label: 'Пропуски' }
            ]
        }
    ],
    load: params => api.waterings(params),
    remove: row => api.deleteWatering(row.id),
    confirm: row => ({
        title: 'Удалить запись о поливе?',
        message: `Запись «${row.plantName}» от ${formatDateTime(row.actionAt)} будет удалена, ` +
            'расписание растения пересчитается.',
        confirmLabel: 'Удалить запись',
        successMessage: 'Запись о поливе удалена'
    }),
    columns: [
        { key: 'id', label: 'ID', align: 'right', width: '70px' },
        { key: 'plantName', label: 'Растение' },
        { key: 'user', label: 'Владелец', render: userCell },
        {
            key: 'action',
            label: 'Действие',
            render: row => row.action === 'watered'
                ? h('span', { class: 'tag tag-ok', text: 'полив' })
                : h('span', { class: 'tag tag-warn', text: 'пропуск' })
        },
        { key: 'actionAt', label: 'Когда', render: row => formatDateTime(row.actionAt) },
        { key: 'scheduledFor', label: 'По плану', render: row => formatDateTime(row.scheduledFor) },
        { key: 'hoursLate', label: 'Опоздание, ч', align: 'right' },
        { key: 'createdAt', label: 'Создано', render: row => formatDateTime(row.createdAt) }
    ],
    csv: [
        { key: 'id', label: 'ID' },
        { key: 'plantId', label: 'ID растения' },
        { key: 'plantName', label: 'Растение' },
        { key: 'userEmail', label: 'Email владельца' },
        { key: 'action', label: 'Действие' },
        { key: 'actionAt', label: 'Когда' },
        { key: 'scheduledFor', label: 'По плану' },
        { key: 'hoursLate', label: 'Опоздание, ч' },
        { key: 'note', label: 'Заметка' },
        { key: 'createdAt', label: 'Создано' }
    ],
    emptyText: 'Записей о поливе не найдено'
})

export const photosView = buildResource({
    id: 'photos',
    title: 'Фотографии',
    subtitle: 'Загруженные фото растений',
    searchPlaceholder: 'Поиск по растению или владельцу',
    limit: 24,
    load: params => api.photos(params),
    remove: row => api.deletePhoto(row.id),
    confirm: row => ({
        title: 'Удалить фотографию?',
        message: `Фото растения «${row.plantName}» будет удалено вместе с файлом на сервере.`,
        confirmLabel: 'Удалить фото',
        successMessage: 'Фотография удалена'
    }),
    columns: [
        {
            key: 'preview',
            label: '',
            width: '80px',
            render: row => h('a', {
                class: 'thumb-link',
                href: photoUrl(row.url),
                target: '_blank',
                rel: 'noreferrer'
            }, [h('img', { class: 'thumb', src: photoUrl(row.url), alt: '', loading: 'lazy' })])
        },
        { key: 'id', label: 'ID', align: 'right', width: '70px' },
        { key: 'plantName', label: 'Растение' },
        { key: 'user', label: 'Владелец', render: userCell },
        { key: 'isMain', label: 'Главное', render: row => row.isMain ? 'да' : '—' },
        { key: 'sortOrder', label: 'Порядок', align: 'right' },
        { key: 'createdAt', label: 'Загружено', render: row => formatDateTime(row.createdAt) }
    ],
    csv: [
        { key: 'id', label: 'ID' },
        { key: 'plantId', label: 'ID растения' },
        { key: 'plantName', label: 'Растение' },
        { key: 'userEmail', label: 'Email владельца' },
        { key: 'url', label: 'URL' },
        { key: 'isMain', label: 'Главное' },
        { key: 'sortOrder', label: 'Порядок' },
        { key: 'createdAt', label: 'Загружено' }
    ],
    emptyText: 'Фотографий не найдено'
})

export const chatView = buildResource({
    id: 'chat',
    title: 'Чат с ИИ',
    subtitle: 'История сообщений пользователей и ответов ассистента',
    searchPlaceholder: 'Поиск по тексту или владельцу',
    limit: 25,
    filters: [
        {
            key: 'role',
            ariaLabel: 'Фильтр по роли',
            options: [
                { value: '', label: 'Все роли' },
                { value: 'user', label: 'Сообщения пользователей' },
                { value: 'assistant', label: 'Ответы ассистента' },
                { value: 'system', label: 'Системные' }
            ]
        }
    ],
    load: params => api.chat(params),
    remove: row => api.deleteChat(row.id),
    confirm: row => ({
        title: 'Удалить сообщение?',
        message: `Сообщение от ${formatDateTime(row.createdAt)} будет удалено из истории чата.`,
        confirmLabel: 'Удалить сообщение',
        successMessage: 'Сообщение удалено'
    }),
    extraActions: (row, ctx) => [
        h('button', {
            class: 'btn btn-ghost btn-small',
            type: 'button',
            text: 'Вся переписка',
            title: 'Удалить все сообщения этой сессии',
            onClick: async () => {
                const confirmed = await confirmDialog({
                    title: 'Удалить всю переписку?',
                    message: 'Все сообщения этой сессии чата будут удалены.',
                    confirmLabel: 'Удалить переписку'
                })
                if (!confirmed) return
                try {
                    await api.deleteChatSession(row.sessionId)
                    toast('Переписка удалена', 'success')
                    ctx.reload()
                } catch (error) {
                    toast(error.message, 'error')
                }
            }
        })
    ],
    columns: [
        { key: 'id', label: 'ID', align: 'right', width: '70px' },
        { key: 'user', label: 'Автор', render: userCell },
        {
            key: 'role',
            label: 'Роль',
            render: row => row.role === 'user'
                ? h('span', { class: 'tag tag-ok', text: 'пользователь' })
                : h('span', { class: 'tag', text: row.role === 'assistant' ? 'ассистент' : row.role })
        },
        {
            key: 'text',
            label: 'Сообщение',
            render: row => h('span', { class: 'cell-text', title: row.text || '', text: truncate(row.text, 160) })
        },
        { key: 'inputTokens', label: 'Токены', align: 'right' },
        { key: 'createdAt', label: 'Когда', render: row => formatDateTime(row.createdAt) }
    ],
    csv: [
        { key: 'id', label: 'ID' },
        { key: 'userEmail', label: 'Email' },
        { key: 'sessionId', label: 'Сессия' },
        { key: 'role', label: 'Роль' },
        { key: 'text', label: 'Текст' },
        { key: 'inputTokens', label: 'Входные токены' },
        { key: 'outputTokens', label: 'Выходные токены' },
        { key: 'createdAt', label: 'Когда' }
    ],
    emptyText: 'Сообщений не найдено'
})
