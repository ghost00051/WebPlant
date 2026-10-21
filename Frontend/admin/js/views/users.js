import { api } from '../api.js'
import {
    badge, card, confirmDialog, h, loadInto, openDialog, pagination, searchInput, select, table, toast
} from '../ui.js'
import { downloadCsv, formatDateTime, formatNumber, maskEmail, timeAgo } from '../format.js'

const SORTS = [
    { value: 'created', label: 'По дате регистрации' },
    { value: 'activity', label: 'По активности' },
    { value: 'plants', label: 'По растениям' },
    { value: 'waterings', label: 'По поливам' },
    { value: 'chat', label: 'По сообщениям' },
    { value: 'email', label: 'По email' },
    { value: 'id', label: 'По ID' }
]

const SORT_COLUMNS = {
    created: 'createdAt',
    activity: 'lastActivityAt',
    plants: 'plants',
    waterings: 'waterings',
    chat: 'chatMessages',
    email: 'email',
    id: 'id'
}

function readParams(params) {
    return {
        page: Math.max(1, Number(params.page) || 1),
        search: params.q || '',
        sort: SORTS.some(item => item.value === params.sort) ? params.sort : 'created',
        order: params.order === 'asc' ? 'asc' : 'desc'
    }
}

function roleBadge(role) {
    return role === 'ADMIN' ? badge('админ', 'warning') : badge('пользователь', 'neutral')
}

function showModal(title, content, actions) {
    return openDialog({
        title,
        wide: true,
        showClose: true,
        children: [h('div', { class: 'modal-body' }, [content])],
        actions: actions && actions.length ? actions : null
    })
}

function userDetailNode(detail, ctx) {
    const { user, stats, plants, waterings, chat, sessions, consents } = {
        consents: detail.legalConsents || [],
        ...detail
    }

    const facts = h('div', { class: 'facts' }, [
        ['Email', user.email],
        ['Имя', user.name || '—'],
        ['Логин', user.username || '—'],
        ['Телефон', user.phone || '—'],
        ['Роль', user.role],
        ['Тариф', user.privilegeLevel],
        ['Регистрация', user.createdAt ? formatDateTime(user.createdAt) : 'неизвестна'],
        ['Последний полив', formatDateTime(stats.lastWateringAt)],
        ['Последнее сообщение', formatDateTime(stats.lastChatAt)]
    ].map(([label, value]) => h('p', {}, [
        h('span', { class: 'fact-label', text: label }),
        h('span', { class: 'fact-value', text: String(value) })
    ])))

    const statsGrid = h('div', { class: 'chip-row' }, [
        `Растений: ${formatNumber(stats.plants)} (активных ${formatNumber(stats.activePlants)})`,
        `Поливов: ${formatNumber(stats.waterings)}`,
        `Пропусков: ${formatNumber(stats.skippedWaterings)}`,
        `Фото: ${formatNumber(stats.photos)}`,
        `Сообщений: ${formatNumber(stats.chatMessages)}`,
        `Сессий чата: ${formatNumber(stats.chatSessions)}`,
        `Push-подписок: ${formatNumber(stats.pushSubscriptions)}`,
        `Passkey: ${formatNumber(stats.passkeys)}`,
        `Активных сессий: ${formatNumber(stats.activeSessions)}`
    ].map(text => h('span', { class: 'chip', text })))

    const plantList = table({
        columns: [
            { key: 'id', label: 'ID', align: 'right' },
            { key: 'name', label: 'Растение' },
            { key: 'species', label: 'Вид' },
            { key: 'waterings', label: 'Поливов', align: 'right' },
            { key: 'nextWateringAt', label: 'Следующий полив', render: row => formatDateTime(row.nextWateringAt) },
            {
                key: 'actions',
                label: '',
                align: 'right',
                render: row => h('button', {
                    class: 'btn btn-danger btn-small',
                    type: 'button',
                    text: 'Удалить',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: 'Удалить растение?',
                            message: `«${row.name}» и вся история его поливов будут удалены безвозвратно.`,
                            confirmLabel: 'Удалить растение'
                        })
                        if (!confirmed) return
                        try {
                            await api.deletePlant(row.id)
                            toast('Растение удалено', 'success')
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })
            }
        ],
        rows: plants,
        emptyText: 'У пользователя нет растений'
    })

    const wateringList = table({
        columns: [
            { key: 'id', label: 'ID', align: 'right' },
            { key: 'plantName', label: 'Растение' },
            { key: 'action', label: 'Действие', render: row => row.action === 'watered' ? 'полив' : 'пропуск' },
            { key: 'actionAt', label: 'Когда', render: row => formatDateTime(row.actionAt) },
            {
                key: 'actions',
                label: '',
                align: 'right',
                render: row => h('button', {
                    class: 'btn btn-danger btn-small',
                    type: 'button',
                    text: 'Удалить',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: 'Удалить запись о поливе?',
                            message: 'Запись исчезнет из истории, расписание растения будет пересчитано.',
                            confirmLabel: 'Удалить запись'
                        })
                        if (!confirmed) return
                        try {
                            await api.deleteWatering(row.id)
                            toast('Запись о поливе удалена', 'success')
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })
            }
        ],
        rows: waterings,
        emptyText: 'Поливов нет'
    })

    const chatList = table({
        columns: [
            { key: 'role', label: 'Кто', render: row => row.role === 'user' ? 'пользователь' : row.role },
            { key: 'text', label: 'Сообщение', render: row => (row.text || '').slice(0, 200) },
            { key: 'createdAt', label: 'Когда', render: row => formatDateTime(row.createdAt) },
            {
                key: 'actions',
                label: '',
                align: 'right',
                render: row => h('button', {
                    class: 'btn btn-danger btn-small',
                    type: 'button',
                    text: 'Удалить',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: 'Удалить сообщение?',
                            message: 'Сообщение будет удалено из истории чата.',
                            confirmLabel: 'Удалить сообщение'
                        })
                        if (!confirmed) return
                        try {
                            await api.deleteChat(row.id)
                            toast('Сообщение удалено', 'success')
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })
            }
        ],
        rows: chat,
        emptyText: 'Сообщений нет'
    })

    const sessionList = table({
        columns: [
            { key: 'id', label: 'ID', align: 'right' },
            { key: 'token_type', label: 'Тип' },
            { key: 'created_at', label: 'Создана', render: row => formatDateTime(row.created_at) },
            { key: 'expires_at', label: 'Истекает', render: row => formatDateTime(row.expires_at) },
            { key: 'revoked_at', label: 'Отозвана', render: row => row.revoked_at ? formatDateTime(row.revoked_at) : '—' }
        ],
        rows: sessions,
        emptyText: 'Сессий нет'
    })

    const consentList = table({
        columns: [
            { key: 'consent_type', label: 'Согласие' },
            { key: 'is_accepted', label: 'Принято', render: row => row.is_accepted ? 'да' : 'нет' },
            { key: 'document_version', label: 'Версия' },
            { key: 'accepted_at', label: 'Когда', render: row => formatDateTime(row.accepted_at) }
        ],
        rows: consents,
        emptyText: 'Согласий нет'
    })

    return h('div', { class: 'stack' }, [
        facts,
        statsGrid,
        card('Растения', `${plants.length} шт.`, plantList),
        card('Поливы', 'Последние записи', wateringList),
        card('Чат', 'Последние сообщения', chatList),
        card('Сессии', 'Последние сессии входа', sessionList),
        card('Согласия', 'Юридические согласия', consentList)
    ])
}

