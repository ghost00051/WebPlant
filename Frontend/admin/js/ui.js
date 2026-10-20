import { isCanceled } from './api.js'

export function h(tag, props = {}, children = []) {
    const node = document.createElement(tag)

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue
        if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value
        else if (key === 'text') node.textContent = String(value)
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
        else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value)
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value)
        } else if (value === true) node.setAttribute(key, '')
        else node.setAttribute(key, String(value))
    }

    append(node, children)
    return node
}

export function append(parent, children) {
    const list = Array.isArray(children) ? children : [children]
    for (const child of list) {
        if (child === null || child === undefined || child === false) continue
        parent.appendChild(typeof child === 'object' && child.nodeType ? child : document.createTextNode(String(child)))
    }
    return parent
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
    return node
}

export function card(title, subtitle, children, extra) {
    return h('section', { class: 'card' }, [
        (title || subtitle || extra) && h('header', { class: 'card-head' }, [
            h('div', {}, [
                title && h('h2', { class: 'card-title', text: title }),
                subtitle && h('p', { class: 'card-subtitle', text: subtitle })
            ]),
            extra || null
        ]),
        h('div', { class: 'card-body' }, children)
    ])
}

export function statCard({ label, value, hint, tone, badge }) {
    return h('article', { class: ['stat', tone ? `stat-${tone}` : null] }, [
        h('p', { class: 'stat-label', text: label }),
        h('p', { class: 'stat-value' }, [
            String(value ?? 0),
            badge ? h('span', { class: 'stat-badge', text: badge }) : null
        ]),
        hint ? h('p', { class: 'stat-hint', text: hint }) : null
    ])
}

export function pill(text, tone = 'neutral') {
    return h('span', { class: `pill pill-${tone}`, text })
}

export function spinner(text = 'Загружаем данные…') {
    return h('div', { class: 'state state-loading', role: 'status', 'aria-live': 'polite' }, [
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('span', { text })
    ])
}

export function emptyState(text) {
    return h('div', { class: 'state state-empty', text })
}

export function errorState(message, onRetry) {
    return h('div', { class: 'state state-error', role: 'alert' }, [
        h('p', { text: message }),
        onRetry ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: onRetry, text: 'Повторить' }) : null
    ])
}

export function table({ columns, rows, emptyText = 'Нет данных', onRowClick, label = 'Таблица данных' }) {
    if (!rows.length) return emptyState(emptyText)

    const head = h('thead', {}, [
        h('tr', {}, columns.map(column => h('th', {
            class: column.align ? `align-${column.align}` : null,
            style: column.width ? { width: column.width } : null,
            scope: 'col',
            'aria-sort': column.ariaSort || null
        }, column.label
            ? [String(column.label)]
            : [h('span', { class: 'sr-only', text: column.emptyLabel || 'Действия' })])))
    ])

    const body = h('tbody', {}, rows.map((row, index) => h('tr', {
        class: onRowClick ? 'row-clickable' : null,
        onClick: onRowClick ? event => onRowClick(row, event) : null
    }, columns.map(column => {
        const content = column.render ? column.render(row, index) : row[column.key]
        const dataset = { key: column.key || '' }
        if (column.label) dataset.label = column.label
        return h('td', {
            class: column.align ? `align-${column.align}` : null,
            dataset
        }, content === null || content === undefined || content === '' ? '—' : content)
    }))))

    return h('div', {
        class: 'table-wrap',
        tabindex: '0',
        role: 'region',
        'aria-label': label
    }, [h('table', { class: 'table' }, [head, body])])
}

export function pagination({ page, pages, total, limit, onPage }) {
    if (!total) return null
    const from = (page - 1) * limit + 1
    const to = Math.min(page * limit, total)

    const button = (label, target, disabled) => h('button', {
        class: 'btn btn-ghost btn-small',
        type: 'button',
        disabled,
        text: label,
        onClick: () => onPage(target)
    })

    return h('div', { class: 'pagination' }, [
        h('span', { class: 'pagination-info', text: `${from}–${to} из ${total}` }),
        h('div', { class: 'pagination-controls' }, [
            button('‹', 1, page <= 1),
            button('Назад', page - 1, page <= 1),
            h('span', { class: 'pagination-page', text: `${page} / ${pages}` }),
            button('Вперёд', page + 1, page >= pages),
            button('›', pages, page >= pages)
        ])
    ])
}

