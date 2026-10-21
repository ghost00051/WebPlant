
const SVG_NS = 'http://www.w3.org/2000/svg'

export const PALETTE = ['#3fae6a', '#4f8ef7', '#f2a33c', '#e05c5c', '#9b6ce0', '#2fb6b0', '#c9a227']

function chartWidth() {
    const viewport = Number(window?.innerWidth) || 1024
    return Math.max(300, Math.min(720, viewport - 80))
}

export function gridChartWidth(contentWidth) {
    const width = Number(contentWidth) > 0 ? Number(contentWidth) : chartWidth()
    const card = width >= 700 ? (width - 14) / 2 : width
    return Math.max(260, Math.round(card - 32))
}

function isNarrow(width) {
    return width < 520
}

let chartSeq = 0

function node(tag, attrs = {}, children = []) {
    const element = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue
        element.setAttribute(key, String(value))
    }
    for (const child of [].concat(children)) {
        if (!child) continue
        element.appendChild(child)
    }
    return element
}

function text(content, attrs = {}) {
    const element = node('text', attrs)
    element.textContent = String(content ?? '')
    return element
}

function titleNode(content) {
    const element = node('title')
    element.textContent = String(content ?? '')
    return element
}

export function niceMax(value) {
    const max = Number(value)
    if (!Number.isFinite(max) || max <= 0) return 1
    const power = Math.pow(10, Math.floor(Math.log10(max)))
    const normalized = max / power
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
    return step * power
}

function emptyChart(message = 'Нет данных за период') {
    const wrapper = document.createElement('div')
    wrapper.className = 'chart-empty'
    wrapper.textContent = message
    return wrapper
}

function legend(series) {
    const wrapper = document.createElement('div')
    wrapper.className = 'chart-legend'
    for (const item of series) {
        const entry = document.createElement('span')
        entry.className = 'chart-legend-item'
        const dot = document.createElement('i')
        dot.className = 'chart-legend-dot'
        dot.style.background = item.color
        const label = document.createElement('span')
        label.textContent = item.name
        entry.append(dot, label)
        wrapper.appendChild(entry)
    }
    return wrapper
}

function xTickIndexes(count, desired = 6) {
    if (count <= desired) return Array.from({ length: count }, (_, index) => index)
    const step = Math.ceil(count / desired)
    const indexes = []
    for (let index = 0; index < count; index += step) indexes.push(index)
    if (indexes[indexes.length - 1] !== count - 1) indexes.push(count - 1)
    return indexes
}

function cellText(value) {
    if (value === null || value === undefined || value === '') return '—'
    return String(value)
}

function dataTable({ columns, rows, label = 'Данные графика' }) {
    chartSeq += 1
    const id = `chart-data-table-${chartSeq}`

    const wrapper = document.createElement('div')
    wrapper.className = 'chart-table'
    wrapper.id = id
    wrapper.tabIndex = 0
    wrapper.setAttribute('role', 'region')
    wrapper.setAttribute('aria-label', label)
    wrapper.hidden = true

    const tableEl = document.createElement('table')
    tableEl.className = 'table table-compact'
    tableEl.setAttribute('aria-label', label)

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const column of columns) {
        const th = document.createElement('th')
        th.setAttribute('scope', 'col')
        if (column.align) th.className = `align-${column.align}`
        th.textContent = column.label
        headRow.appendChild(th)
    }
    thead.appendChild(headRow)

    const tbody = document.createElement('tbody')
    for (const row of rows) {
        const tr = document.createElement('tr')
        for (const column of columns) {
            const td = document.createElement('td')
            if (column.align) td.className = `align-${column.align}`
            const value = column.value ? column.value(row) : row[column.key]
            td.textContent = cellText(value)
            tr.appendChild(td)
        }
        tbody.appendChild(tr)
    }

    tableEl.append(thead, tbody)
    wrapper.appendChild(tableEl)
    return { id, node: wrapper }
}

function tableToggle(table) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-ghost btn-small chart-toggle'
    button.textContent = 'Показать таблицей'
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-controls', table.id)
    button.addEventListener('click', () => {
        const expanded = table.node.hidden
        table.node.hidden = !expanded
        button.setAttribute('aria-expanded', String(expanded))
        button.textContent = expanded ? 'Скрыть таблицу' : 'Показать таблицей'
    })
    return button
}

function svgChart(children, { width, height, title, className = 'chart-svg' }) {
    if (title) children.unshift(titleNode(title))
    return node('svg', {
        viewBox: `0 0 ${width} ${height}`,
        class: className,
        role: 'img',
        'aria-label': title || null
    }, children)
}

function assemble({ svg, legendNode, title, table }) {
    const wrapper = document.createElement('div')
    wrapper.className = 'chart'
    wrapper.appendChild(svg)
    if (legendNode) wrapper.appendChild(legendNode)
    if (table) {
        const info = dataTable({ ...table, caption: title || 'Данные графика' })
        wrapper.appendChild(tableToggle(info))
        wrapper.appendChild(info.node)
    }
    return wrapper
}

