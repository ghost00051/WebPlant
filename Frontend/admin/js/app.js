import { api, ApiError, cancelPending, isCanceled, onUnauthorized } from './api.js'
import { API_BASE, DAY_RANGES } from './config.js'
import { clear, h, toast } from './ui.js'

const VIEWS = [
    {
        id: 'overview',
        title: 'Обзор',
        subtitle: 'Главные показатели «Лейки»',
        needsRange: true,
        load: () => import('./views/overview.js').then(module => module.overviewView)
    },
    {
        id: 'visitors',
        title: 'Посетители',
        subtitle: 'Уникальные визиты, просмотры, источники и устройства',
        needsRange: true,
        load: () => import('./views/visitors.js').then(module => module.visitorsView)
    },
    {
        id: 'users',
        title: 'Пользователи',
        subtitle: 'Кто зарегистрировался, сколько создал и когда заходил',
        load: () => import('./views/users.js').then(module => module.usersView)
    },
    {
        id: 'plants',
        title: 'Растения',
        subtitle: 'Все коллекции: владелец, расписание и история поливов',
        load: () => import('./views/resources.js').then(module => module.plantsView)
    },
    {
        id: 'waterings',
        title: 'Поливы',
        subtitle: 'Журнал отметок о поливе и пропусков',
        load: () => import('./views/resources.js').then(module => module.wateringsView)
    },
    {
        id: 'photos',
        title: 'Фотографии',
        subtitle: 'Загруженные фото растений',
        load: () => import('./views/resources.js').then(module => module.photosView)
    },
    {
        id: 'chat',
        title: 'Чат с ИИ',
        subtitle: 'История сообщений пользователей и ответов ассистента',
        load: () => import('./views/resources.js').then(module => module.chatView)
    },
    {
        id: 'system',
        title: 'Рассылки и сервер',
        subtitle: 'Push-уведомления, состояние API, Redis и Docker',
        load: () => import('./views/system.js').then(module => module.systemView)
    },
    {
        id: 'ai',
        title: 'Алиса и ИИ',
        subtitle: 'Обращения к модели, кэш, ошибки, задержки, бюджет и журнал подсказок',
        needsRange: true,
        load: () => import('./views/ai.js').then(module => module.aiView)
    }
]

const DAYS_STORAGE_KEY = 'webplant-admin-days'
const THEME_STORAGE_KEY = 'webplant-admin-theme'
const SEARCH_DEBOUNCE_MS = 350

const PRIVATE_PARAMS = new Set(['q'])

const memoryStorage = new Map()

function storageGet(key) {
    try {
        return window.localStorage.getItem(key)
    } catch {
        return memoryStorage.has(key) ? memoryStorage.get(key) : null
    }
}

function storageSet(key, value) {
    try {
        window.localStorage.setItem(key, value)
    } catch {
        memoryStorage.set(key, String(value))
    }
}

function storageAvailable() {
    try {
        const probe = '__webplant_admin_probe__'
        window.localStorage.setItem(probe, '1')
        window.localStorage.removeItem(probe)
        return true
    } catch {
        return false
    }
}

const state = {
    admin: null,
    days: Number(storageGet(DAYS_STORAGE_KEY)) || 30,
    params: {},
    viewId: 'overview',
    loading: false,
    storageBlocked: false,
    focusKey: null
}

const viewModules = new Map()
let searchTimer = null
let renderSeq = 0

function moscowToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date())
}

function shiftDay(day, offset) {
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
}

function rangeFor(days) {
    const to = moscowToday()
    return { from: shiftDay(to, -(days - 1)), to }
}

function prune(params) {
    const output = {}
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue
        output[key] = value
    }
    return output
}

function buildHash(viewId, params) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(prune(params))) {
        if (PRIVATE_PARAMS.has(key)) continue
        search.set(key, String(value))
    }
    const text = search.toString()
    return `#/${viewId}${text ? `?${text}` : ''}`
}