export function searchInput({ value, placeholder, onInput, focusKey = 'search', label }) {
    const hint = label || placeholder || 'Поиск'
    return h('label', { class: 'search' }, [
        h('span', { class: 'search-icon', text: '⌕', 'aria-hidden': 'true' }),
        h('input', {
            type: 'search',
            value: value || '',
            placeholder: placeholder || 'Поиск',
            'aria-label': hint,
            dataset: { focusKey },
            onInput: event => onInput(event.target.value)
        })
    ])
}

export function select({ value, options, onChange, label, ariaLabel }) {
    const node = h('select', {
        class: 'select',
        'aria-label': ariaLabel || label || null,
        onChange: event => onChange(event.target.value)
    }, options.map(option => h('option', {
        value: option.value,
        text: option.label,
        selected: String(option.value) === String(value)
    })))

    return label ? h('label', { class: 'field' }, [h('span', { class: 'field-label', text: label }), node]) : node
}

export function toast(message, type = 'info') {
    let container = document.getElementById('adminToasts')
    if (!container) {
        container = h('div', { class: 'toasts', id: 'adminToasts' })
        document.body.appendChild(container)
    }

    const node = h('div', {
        class: `toast toast-${type}`,
        role: type === 'error' ? 'alert' : 'status',
        'aria-live': type === 'error' ? 'assertive' : 'polite'
    }, [
        h('span', { text: message })
    ])
    container.appendChild(node)
    window.setTimeout(() => node.classList.add('is-visible'), 10)
    window.setTimeout(() => {
        node.classList.remove('is-visible')
        window.setTimeout(() => node.remove(), 250)
    }, 4200)
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let dialogSeq = 0
let openDialogCount = 0
let savedBodyOverflow = ''

function focusableNodes(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    let nodes
    try {
        nodes = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
    } catch {
        return []
    }
    return nodes.filter(node => !node.disabled)
}

function lockBodyScroll() {
    if (openDialogCount === 0) {
        savedBodyOverflow = document.body.style.overflow || ''
        document.body.style.overflow = 'hidden'
    }
    openDialogCount += 1
}

function unlockBodyScroll() {
    openDialogCount = Math.max(0, openDialogCount - 1)
    if (openDialogCount === 0) document.body.style.overflow = savedBodyOverflow
}

export function openDialog({
    title,
    description = '',
    children = [],
    actions = null,
    wide = false,
    role = 'dialog',
    showClose = false,
    closeLabel = 'Закрыть',
    initialFocus = null,
    onClose = null
}) {
    dialogSeq += 1
    const titleId = `admin-dialog-title-${dialogSeq}`
    const descriptionId = description ? `admin-dialog-description-${dialogSeq}` : null
    const trigger = document.activeElement && document.activeElement.nodeType === 1
        ? document.activeElement
        : null

    const dialog = h('div', {
        class: ['modal', wide ? 'modal-wide' : null],
        role,
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descriptionId,
        tabindex: '-1'
    }, [
        h('div', { class: 'modal-head' }, [
            h('h3', { class: 'modal-title', id: titleId, text: title }),
            showClose ? h('button', {
                class: 'btn btn-ghost btn-small',
                type: 'button',
                text: closeLabel,
                onClick: () => close('close-button')
            }) : null
        ]),
        description ? h('p', { class: 'modal-text', id: descriptionId, text: description }) : null,
        ...children,
        actions ? h('div', { class: 'modal-actions' }, actions) : null
    ])

    const overlay = h('div', { class: 'modal-overlay' }, [dialog])

    let closed = false

    function close(reason = 'close') {
        if (closed) return
        closed = true
        document.removeEventListener('keydown', onKeyDown, true)
        overlay.remove()
        unlockBodyScroll()
        if (trigger && typeof trigger.focus === 'function') {
            try {
                trigger.focus()
            } catch {
                ;
            }
        }
        if (typeof onClose === 'function') onClose(reason)
    }

    function onKeyDown(event) {
        if (closed) return
        if (event.key === 'Escape') {
            event.preventDefault()
            close('escape')
            return
        }
        if (event.key !== 'Tab') return
        const nodes = focusableNodes(dialog)
        if (!nodes.length) {
            event.preventDefault()
            dialog.focus()
            return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        const inside = Boolean(active) && (active === dialog ||
            (typeof dialog.contains === 'function' && dialog.contains(active)))
        if (event.shiftKey) {
            if (!inside || active === first) {
                event.preventDefault()
                last.focus()
            }
        } else if (!inside || active === last) {
            event.preventDefault()
            first.focus()
        }
    }

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close('overlay')
    })
    document.addEventListener('keydown', onKeyDown, true)
    document.body.appendChild(overlay)
    lockBodyScroll()

    const target = initialFocus || focusableNodes(dialog)[0] || dialog
    if (target && typeof target.focus === 'function') {
        try {
            target.focus()
        } catch {
            ;
        }
    }

    return { overlay, dialog, close }
}

