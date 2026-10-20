
const TIME_ZONE = 'Europe/Moscow'

const numberFormatter = new Intl.NumberFormat('ru-RU')
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
})
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
})

export function formatNumber(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return '0'
    return numberFormatter.format(parsed)
}

export function formatDateTime(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return dateTimeFormatter.format(date)
}

export function formatDate(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return dateFormatter.format(date)
}

export function formatShortDay(value) {
    if (!value) return ''
    const parts = String(value).slice(0, 10).split('-')
    if (parts.length !== 3) return String(value)
    return `${parts[2]}.${parts[1]}`
}

export function formatPercent(part, total) {
    const totalValue = Number(total)
    if (!totalValue) return '0%'
    const value = (Number(part) / totalValue) * 100
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

export function plural(count, forms) {
    const value = Math.abs(Number(count)) % 100
    const last = value % 10
    if (value > 10 && value < 20) return forms[2]
    if (last > 1 && last < 5) return forms[1]
    if (last === 1) return forms[0]
    return forms[2]
}

export function timeAgo(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    const diff = Date.now() - date.getTime()
    if (diff < 0) return formatDateTime(value)

    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'только что'
    if (minutes < 60) return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])} назад`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} ${plural(hours, ['час', 'часа', 'часов'])} назад`
    const days = Math.floor(hours / 24)
    if (days < 31) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`
    return formatDate(value)
}

export function truncate(text, max = 120) {
    const value = String(text ?? '')
    return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function maskEmail(value) {
    const text = String(value ?? '').trim()
    const at = text.indexOf('@')
    if (at <= 0) return text
    const local = text.slice(0, at)
    const domain = text.slice(at + 1)
    if (!domain) return text
    const visible = local.slice(0, Math.min(1, local.length))
    return `${visible}***@${domain}`
}

export function debounce(fn, delay = 350) {
    let timer = null
    return (...args) => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
            timer = null
            fn(...args)
        }, delay)
    }
}

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/

export function csvCell(value) {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    let text = String(value)
    if (CSV_FORMULA_PREFIX.test(text)) text = `'${text}`
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function downloadCsv(filename, columns, rows) {
    const header = columns.map(column => csvCell(column.label)).join(';')
    const body = rows.map(row => columns
        .map(column => csvCell(column.value ? column.value(row) : row[column.key]))
        .join(';')
    ).join('\r\n')

    const blob = new Blob([`\uFEFF${header}\r\n${body}`], {
        type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