function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '')
    const [name, search] = raw.split('?')
    const viewId = VIEWS.some(view => view.id === name) ? name : 'overview'
    const params = {}
    const source = new URLSearchParams(search || '')
    source.forEach((value, key) => {
        if (PRIVATE_PARAMS.has(key)) return
        params[key] = value
    })
    const hasPrivate = Array.from(source.keys()).some(key => PRIVATE_PARAMS.has(key))
    if (hasPrivate) {
        try {
            window.history.replaceState(null, '', buildHash(viewId, params))
        } catch {
            ;
        }
    }
    return { viewId, params }
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme
    storageSet(THEME_STORAGE_KEY, theme)
}

function viewMeta(viewId) {
    return VIEWS.find(view => view.id === viewId) || VIEWS[0]
}

async function loadView(viewId) {
    if (!viewModules.has(viewId)) {
        viewModules.set(viewId, await viewMeta(viewId).load())
    }
    return viewModules.get(viewId)
}

function handleUnauthorized() {
    if (!state.admin) return
    state.admin = null
    renderLogin('Сессия истекла — войдите заново')
}

onUnauthorized(handleUnauthorized)

function renderLogin(message, tone = 'info') {
    const email = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'username', required: true })
    const password = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true })
    const remember = h('input', { type: 'checkbox', name: 'rememberMe' })
    const submit = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Войти' })

    const form = h('form', { class: 'login-form' }, [
        h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Email' }), email]),
        h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Пароль' }), password]),
        h('label', { class: 'checkbox' }, [remember, h('span', { text: 'Запомнить меня' })]),
        submit
    ])

    form.addEventListener('submit', async event => {
        event.preventDefault()
        submit.disabled = true
        submit.textContent = 'Проверяем…'
        try {
            await api.login(email.value.trim(), password.value, remember.checked)
            await boot()
        } catch (error) {
            if (isCanceled(error)) return
            toast(error.message || 'Не удалось войти', 'error')
            submit.disabled = false
            submit.textContent = 'Войти'
        }
    })

    const root = document.getElementById('app')
    clear(root)
    root.appendChild(h('div', { class: 'login-screen' }, [
        h('main', { class: 'login-card' }, [
            h('h1', { class: 'brand-title', text: 'Лейка · админ-панель' }),
            h('p', { class: 'brand-sub', text: 'admin.checktheplants.ru' }),
            message ? h('p', { class: `notice notice-${tone}`, role: 'status', text: message }) : null,
            h('p', { class: 'muted', text: 'Войдите под аккаунтом с ролью ADMIN. Панель работает с cookie-сессией сайта — ' +
                'если вы уже вошли как администратор на основном сайте, доступ откроется сразу.' }),
            form,
            h('p', { class: 'muted small', text: `API: ${API_BASE}` })
        ])
    ]))
    const firstField = root.querySelector('input[name="email"]')
    if (firstField && typeof firstField.focus === 'function') firstField.focus()
}

function renderDenied(me) {
    const root = document.getElementById('app')
    clear(root)
    root.appendChild(h('div', { class: 'login-screen' }, [
        h('main', { class: 'login-card' }, [
            h('h1', { class: 'brand-title', text: 'Доступ только для администраторов' }),
            h('p', { class: 'muted', text: `Текущий аккаунт: ${me?.email || 'неизвестен'} (роль ${me?.role || '—'}).` }),
            h('div', { class: 'row-actions' }, [
                h('button', {
                    class: 'btn btn-primary',
                    type: 'button',
                    text: 'Войти другим аккаунтом',
                    onClick: async () => {
                        try {
                            await api.logout()
                        } catch {
                            ;
                        }
                        state.admin = null
                        renderLogin('Введите данные администратора')
                    }
                }),
                h('a', { class: 'btn btn-secondary', href: 'https://checktheplants.ru', text: 'На основной сайт' })
            ])
        ])
    ]))
}

function renderFatal(error) {
    const root = document.getElementById('app')
    clear(root)
    root.appendChild(h('div', { class: 'login-screen' }, [
        h('main', { class: 'login-card' }, [
            h('h1', { class: 'brand-title', text: 'Не удалось проверить доступ' }),
            h('p', { class: 'muted', text: error?.message || 'Неизвестная ошибка' }),
            h('p', { class: 'muted small', text: `API: ${API_BASE}. Проверьте, что сервер разрешает origin этой панели ` +
                '(ADMIN_PANEL_ORIGIN на backend) и что cookie-сессия активна.' }),
            h('button', {
                class: 'btn btn-primary',
                type: 'button',
                text: 'Повторить',
                onClick: () => boot()
            })
        ])
    ]))
}