export function confirmDialog({
    title,
    message,
    details,
    confirmLabel = 'Удалить',
    cancelLabel = 'Отмена',
    danger = true,
    typedWord = ''
}) {
    return new Promise(resolve => {
        let dialog = null
        const finish = result => {
            if (dialog) dialog.close('result')
            resolve(result)
        }

        const confirmButton = h('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            type: 'button',
            text: confirmLabel,
            disabled: Boolean(typedWord),
            onClick: () => finish(true)
        })

        let input = null
        if (typedWord) {
            input = h('input', {
                class: 'input',
                type: 'text',
                placeholder: typedWord,
                autocomplete: 'off',
                'aria-label': `Введите ${typedWord} для подтверждения`,
                onInput: event => {
                    confirmButton.disabled = event.target.value.trim().toUpperCase() !== typedWord.toUpperCase()
                }
            })
        }

        dialog = openDialog({
            title,
            description: message,
            role: 'alertdialog',
            children: [
                details ? h('pre', { class: 'modal-details', text: details }) : null,
                typedWord ? h('p', { class: 'modal-hint', text: `Введите ${typedWord}, чтобы подтвердить` }) : null,
                input
            ],
            actions: [
                h('button', {
                    class: 'btn btn-ghost',
                    type: 'button',
                    text: cancelLabel,
                    onClick: () => finish(false)
                }),
                confirmButton
            ],
            initialFocus: input || confirmButton
        })
    })
}

export function barMeter(value, max, tone = 'accent') {
    const safeMax = Number(max) > 0 ? Number(max) : 1
    const percent = Math.min(100, Math.max(0, (Number(value) / safeMax) * 100))
    return h('span', { class: 'meter' }, [
        h('span', { class: `meter-fill meter-${tone}`, style: { width: `${percent}%` } })
    ])
}

export async function loadInto(root, loader, builder, loadingText) {
    clear(root)
    root.appendChild(spinner(loadingText))
    try {
        const data = await loader()
        clear(root)
        append(root, builder(data))
        return data
    } catch (error) {
        if (error?.status === 401 || isCanceled(error)) throw error
        clear(root)
        root.appendChild(errorState(
            error?.message || 'Не удалось загрузить данные',
            () => loadInto(root, loader, builder, loadingText)
        ))
        return null
    }
}

export function sectionTitle(title, subtitle) {
    return h('div', { class: 'section-head' }, [
        h('h2', { class: 'section-title', text: title }),
        subtitle ? h('p', { class: 'section-subtitle', text: subtitle }) : null
    ])
}

export function grid(columns, children) {
    return h('div', { class: `grid grid-${columns}` }, children)
}

export function badge(text, tone = 'neutral') {
    return h('span', { class: `badge badge-${tone}`, text })
}
