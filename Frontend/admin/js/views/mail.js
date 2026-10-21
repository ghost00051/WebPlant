import { api } from '../api.js'
import { SITE_BASE } from '../config.js'
import { badge, card, grid, h, loadInto, statCard, table } from '../ui.js'
import { formatDateTime, formatNumber, truncate } from '../format.js'

const STATUS_LABELS = {
    pending: 'Запланирована',
    sending: 'Отправляется',
    sent: 'Отправлена',
    failed: 'Ошибка',
    canceled: 'Отменена'
}

function statusTone(status) {
    if (status === 'sent') return 'success'
    if (status === 'failed') return 'danger'
    if (status === 'canceled') return 'neutral'
    return 'warning'
}

function mailSection(overview) {
    const { mailConfigured, mailStatus, mailProblems, from, users, broadcasts, totals, recent } = overview

    const notices = []
    if (!mailConfigured) {
        notices.push(h('div', { class: 'notice notice-warn' }, [
            h('p', {
                text: mailStatus === 'disabled'
                    ? 'Отправка писем выключена вручную (MAIL_ENABLED=false). Рассылки из админки недоступны.'
                    : 'SMTP не настроен: не заданы SMTP_USER и SMTP_PASSWORD. Рассылки писем и сброс пароля ' +
                        'сейчас недоступны.'
            })
        ]))
    } else if (Array.isArray(mailProblems) && mailProblems.length > 0) {
        notices.push(h('div', { class: 'notice notice-warn' }, [
            h('p', { text: 'Настройки почты требуют внимания:' }),
            h('ul', {}, mailProblems.map(problem => h('li', { text: problem })))
        ]))
    }

    return h('div', { class: 'stack' }, [
        ...notices,
        grid(4, [
            statCard({
                label: 'Почта',
                value: mailConfigured ? 'настроена' : (mailStatus === 'disabled' ? 'выключена' : 'не настроена'),
                hint: from ? `от: ${from}` : '',
                tone: mailConfigured ? 'accent' : 'danger'
            }),
            statCard({
                label: 'Маркетинговая аудитория',
                value: formatNumber(users.subscribed ?? users.withEmail),
                hint: `отписались ${formatNumber(users.unsubscribed ?? 0)} · ` +
                    `без согласия ${formatNumber(users.withoutConsent ?? 0)} · ` +
                    `всего ${formatNumber(users.total)}`
            }),
            statCard({
                label: 'Писем отправлено',
                value: formatNumber(totals.sent),
                hint: 'за всё время'
            }),
            statCard({
                label: 'Ошибок доставки',
                value: formatNumber(totals.failed),
                hint: totals.skipped ? `пропущено адресов: ${formatNumber(totals.skipped)}` : 'за всё время'
            })
        ]),
        card('Рассылки писем', 'Запланированные и отправленные письма пользователям',
            table({
                columns: [
                    { key: 'id', label: 'ID', align: 'right' },
                    { key: 'subject', label: 'Тема', render: row => truncate(row.subject, 60) },
                    {
                        key: 'status',
                        label: 'Статус',
                        render: row => badge(STATUS_LABELS[row.status] || row.status, statusTone(row.status))
                    },
                    {
                        key: 'target_mode',
                        label: 'Аудитория',
                        render: row => row.target_mode === 'all' ? 'все' : 'выбранные'
                    },
                    { key: 'sent_count', label: 'Доставлено', align: 'right' },
                    { key: 'failed_count', label: 'Ошибок', align: 'right' },
                    {
                        key: 'scheduled_for',
                        label: 'Отправка',
                        render: row => formatDateTime(row.sent_at || row.scheduled_for || row.created_at)
                    }
                ],
                rows: recent,
                emptyText: 'Рассылок писем ещё не было'
            }),
            h('div', { class: 'row-actions' }, [
                h('a', {
                    class: 'btn btn-primary',
                    href: `${SITE_BASE}/edit-profile`,
                    target: '_blank',
                    rel: 'noreferrer',
                    text: 'Создать рассылку на сайте'
                })
            ])),
        card('Состояние очереди', 'Сколько рассылок в каком статусе',
            grid(4, [
                statCard({ label: 'Всего рассылок', value: formatNumber(broadcasts.total) }),
                statCard({ label: 'Запланировано', value: formatNumber(broadcasts.pending) }),
                statCard({ label: 'Отправляется', value: formatNumber(broadcasts.sending) }),
                statCard({ label: 'С ошибкой', value: formatNumber(broadcasts.failed), tone: broadcasts.failed ? 'danger' : undefined })
            ]))
    ])
}

export const mailView = {
    id: 'mail',
    title: 'Почта',
    subtitle: 'SMTP, аудитория и рассылки писем',
    async render(root) {
        await loadInto(root, () => api.mailOverview(), mailSection, 'Загружаем состояние почты…')
    }
}
