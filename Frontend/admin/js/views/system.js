import { api } from '../api.js'
import { SITE_BASE } from '../config.js'
import { badge, card, grid, h, loadInto, openDialog, sectionTitle, statCard, table } from '../ui.js'
import { formatDateTime, formatNumber } from '../format.js'

const STATUS_LABELS = {
    pending: 'Запланирована',
    sending: 'Отправляется',
    sent: 'Отправлена',
    failed: 'Ошибка',
    canceled: 'Отменена'
}

const CONTAINER_STATE_LABELS = {
    running: 'работает',
    restarting: 'перезапускается',
    paused: 'пауза',
    exited: 'остановлен',
    dead: 'dead',
    created: 'создан',
    pending: 'ожидает запуска',
    completed: 'завершён',
    removing: 'удаляется',
    unknown: 'неизвестно'
}

const LOGS_TAIL = 100

function formatUptime(seconds) {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value < 0) return '—'
    if (value < 60) return `${Math.floor(value)} с`
    const minutes = Math.floor(value / 60)
    if (minutes < 60) return `${minutes} мин`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} ч ${minutes % 60} мин`
    const days = Math.floor(hours / 24)
    return `${days} дн ${hours % 24} ч`
}

function containerStatusBadge(row) {
    const state = String(row.state || '').toLowerCase()
    const label = CONTAINER_STATE_LABELS[state] || state || 'неизвестно'
    let tone = 'neutral'
    if (state === 'running') tone = row.healthStatus === 'unhealthy' ? 'warning' : 'success'
    else if (state === 'restarting' || state === 'paused' || state === 'created' || state === 'removing') tone = 'warning'
    else if (state === 'pending') tone = row.problemLevel === 'error' ? 'danger' : 'warning'
    else if (state === 'completed') tone = 'success'
    else if (state === 'exited' || state === 'dead') tone = 'danger'
    return badge(label, tone)
}

function containerHealthBadge(row) {
    if (row.healthStatus === 'healthy') return badge('healthy', 'success')
    if (row.healthStatus === 'unhealthy') return badge('unhealthy', 'danger')
    if (row.healthStatus === 'starting') return badge('starting', 'warning')
    return h('span', { class: 'muted', text: '—' })
}

function problemsNotice(containers) {
    const problems = containers.filter(container =>
        container.problemLevel === 'error' || container.problemLevel === 'warn')
    if (!problems.length) return null

    const hasError = problems.some(container => container.problemLevel === 'error')
    return h('div', { class: `notice ${hasError ? 'notice-danger' : 'notice-warn'}` }, [
        h('p', { text: `Проблемы контейнеров: ${problems.length}` }),
        h('ul', { class: 'notice-list' }, problems.map(container => h('li', {
            text: `${container.name || container.id} — ${container.problem || 'причина не определена'}`
        })))
    ])
}

function dockerUnavailableNotice(error) {
    const payload = error?.payload && typeof error.payload === 'object' ? error.payload : null
    const reason = payload?.reason || null
    const serverMessage = typeof payload?.message === 'string' ? payload.message : ''

    const paragraphs = []
    if (reason === 'disabled') {
        paragraphs.push('Сбор статистики Docker выключен: DOCKER_STATS_ENABLED=false. ' +
            'В Kubernetes это ожидаемо — контейнеры живут в оркестраторе, а не в Docker-демоне, доступном backend.')
        paragraphs.push('Что проверить: если статистика нужна, включите DOCKER_STATS_ENABLED и задайте DOCKER_HOST до docker-socket-proxy.')
    } else if (reason === 'not_configured') {
        paragraphs.push('DOCKER_HOST не задан, поэтому backend не знает, к какому Docker-демону подключаться.')
        paragraphs.push('Что проверить: DOCKER_HOST=tcp://docker-socket-proxy:2375 и сервис docker-socket-proxy с CONTAINERS=1.')
    } else if (reason === 'unreachable') {
        paragraphs.push('Docker-демон не отвечает по DOCKER_HOST: соединение с docker-socket-proxy не установлено.')
        paragraphs.push('Что проверить: запущен ли docker-socket-proxy и его порт 2375, ' +
            'не блокирует ли соединение сеть/firewall, доступен ли DOCKER_HOST из контейнера backend.')
    } else {
        paragraphs.push('Docker недоступен в этом окружении — статистика и логи контейнеров не собраны.')
        paragraphs.push('Что проверить: DOCKER_STATS_ENABLED, DOCKER_HOST и доступность Docker-демона (docker ps).')
    }

    return h('div', { class: 'notice notice-warn' }, [
        h('p', { text: 'Состояние контейнеров: данные недоступны' }),
        ...paragraphs.map(text => h('p', { text })),
        serverMessage || error?.message
            ? h('p', { class: 'muted', text: `Ответ сервера: ${serverMessage || error?.message}` })
            : null
    ])
}

function showLogsDialog(container) {
    const logsNode = h('pre', { class: 'modal-details logs-details' })
    const statusNode = h('p', { class: 'muted', text: 'Загружаем последние логи…' })
    let dialog = null

    const closeButton = h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: 'Закрыть',
        onClick: () => dialog?.close('close-button')
    })

    dialog = openDialog({
        title: `Логи контейнера ${container.name || container.id}`,
        description: `stdout + stderr, последние ${LOGS_TAIL} строк, без timestamps`,
        wide: true,
        children: [statusNode, logsNode],
        actions: [closeButton],
        initialFocus: closeButton
    })

    api.dockerLogs(container.id, LOGS_TAIL)
        .then(result => {
            const logs = String(result?.logs || '').trim()
            if (!logs) {
                statusNode.textContent = 'Лог пуст: контейнер ещё ничего не выводил.'
                return
            }
            statusNode.textContent = `Символов: ${logs.length}`
            logsNode.textContent = logs
        })
        .catch(error => {
            statusNode.textContent = `Не удалось загрузить логи: ${error?.message || 'неизвестная ошибка'}`
        })
}

function containersTable(containers, { withNode = false } = {}) {
    const columns = [
        { key: 'name', label: 'Контейнер' },
        { key: 'service', label: 'Сервис', render: row => row.service || '—' }
    ]

    if (withNode) {
        columns.push({ key: 'node', label: 'Узел', render: row => row.node || '—' })
    }

    columns.push(
        { key: 'state', label: 'Статус', render: containerStatusBadge },
        { key: 'healthStatus', label: 'Здоровье', render: containerHealthBadge },
        { key: 'restartCount', label: 'Перезапуски', align: 'right', render: row => row.restartCount || 0 },
        {
            key: 'uptimeSeconds',
            label: 'Uptime',
            align: 'right',
            render: row => row.state === 'running' ? formatUptime(row.uptimeSeconds) : '—'
        }
    )

    if (withNode) {
        columns.push({
            key: 'status',
            label: 'Готовность',
            render: row => row.status || '—'
        })
    } else {
        columns.push(
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
            }
        )
    }

    columns.push(
        { key: 'problem', label: 'Причина', render: row => row.problem || '—' },
        {
            key: 'logs',
            label: 'Логи',
            render: row => h('button', {
                class: 'btn btn-ghost btn-small',
                type: 'button',
                text: 'Логи',
                onClick: () => showLogsDialog(row)
            })
        }
    )

    return table({
        columns,
        rows: containers,
        emptyText: 'Контейнеры не найдены'
    })
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

function dockerPartNotice(part) {
    if (!part || part.available) return null
    return dockerUnavailableNotice({ payload: part, message: part.message })
}

function kubernetesUnavailableNotice(error) {
    if (!error) return null
    return h('div', { class: 'notice notice-warn' }, [
        h('p', { text: 'Поды Kubernetes недоступны' }),
        h('p', { text: error.message || 'Не удалось прочитать список подов через API кластера.' }),
        h('p', {
            class: 'muted',
            text: 'Проверьте Role webplant-backend-pods и токен ServiceAccount: ' +
                'kubectl auth can-i list pods -n webplant ' +
                '--as=system:serviceaccount:webplant:webplant-backend'
        })
    ])
}

function serverSection(health, docker, dockerError, onRefresh) {
    const isKubernetes = docker?.source === 'kubernetes'
    const containers = docker?.containers || []
    const summary = docker?.summary || null
    const compose = isKubernetes ? (docker?.docker || null) : null
    const kubernetesError = !isKubernetes ? (docker?.kubernetes || null) : null
    const dockerAvailable = Boolean(docker)

    const stoppedStates = new Set(['exited', 'dead', 'created', 'removing'])
    const total = summary?.total ?? containers.length
    const running = summary?.running ?? containers.filter(container => container.state === 'running').length
    const stopped = summary?.stopped ?? containers.filter(container => stoppedStates.has(container.state)).length
    const completed = summary?.completed ?? containers.filter(container => container.state === 'completed').length
    const problems = summary?.problems ?? containers.filter(container =>
        container.problemLevel === 'error' || container.problemLevel === 'warn').length
    const healthy = summary?.healthy ?? containers.filter(container =>
        container.state === 'running' && container.problemLevel === 'ok').length
    const restarting = summary?.restarting ?? containers.filter(container => container.state === 'restarting').length

    const refreshButton = h('button', {
        class: 'btn btn-secondary btn-small',
        type: 'button',
        text: 'Обновить',
        onClick: () => {
            if (typeof onRefresh === 'function') onRefresh()
        }
    })

    const containersBody = dockerAvailable
        ? containersTable(containers, { withNode: isKubernetes })
        : h('p', { class: 'muted', text: 'Список контейнеров недоступен — смотрите пояснение выше.' })

    const composeCard = isKubernetes && compose
        ? card(
            'Контейнеры compose (Docker)',
            compose.available
                ? 'Второй контур: nginx, certbot, postgres, redis, backup'
                : 'Docker недоступен — статистика compose не собрана',
            compose.available
                ? containersTable(compose.containers)
                : (dockerPartNotice(compose) || h('p', { class: 'muted', text: 'Список контейнеров недоступен.' }))
        )
        : null

    return h('div', { class: 'stack' }, [
        sectionTitle(
            'Состояние сервисов',
            isKubernetes
                ? 'Kubernetes: поды namespace webplant и контейнеры compose'
                : 'Docker: контейнеры, healthcheck и причины остановки'
        ),
        grid(4, [
            statCard({
                label: isKubernetes ? 'Всего подов' : 'Всего контейнеров',
                value: dockerAvailable ? total : '—',
                hint: 'Включая остановленные',
                tone: 'accent'
            }),
            statCard({
                label: 'Работают',
                value: dockerAvailable ? running : '—',
                hint: dockerAvailable ? `healthy: ${healthy}` : 'данных нет',
                tone: 'accent'
            }),
            statCard({
                label: isKubernetes ? 'Завершены' : 'Остановлены',
                value: dockerAvailable ? (isKubernetes ? `${completed} / ${stopped}` : stopped) : '—',
                hint: isKubernetes
                    ? `завершены / остановлены, restarting: ${restarting}`
                    : `restarting: ${restarting}`,
                tone: stopped > 0 ? 'warning' : undefined
            }),
            statCard({
                label: 'Проблемы',
                value: dockerAvailable ? problems : '—',
                hint: 'healthcheck, OOM, код выхода',
                tone: problems > 0 ? 'danger' : undefined
            })
        ]),

        dockerError
            ? dockerUnavailableNotice(dockerError)
            : problemsNotice(containers),

        kubernetesUnavailableNotice(kubernetesError),

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

        card(
            isKubernetes ? 'Поды Kubernetes' : 'Контейнеры',
            isKubernetes
                ? 'Готовность, перезапуски и причины, по которым под не стартует'
                : 'Docker: состояние сервисов и нагрузка',
            containersBody,
            refreshButton
        ),

        composeCard
    ])
}

async function loadServerState() {
    const [push, health] = await Promise.all([api.pushOverview(), api.health()])
    let docker = null
    let dockerError = null
    try {
        docker = await api.dockerStats()
    } catch (error) {
        dockerError = error
    }
    return { push, health, docker, dockerError }
}

export const systemView = {
    id: 'system',
    title: 'Рассылки и сервер',
    subtitle: 'Push-уведомления, состояние API, Redis, Kubernetes и Docker',
    async render(root) {
        const loader = () => loadServerState()
        const builder = data => h('div', { class: 'stack' }, [
            pushSection(data.push),
            serverSection(data.health, data.docker, data.dockerError,
                () => loadInto(root, loader, builder, 'Обновляем состояние сервера…'))
        ])
        await loadInto(root, loader, builder, 'Загружаем состояние сервера…')
    }
}
