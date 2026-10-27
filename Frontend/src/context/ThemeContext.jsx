import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { API_URL } from '../utils/api.js'
import ThemeContext from './themeContext.js'

const STORAGE_KEY = 'webplant-theme'

function getStoredThemeMode() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        return ['system', 'light', 'dark'].includes(stored) ? stored : 'system'
    } catch {
        return 'system'
    }
}

function getSystemTheme() {
    return typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
}

function subscribeToSystemTheme(callback) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', callback)
    return () => mediaQuery.removeEventListener('change', callback)
}

const PUBLIC_AUTH_ROUTES = new Set(['/', '/login', '/register'])
const GARDEN_ROUTE_PATTERN = /^\/garden\/[A-Za-z0-9_-]{16,64}$/

const PRIVATE_ROUTE_PREFIXES = [
    '/home',
    '/my-plants',
    '/notifications',
    '/add-plant',
    '/edit-profile'
]

function isPublicContentRoute(pathname) {
    if (typeof pathname !== 'string' || !pathname) return false
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
    if (PUBLIC_AUTH_ROUTES.has(path)) return true
    if (GARDEN_ROUTE_PATTERN.test(path)) return true
    return !PRIVATE_ROUTE_PREFIXES.some(
        prefix => path === prefix || path.startsWith(`${prefix}/`)
    )
}

export function ThemeProvider({ children }) {
    const [themeMode, setThemeModeState] = useState(getStoredThemeMode)
    const preferencesLoadedRef = useRef(false)
    const systemTheme = useSyncExternalStore(
        subscribeToSystemTheme,
        getSystemTheme,
        () => 'light'
    )
    const theme = themeMode === 'system' ? systemTheme : themeMode
    const location = useLocation()
    const isPublicRoute = isPublicContentRoute(location.pathname)

    useEffect(() => {
        document.documentElement.dataset.theme = theme
        document.documentElement.style.colorScheme = theme
        try {
            localStorage.setItem(STORAGE_KEY, themeMode)
        } catch (error) {
            console.warn('Не удалось сохранить локальную тему:', error)
        }
    }, [theme, themeMode])

    useEffect(() => {
        if (isPublicRoute) {


            preferencesLoadedRef.current = false
            return undefined
        }
        if (preferencesLoadedRef.current) return undefined
        preferencesLoadedRef.current = true

        let cancelled = false

        fetch(`${API_URL}/users/me/notification-preferences`, {
            credentials: 'include'
        })
            .then(async response => {
                if (response.status === 401) {
                    throw new Error('Сессия истекла: настройки темы недоступны')
                }
                if (!response.ok) {
                    throw new Error(`Не удалось загрузить настройки темы: HTTP ${response.status}`)
                }
                return response.json()
            })
            .then(preferences => {
                if (!cancelled && preferences) {
                    const mode = ['system', 'light', 'dark'].includes(preferences.theme_mode)
                        ? preferences.theme_mode
                        : preferences.dark_theme_enabled ? 'dark' : 'light'
                    setThemeModeState(mode)
                }
            })
            .catch(error => {
                console.error('Ошибка синхронизации темы:', error)
                preferencesLoadedRef.current = false
            })

        return () => {
            cancelled = true
        }
    }, [isPublicRoute])

    const setThemePreference = useCallback(async nextThemeMode => {
        if (!['system', 'light', 'dark'].includes(nextThemeMode)) {
            throw new Error('Неизвестный режим темы')
        }

        const previousThemeMode = themeMode
        setThemeModeState(nextThemeMode)

        try {
            const response = await fetch(`${API_URL}/users/me/notification-preferences`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ theme_mode: nextThemeMode })
            })
            if (response.status === 401) {
                throw new Error('Сессия истекла — тема не сохранена')
            }
            if (!response.ok) {
                throw new Error(`Не удалось сохранить тему: HTTP ${response.status}`)
            }
            return true
        } catch (error) {
            setThemeModeState(previousThemeMode)
            console.error('Ошибка сохранения темы:', error)
            throw error
        }
    }, [themeMode])

    return (
        <ThemeContext.Provider value={{ theme, themeMode, setThemePreference }}>
            {children}
        </ThemeContext.Provider>
    )
}