function buildShell() {
    const nav = h('nav', { class: 'nav', 'aria-label': 'Разделы админ-панели' }, VIEWS.map(view => h('button', {
        class: ['nav-item', view.id === state.viewId ? 'is-active' : null],
        type: 'button',
        dataset: { view: view.id },
        'aria-current': view.id === state.viewId ? 'page' : null,
        onClick: () => navigate(view.id, {}),
        text: view.title
    })))

    const rangeSwitch = h('div', { class: 'range-switch', role: 'group', 'aria-label': 'Период' }, DAY_RANGES.map(range => h('button', {
        class: ['range-btn', range.days === state.days ? 'is-active' : null],
        type: 'button',
        text: range.label,
        'aria-pressed': range.days === state.days ? 'true' : 'false',
        dataset: { days: String(range.days) },
        onClick: () => {
            state.days = range.days
            storageSet(DAYS_STORAGE_KEY, String(range.days))
            renderShell()
            renderView()
        }
    })))

    const pageTitle = h('h1', { class: 'page-title', id: 'pageTitle' })
    const pageSubtitle = h('p', { class: 'page-subtitle', id: 'pageSubtitle' })

    const topbar = h('header', { class: 'topbar' }, [
        h('div', { class: 'topbar-titles' }, [pageTitle, pageSubtitle]),
        h('div', { class: 'topbar-actions' }, [
            h('div', { class: 'range-wrap', id: 'rangeWrap' }, [rangeSwitch]),
            h('button', {
                class: 'btn btn-ghost btn-small',
                type: 'button',
                text: document.documentElement.dataset.theme === 'dark' ? '☀ Светлая' : '🌙 Тёмная',
                onClick: event => {
                    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
                    applyTheme(next)
                    event.target.textContent = next === 'dark' ? '☀ Светлая' : '🌙 Тёмная'
                }
            }),
            h('span', { class: 'admin-chip', text: state.admin?.name || state.admin?.email || 'админ' }),
            h('button', {
                class: 'btn btn-ghost btn-small',
                type: 'button',
                text: 'Выйти',
                onClick: async () => {
                    try {
                        await api.logout()
                    } catch {
                        ;
                    }
                    state.admin = null
                    cancelPending()
                    renderLogin('Вы вышли из аккаунта')
                }
            })
        ])
    ])

    const layout = h('div', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
            h('div', { class: 'brand' }, [
                h('span', { class: 'brand-mark', text: '🌱', 'aria-hidden': 'true' }),
                h('div', {}, [
                    h('p', { class: 'brand-title', text: 'Лейка' }),
                    h('p', { class: 'brand-sub', text: 'админ-панель' })
                ])
            ]),
            nav,
            h('p', { class: 'sidebar-foot muted small', text: `API: ${API_BASE}` })
        ]),
        h('main', { class: 'main' }, [
            topbar,
            h('div', { class: 'view-root', id: 'viewRoot', tabindex: '-1' })
        ])
    ])

    return layout
}

function renderShell() {
    const root = document.getElementById('app')
    clear(root)
    root.appendChild(buildShell())
}

function navigate(viewId, params) {
    const nextView = VIEWS.some(view => view.id === viewId) ? viewId : 'overview'
    if (searchTimer) {
        window.clearTimeout(searchTimer)
        searchTimer = null
    }
    state.viewId = nextView
    state.params = prune(params)
    cancelPending()
    window.history.pushState(null, '', buildHash(nextView, state.params))
    renderShell()
    renderView()
}