async function openUserDetail(id, ctx) {
    const holder = h('div', { class: 'stack' }, [h('p', { class: 'muted', text: 'Загружаем карточку…' })])
    const modal = showModal(`Пользователь #${id}`, holder)
    const refresh = () => {
        modal.close()
        ctx.reload()
    }

    try {
        const detail = await api.user(id)
        holder.replaceChildren()
        holder.appendChild(h('div', { class: 'stack' }, [
            h('div', { class: 'row-actions' }, [
                h('button', {
                    class: 'btn btn-secondary',
                    type: 'button',
                    text: detail.user.role === 'ADMIN' ? 'Снять права администратора' : 'Сделать администратором',
                    onClick: async () => {
                        const nextRole = detail.user.role === 'ADMIN' ? 'USER' : 'ADMIN'
                        try {
                            await api.updateUser(id, { role: nextRole })
                            toast('Роль обновлена', 'success')
                            modal.close()
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                }),
                h('button', {
                    class: 'btn btn-danger',
                    type: 'button',
                    text: 'Удалить пользователя',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: 'Удалить пользователя?',
                            message: `Аккаунт ${detail.user.email} будет удалён вместе с растениями, ` +
                                'поливами, фото, сообщениями, согласиями и подписками.',
                            details: `Растений: ${detail.stats.plants}\n` +
                                `Поливов: ${detail.stats.waterings}\n` +
                                `Фото: ${detail.stats.photos}\n` +
                                `Сообщений: ${detail.stats.chatMessages}`,
                            confirmLabel: 'Удалить навсегда',
                            typedWord: 'УДАЛИТЬ'
                        })
                        if (!confirmed) return
                        try {
                            await api.deleteUser(id)
                            toast('Пользователь удалён', 'success')
                            modal.close()
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })
            ]),
            userDetailNode(detail, { ...ctx, reload: refresh })
        ]))
    } catch (error) {
        holder.replaceChildren()
        holder.appendChild(h('p', { class: 'state state-error', text: error.message }))
    }
}

function buildList(data, ctx) {
    const columns = [
        { key: 'id', label: 'ID', align: 'right', width: '60px' },
        {
            key: 'email',
            label: 'Пользователь',
            render: row => h('div', { class: 'cell-main' }, [
                h('span', { class: 'cell-title', text: row.name || row.username || maskEmail(row.email) }),
                h('span', { class: 'cell-sub', text: maskEmail(row.email) })
            ])
        },
        { key: 'role', label: 'Роль', render: row => roleBadge(row.role) },
        {
            key: 'createdAt',
            label: 'Регистрация',
            render: row => row.createdAt ? formatDateTime(row.createdAt) : '—'
        },
        { key: 'plants', label: 'Растений', align: 'right' },
        { key: 'waterings', label: 'Поливов', align: 'right' },
        { key: 'photos', label: 'Фото', align: 'right' },
        { key: 'chatMessages', label: 'Сообщений', align: 'right' },
        { key: 'lastActivityAt', label: 'Активность', render: row => timeAgo(row.lastActivityAt) },
        {
            key: 'actions',
            label: '',
            align: 'right',
            render: row => h('div', { class: 'row-actions' }, [
                h('button', {
                    class: 'btn btn-secondary btn-small',
                    type: 'button',
                    text: 'Карточка',
                    onClick: event => {
                        event.stopPropagation()
                        openUserDetail(row.id, ctx)
                    }
                }),
                h('button', {
                    class: 'btn btn-danger btn-small',
                    type: 'button',
                    text: 'Удалить',
                    onClick: async event => {
                        event.stopPropagation()
                        const confirmed = await confirmDialog({
                            title: 'Удалить пользователя?',
                            message: `Аккаунт ${row.email} и все связанные данные будут удалены.`,
                            confirmLabel: 'Удалить навсегда',
                            typedWord: 'УДАЛИТЬ'
                        })
                        if (!confirmed) return
                        try {
                            await api.deleteUser(row.id)
                            toast('Пользователь удалён', 'success')
                            ctx.reload()
                        } catch (error) {
                            toast(error.message, 'error')
                        }
                    }
                })
            ])
        }
    ]

    const sortState = readParams(ctx.params)
    const sortColumn = SORT_COLUMNS[sortState.sort]
    for (const column of columns) {
        if (column.key === sortColumn) {
            column.ariaSort = sortState.order === 'asc' ? 'ascending' : 'descending'
        }
    }

    return h('div', { class: 'stack' }, [
        table({
            columns,
            rows: data.items,
            emptyText: 'Пользователи не найдены',
            label: 'Пользователи',
            onRowClick: row => openUserDetail(row.id, ctx)
        }),
        pagination({
            page: data.page,
            pages: data.pages,
            total: data.total,
            limit: data.limit,
            onPage: page => ctx.setParams({ page })
        })
    ])
}

export const usersView = {
    id: 'users',
    title: 'Пользователи',
    subtitle: 'Кто зарегистрировался, сколько создал и когда заходил',
    async render(root, ctx) {
        const state = readParams(ctx.params)

        const toolbar = h('div', { class: 'toolbar' }, [
            searchInput({
                value: state.search,
                placeholder: 'Поиск по email, имени или логину',
                onInput: value => ctx.setParams({ q: value, page: 1 }, { replace: true, debounce: true })
            }),
            select({
                value: state.sort,
                options: SORTS,
                ariaLabel: 'Сортировка пользователей',
                onChange: value => ctx.setParams({ sort: value, page: 1 })
            }),
            select({
                value: state.order,
                options: [
                    { value: 'desc', label: 'Сначала больше' },
                    { value: 'asc', label: 'Сначала меньше' }
                ],
                ariaLabel: 'Порядок сортировки',
                onChange: value => ctx.setParams({ order: value, page: 1 })
            }),
            h('button', {
                class: 'btn btn-secondary',
                type: 'button',
                text: 'Обновить',
                onClick: () => ctx.reload()
            })
        ])

        const body = h('div')
        root.replaceChildren(toolbar, body)

        await loadInto(body, () => api.users({
                page: state.page,
                limit: 25,
                search: state.search,
                sort: state.sort,
                order: state.order
            }), data => h('div', { class: 'stack' }, [
                h('div', { class: 'list-head' }, [
                    h('p', { class: 'muted', text: `Найдено пользователей: ${formatNumber(data.total)}` }),
                    h('button', {
                        class: 'btn btn-secondary btn-small',
                        type: 'button',
                        text: 'Выгрузить CSV',
                        onClick: () => downloadCsv('users.csv', [
                            { key: 'id', label: 'ID' },
                            { key: 'email', label: 'Email' },
                            { key: 'name', label: 'Имя' },
                            { key: 'username', label: 'Логин' },
                            { key: 'role', label: 'Роль' },
                            { key: 'privilegeLevel', label: 'Тариф' },
                            { key: 'createdAt', label: 'Регистрация' },
                            { key: 'plants', label: 'Растений' },
                            { key: 'activePlants', label: 'Активных растений' },
                            { key: 'waterings', label: 'Поливов' },
                            { key: 'photos', label: 'Фото' },
                            { key: 'chatMessages', label: 'Сообщений' },
                            { key: 'pushSubscriptions', label: 'Push' },
                            { key: 'lastActivityAt', label: 'Последняя активность' }
                        ], data.items)
                    })
                ]),
                buildList(data, ctx)
            ]), 'Загружаем пользователей…')
    }
}
