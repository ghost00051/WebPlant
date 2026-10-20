import { api } from '../api.js'
import { SITE_BASE } from '../config.js'
import { badge, card, grid, h, loadInto, statCard, table } from '../ui.js'
import { formatDateTime, formatNumber } from '../format.js'

const STATUS_LABELS = {
    pending: 'Запланирована',
    sending: 'Отправляется',
    sent: 'Отправлена',
    failed: 'Ошибка',
    canceled: 'Отменена'
}

function pushSection(overview) {
    const { subscriptions, users, recent, pushConfigured } = overview

    return h('div', { class: 'stack' }, [
        !pushConfigured
            ? h('div', { class: 'notice notice-warn' }, [
                h('p', { text: 'Push-уведомления не настроены: не заданы VAPID_SUBJECT, VAPID_PUBLIC_KEY ' +
                    'и VAPID_PRIVATE_KEY. Мгновенные рассылки сейчас недоступны.' })
            ])
            : null,
        grid(4, [
            statCard({ label: 'Push-подписок', value: formatNumber(subscriptions.total), tone: 'accent' }),
            statCard({ label: 'Пользователей с push', value: formatNumber(subscriptions.users) }),
            statCard({ label: 'Гостевых подписок', value: formatNumber(subscriptions.guests) }),
            statCard({ label: 'Всего пользователей', value: formatNumber(users.total) })
        ]),
        card('Последние рассылки', 'Пять последних созданных рассылок',
            table({
                columns: [
                    { key: 'id', label: 'ID', align: 'right' },
                    { key: 'title', label: 'Заголовок' },
                    {
                        key: 'status',
                        label: 'Статус',
                        render: row => badge(
                            STATUS_LABELS[row.status] || row.status,
                            row.status === 'sent' ? 'success'
                                : row.status === 'failed' ? 'danger'
                                    : row.status === 'canceled' ? 'neutral' : 'warning'
                        )
                    },
                    { key: 'target_mode', label: 'Аудитория', render: row => row.target_mode === 'all' ? 'все' : 'выбранные' },
                    { key: 'sent_count', label: 'Доставлено', align: 'right' },
                    { key: 'failed_count', label: 'Ошибок', align: 'right' },
                    {
                        key: 'scheduled_for',
                        label: 'Отправка',
                        render: row => formatDateTime(row.sent_at || row.scheduled_for || row.created_at)
                    }
                ],
                rows: recent,
                emptyText: 'Рассылок ещё не было'
            }),
            h('div', { class: 'row-actions' }, [
                h('a', {
                    class: 'btn btn-primary',
                    href: `${SITE_BASE}/edit-profile`,
                    target: '_blank',
                    rel: 'noreferrer',
                    text: 'Создать рассылку на сайте'
                })
            ]))
    ])
}

function serverSection(health, docker) {
    const containers = docker?.containers || []

    return h('div', { class: 'stack' }, [
        grid(4, [
            statCard({
                label: 'API',
                value: health.status === 'ok' ? 'работает' : 'недоступен',
                hint: health.deployTarget ? `окружение: ${health.deployTarget}` : '',
                tone: health.status === 'ok' ? 'accent' : 'danger'
            }),
            statCard({
                label: 'Redis',
                value: health.redis || 'не задан',
                hint: 'Кэш ИИ, локи cron и общий rate-limit'
            }),
            statCard({
                label: 'Фоновые задачи',
                value: health.backgroundJobs ? 'включены' : 'выключены',
                hint: 'Напоминания, рассылки, очистка'
            }),
            statCard({
                label: 'Проверено',
                value: formatDateTime(health.timestamp),
                hint: 'Время ответа /health'
            })
        ]),

        health.aiCache
            ? card('Кэш ответов ИИ', 'Статистика локального кэша', h('pre', {
                class: 'code',
                text: JSON.stringify(health.aiCache, null, 2)
            }))
            : null,

        card('Контейнеры', docker === null
            ? 'Docker недоступен в этом окружении'
            : 'Нагрузка на сервисы (docker stats)',
        docker === null
            ? h('p', { class: 'muted', text: 'DOCKER_HOST не задан или Docker недоступен — раздел пропущен.' })
            : table({
                columns: [
                    { key: 'name', label: 'Контейнер' },
                    { key: 'state', label: 'Состояние' },
                    { key: 'image', label: 'Образ' },
                    {
                        key: 'cpu',
                        label: 'CPU, %',
                        align: 'right',
                        render: row => row.statsAvailable ? `${row.cpu}` : '—'
                    },
                    {
                        key: 'memory',
                        label: 'Память',
                        align: 'right',
                        render: row => row.statsAvailable
                            ? `${(row.memory.usage / 1024 / 1024).toFixed(1)} МБ (${row.memory.percent}%)`
                            : '—'
                    },
                    {
                        key: 'network',
                        label: 'Сеть RX/TX',
                        align: 'right',
                        render: row => row.statsAvailable
                            ? `${(row.network.rx / 1024 / 1024).toFixed(1)} / ${(row.network.tx / 1024 / 1024).toFixed(1)} МБ`
                            : '—'
                    }
                ],
                rows: containers,
                emptyText: 'Контейнеры не найдены'
            }))
    ])
}

export const systemView = {
    id: 'system',
    title: 'Рассылки и сервер',
    subtitle: 'Push-уведомления, состояние API, Redis и Docker',
    async render(root) {
        await loadInto(root, async () => {
            const [push, health] = await Promise.all([api.pushOverview(), api.health()])
            let docker
            try {
                docker = await api.dockerStats()
            } catch {
                docker = null
            }
            return { push, health, docker }
        }, ({ push, health, docker }) => h('div', { class: 'stack' }, [
            pushSection(push),
            serverSection(health, docker)
        ]), 'Загружаем состояние сервера…')
    }
}