function setParams(patch, options = {}) {
    const apply = () => {
        state.params = prune({ ...state.params, ...patch })
        const hash = buildHash(state.viewId, state.params)
        if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
        renderView()
    }

    if (!options.debounce) {
        if (searchTimer) {
            window.clearTimeout(searchTimer)
            searchTimer = null
        }
        apply()
        return
    }

    if (searchTimer) window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
        searchTimer = null
        apply()
    }, SEARCH_DEBOUNCE_MS)
}

function restoreFocus() {
    const key = state.focusKey
    state.focusKey = null
    if (!key) return
    const node = document.querySelector(`[data-focus-key="${key}"]`)
    if (!node) return
    node.focus()
    if (typeof node.setSelectionRange === 'function' && typeof node.value === 'string') {
        const position = node.value.length
        try {
            node.setSelectionRange(position, position)
        } catch {
            ;
        }
    }
}

function measureContentWidth(viewRoot) {
    try {
        const rect = typeof viewRoot.getBoundingClientRect === 'function' ? viewRoot.getBoundingClientRect() : null
        const width = rect && rect.width ? rect.width : (Number(window.innerWidth) || 1024) - 44
        const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(viewRoot) : null
        const padding = style
            ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
            : 0
        return Math.max(280, Math.round(width - padding))
    } catch {
        return 980
    }
}

async function renderView() {
    const meta = viewMeta(state.viewId)
    const viewRoot = document.getElementById('viewRoot')
    if (!viewRoot) return

    renderSeq += 1
    const seq = renderSeq
    state.focusKey = document.activeElement?.dataset?.focusKey || null

    document.getElementById('pageTitle').textContent = meta.title
    document.getElementById('pageSubtitle').textContent = meta.subtitle || ''
    const rangeWrap = document.getElementById('rangeWrap')
    if (rangeWrap) rangeWrap.style.display = meta.needsRange ? '' : 'none'

    document.querySelectorAll('.nav-item').forEach(item => {
        const active = item.dataset.view === meta.id
        item.classList.toggle('is-active', active)
        if (active) item.setAttribute('aria-current', 'page')
        else item.removeAttribute('aria-current')
    })

    const { from, to } = rangeFor(state.days)
    const ctx = {
        days: state.days,
        from,
        to,
        contentWidth: measureContentWidth(viewRoot),
        params: state.params,
        setParams,
        reload: () => renderView()
    }

    state.loading = true
    try {
        const view = await loadView(meta.id)
        if (seq !== renderSeq) return
        await view.render(viewRoot, ctx)
    } catch (error) {
        if (isCanceled(error)) return
        if (error?.status === 401) {
            handleUnauthorized()
            return
        }
        if (seq !== renderSeq) return
        viewRoot.replaceChildren(h('div', { class: 'state state-error', role: 'alert' }, [
            h('p', { text: error?.message || 'Не удалось отобразить раздел' }),
            h('button', {
                class: 'btn btn-secondary',
                type: 'button',
                text: 'Повторить',
                onClick: () => renderView()
            })
        ]))
    } finally {
        if (seq === renderSeq) state.loading = false
        restoreFocus()
    }
}

async function boot() {
    state.storageBlocked = !storageAvailable()

    const theme = storageGet(THEME_STORAGE_KEY)
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    applyTheme(theme)

    try {
        const me = await api.me()
        if (me?.role !== 'ADMIN') {
            state.admin = null
            renderDenied(me)
            return
        }
        state.admin = me
        const { viewId, params } = parseHash()
        state.viewId = viewId
        state.params = params
        renderShell()
        await renderView()
        if (state.storageBlocked) {
            toast('Браузер запретил локальное хранилище: тема и период не сохранятся между визитами', 'info')
        }
    } catch (error) {
        if (isCanceled(error)) return
        if (error instanceof ApiError && error.status === 401) {
            state.admin = null
            renderLogin('Войдите, чтобы открыть админ-панель')
            return
        }
        if (error instanceof ApiError && error.status === 403) {
            renderDenied(null)
            return
        }
        renderFatal(error)
    }
}

window.addEventListener('popstate', () => {
    const { viewId, params } = parseHash()
    state.viewId = viewId
    state.params = params
    cancelPending()
    if (!state.admin) {
        boot()
        return
    }
    renderShell()
    renderView()
})

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
} else {
    boot()
}