export function lineChart({
    series,
    height = 240,
    width: requestedWidth = 0,
    title = '',
    table = null,
    formatValue = value => value,
    formatX = value => value
}) {
    const valid = (series || []).filter(item => item.points && item.points.length)
    if (!valid.length) return emptyChart()

    const width = Number(requestedWidth) > 0 ? Math.max(260, Math.min(1200, Number(requestedWidth))) : chartWidth()
    const narrow = isNarrow(width)
    const padding = narrow
        ? { top: 16, right: 10, bottom: 26, left: 36 }
        : { top: 18, right: 18, bottom: 30, left: 46 }
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom
    const count = Math.max(...valid.map(item => item.points.length))
    const maxValue = niceMax(Math.max(...valid.flatMap(item => item.points.map(point => Number(point.y) || 0))))

    const xAt = index => padding.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth)
    const yAt = value => padding.top + plotHeight - ((Number(value) || 0) / maxValue) * plotHeight

    const children = []

    const defs = node('defs')
    valid.forEach((item, index) => {
        const gradient = node('linearGradient', {
            id: `chartFill${index}`,
            x1: '0', y1: '0', x2: '0', y2: '1'
        }, [
            node('stop', { offset: '0%', 'stop-color': item.color, 'stop-opacity': '0.28' }),
            node('stop', { offset: '100%', 'stop-color': item.color, 'stop-opacity': '0.01' })
        ])
        defs.appendChild(gradient)
    })
    children.push(defs)

    for (let step = 0; step <= 4; step++) {
        const value = (maxValue / 4) * step
        const y = yAt(value)
        children.push(node('line', {
            x1: padding.left, y1: y, x2: width - padding.right, y2: y,
            class: 'chart-grid'
        }))
        children.push(text(formatValue(value), {
            x: padding.left - 8, y: y + 4, class: 'chart-axis', 'text-anchor': 'end'
        }))
    }

    const basePoints = valid[0].points
    for (const index of xTickIndexes(basePoints.length, narrow ? 3 : 6)) {
        const label = basePoints[index] ? formatX(basePoints[index].x) : ''
        children.push(text(label, {
            x: xAt(index), y: height - 8, class: 'chart-axis', 'text-anchor': 'middle'
        }))
    }

    valid.forEach((item, seriesIndex) => {
        const points = item.points.map((point, index) => `${xAt(index)},${yAt(point.y)}`)
        const areaPath = `M ${padding.left},${padding.top + plotHeight} L ${points.join(' L ')} ` +
            `L ${xAt(item.points.length - 1)},${padding.top + plotHeight} Z`
        const linePath = `M ${points.join(' L ')}`

        children.push(node('path', { d: areaPath, fill: `url(#chartFill${seriesIndex})`, stroke: 'none' }))
        children.push(node('path', {
            d: linePath, fill: 'none', stroke: item.color, 'stroke-width': 2,
            'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }))

        if (item.points.length <= 45) {
            item.points.forEach((point, index) => {
                children.push(node('circle', {
                    cx: xAt(index), cy: yAt(point.y), r: 3.2,
                    fill: item.color, class: 'chart-dot'
                }, [titleNode(`${formatX(point.x)}: ${formatValue(point.y)}`)]))
            })
        } else {
            item.points.forEach((point, index) => {
                children.push(node('rect', {
                    x: xAt(index) - 6, y: padding.top, width: 12, height: plotHeight,
                    fill: 'transparent'
                }, [titleNode(`${formatX(point.x)}: ${formatValue(point.y)}`)]))
            })
        }
    })

    return assemble({
        svg: svgChart(children, { width, height, title }),
        legendNode: valid.length > 1 ? legend(valid) : null,
        title,
        table
    })
}

export function barChart({
    items,
    height = 220,
    width: requestedWidth = 0,
    title = '',
    table = null,
    color = PALETTE[1],
    formatValue = value => value
}) {
    const list = (items || []).filter(item => item)
    if (!list.length) return emptyChart()

    const width = Number(requestedWidth) > 0 ? Math.max(260, Math.min(1200, Number(requestedWidth))) : chartWidth()
    const narrow = isNarrow(width)
    const padding = narrow
        ? { top: 16, right: 10, bottom: 28, left: 36 }
        : { top: 18, right: 18, bottom: 34, left: 46 }
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom
    const maxValue = niceMax(Math.max(...list.map(item => Number(item.value) || 0)))
    const slot = plotWidth / list.length
    const barWidth = Math.max(4, Math.min(48, slot * 0.62))

    const children = []
    for (let step = 0; step <= 4; step++) {
        const value = (maxValue / 4) * step
        const y = padding.top + plotHeight - (value / maxValue) * plotHeight
        children.push(node('line', { x1: padding.left, y1: y, x2: width - padding.right, y2: y, class: 'chart-grid' }))
        children.push(text(formatValue(value), { x: padding.left - 8, y: y + 4, class: 'chart-axis', 'text-anchor': 'end' }))
    }

    list.forEach((item, index) => {
        const value = Number(item.value) || 0
        const barHeight = (value / maxValue) * plotHeight
        const x = padding.left + slot * index + (slot - barWidth) / 2
        const y = padding.top + plotHeight - barHeight
        children.push(node('rect', {
            x, y, width: barWidth, height: Math.max(0, barHeight),
            rx: Math.min(6, barWidth / 2),
            fill: item.color || color,
            class: 'chart-bar'
        }, [titleNode(`${item.label}: ${formatValue(value)}`)]))

        if (list.length <= (narrow ? 12 : 24)) {
            children.push(text(item.label, {
                x: x + barWidth / 2, y: height - 12, class: 'chart-axis', 'text-anchor': 'middle'
            }))
        }
    })

    return assemble({
        svg: svgChart(children, { width, height, title }),
        title,
        table
    })
}

export function hBarChart({ items, formatValue = value => value, max: explicitMax, title = '' }) {
    const list = (items || []).filter(item => item)
    if (!list.length) return emptyChart()

    const max = explicitMax || Math.max(...list.map(item => Number(item.value) || 0), 1)

    const wrapper = document.createElement('div')
    wrapper.className = 'hbar'
    if (title) {
        wrapper.setAttribute('role', 'group')
        wrapper.setAttribute('aria-label', title)
    }

    for (const item of list) {
        const value = Number(item.value) || 0
        const row = document.createElement('div')
        row.className = 'hbar-row'

        const label = document.createElement('span')
        label.className = 'hbar-label'
        label.textContent = item.label
        label.title = item.hint || item.label

        const track = document.createElement('span')
        track.className = 'hbar-track'
        const fill = document.createElement('span')
        fill.className = 'hbar-fill'
        fill.style.width = `${Math.max(2, (value / max) * 100)}%`
        fill.style.background = item.color || PALETTE[0]
        track.appendChild(fill)

        const amount = document.createElement('span')
        amount.className = 'hbar-value'
        amount.textContent = formatValue(value)

        row.append(label, track, amount)
        wrapper.appendChild(row)
    }

    return wrapper
}

export function donutChart({
    items,
    size = 190,
    title = '',
    table = null,
    centerValue = '',
    centerLabel = ''
}) {
    const list = (items || []).filter(item => Number(item.value) > 0)
    if (!list.length) return emptyChart()

    const total = list.reduce((sum, item) => sum + Number(item.value), 0)
    const radius = size / 2 - 12
    const stroke = 22
    const circumference = 2 * Math.PI * radius
    let offset = 0

    const children = [
        node('circle', {
            cx: size / 2, cy: size / 2, r: radius,
            fill: 'none', stroke: 'var(--chart-track)', 'stroke-width': stroke
        })
    ]

    list.forEach((item, index) => {
        const value = Number(item.value)
        const length = (value / total) * circumference
        children.push(node('circle', {
            cx: size / 2, cy: size / 2, r: radius,
            fill: 'none',
            stroke: item.color || PALETTE[index % PALETTE.length],
            'stroke-width': stroke,
            'stroke-dasharray': `${length} ${circumference - length}`,
            'stroke-dashoffset': -offset,
            transform: `rotate(-90 ${size / 2} ${size / 2})`
        }, [titleNode(`${item.label}: ${value}`)]))
        offset += length
    })

    if (centerValue !== '' || centerLabel) {
        children.push(text(centerValue, {
            x: size / 2, y: size / 2, class: 'chart-center-value', 'text-anchor': 'middle'
        }))
        children.push(text(centerLabel, {
            x: size / 2, y: size / 2 + 18, class: 'chart-center-label', 'text-anchor': 'middle'
        }))
    }

    const svg = svgChart(children, { width: size, height: size, title })
    const legendNode = legend(list.map((item, index) => ({
        name: item.label,
        color: item.color || PALETTE[index % PALETTE.length]
    })))

    if (!table) {
        const wrapper = document.createElement('div')
        wrapper.className = 'chart chart-donut'
        wrapper.append(svg, legendNode)
        return wrapper
    }

    const row = document.createElement('div')
    row.className = 'chart-donut-row'
    row.append(svg, legendNode)

    const wrapper = document.createElement('div')
    wrapper.className = 'chart'
    wrapper.appendChild(row)
    const info = dataTable({ ...table, caption: title || 'Данные графика' })
    wrapper.appendChild(tableToggle(info))
    wrapper.appendChild(info.node)
    return wrapper
}
