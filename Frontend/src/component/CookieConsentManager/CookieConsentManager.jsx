import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { API_URL } from '../../utils/api.js'
import {
    buildLocalConsent,
    readLocalConsent,
    saveLocalConsent,
    summarizeConsents
} from '../../utils/cookieConsent.js'
import {
    OVERLAY_IDS,
    OVERLAY_PRIORITIES,
    getActiveOverlay,
    requestOverlay,
    subscribeOverlays
} from '../../utils/overlayQueue.js'
import { COOKIE_SETTINGS_EVENT } from '../../utils/cookieConsentSettings.js'
import privacyPolicyDocument from '../../../document/PrivacyPolicy.pdf'
import './CookieConsentManager.css'
import './dark-theme.css'

const METRIKA_ID = 113420950
const GA_MEASUREMENT_IDS = ['G-H4WTEHYZ2K']
const AUTH_PATHS = new Set(['/login', '/register', '/reset-password'])
const SENSITIVE_ANALYTICS_PATHS = new Set(['/reset-password'])
const WEBVISOR_EXCLUDED_PATHS = AUTH_PATHS
const METRIKA_MASK_CLASSES = ['ym-hide-content', 'ym-disable-keys']
const REVOKE_RETURN_FLAG = 'webplant-cookie-consent-reopen'
const ANALYTICS_COOKIE_PATTERN = /^(_ga|_ga_|_gid|_gcl|_gat|_ym)/
const METRIKA_SCRIPT_SRC = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`

async function getErrorMessage(response, fallback) {
    try {
        const body = await response.json()
        return typeof body.message === 'string' ? body.message : fallback
    } catch {
        return fallback
    }
}

function analyticsPageUrl(pathname, search) {
    if (typeof window === 'undefined') return ''
    const base = `${window.location.origin}${pathname}`
    return SENSITIVE_ANALYTICS_PATHS.has(pathname) ? base : `${base}${search || ''}`
}

function isWebvisorAllowed(pathname) {
    return !WEBVISOR_EXCLUDED_PATHS.has(pathname)
}

function readConsentReopenRequest() {
    if (typeof window === 'undefined') return false
    try {
        return window.sessionStorage.getItem(REVOKE_RETURN_FLAG) === '1'
    } catch (flagError) {
        console.warn('Не удалось прочитать флаг повторного показа cookie-баннера:', flagError)
        return false
    }
}

function initializeMetrika(pageUrl, pathname) {
    if (window.__webPlantMetrikaInitialized) return

    const webvisor = isWebvisorAllowed(pathname)

    window.dataLayer = window.dataLayer || []
    window.ym = window.ym || function (...args) {
        (window.ym.a = window.ym.a || []).push(args)
    }
    window.ym.l = window.ym.l || Date.now()

    if (![...document.scripts].some(script => script.src === METRIKA_SCRIPT_SRC)) {
        const script = document.createElement('script')
        script.async = true
        script.src = METRIKA_SCRIPT_SRC
        script.onerror = () => {
            console.error('Не удалось загрузить скрипт Яндекс.Метрики')
        }
        document.head.appendChild(script)
    }

    window.__webPlantMetrikaOptions = {
        pathname,
        webvisor,
        clickmap: true
    }

    window.ym(METRIKA_ID, 'init', {
        ssr: true,
        webvisor,
        clickmap: true,
        ecommerce: 'dataLayer',
        referrer: document.referrer,
        url: pageUrl,
        accurateTrackBounce: true,
        trackLinks: true
    })
    window.__webPlantMetrikaInitialized = true
}

function initializeGoogleAnalytics(pageUrl) {
    if (window.__webPlantAnalyticsInitialized) return

    window.dataLayer = window.dataLayer || []
    window.gtag = window.gtag || function gtag() {
        window.dataLayer.push(arguments)
    }

    window.gtag('js', new Date())

    for (const measurementId of GA_MEASUREMENT_IDS) {
        delete window[`ga-disable-${measurementId}`]

        const source = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
        if (![...document.scripts].some(script => script.src === source)) {
            const script = document.createElement('script')
            script.async = true
            script.src = source
            script.onerror = () => {
                console.error('Не удалось загрузить скрипт Google Analytics')
            }
            document.head.appendChild(script)
        }

        window.gtag('config', measurementId, {
            anonymize_ip: true,
            page_location: pageUrl
        })
    }

    window.__webPlantAnalyticsInitialized = true
}

function clearAnalyticsCookies() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return

    const cookieNames = document.cookie
        .split(';')
        .map(cookie => cookie.trim().split('=')[0])
        .filter(name => name && ANALYTICS_COOKIE_PATTERN.test(name))
    if (!cookieNames.length) return

    const domains = ['']
    const { hostname } = window.location
    if (hostname && hostname.includes('.') && hostname !== 'localhost') {
        domains.push(`; domain=.${hostname.replace(/^www\./, '')}`)
    }

    for (const name of cookieNames) {
        for (const domain of domains) {
            document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`
        }
    }
}

function disableGoogleAnalytics() {
    if (typeof window === 'undefined') return

    try {
        for (const measurementId of GA_MEASUREMENT_IDS) {
            window[`ga-disable-${measurementId}`] = true
        }
        clearAnalyticsCookies()
    } catch (error) {
        console.warn('Не удалось отключить Google Analytics:', error)
    }
}

function getIsNarrowViewport() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(max-width: 480px)').matches
}

function useIsNarrowViewport() {
    const [isNarrow, setIsNarrow] = useState(getIsNarrowViewport)

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined
        }

        const mediaQuery = window.matchMedia('(max-width: 480px)')
        const update = event => setIsNarrow(event.matches)
        mediaQuery.addEventListener('change', update)
        return () => mediaQuery.removeEventListener('change', update)
    }, [])

    return isNarrow
}

async function saveConsentToServer(acceptOptionalCookies) {
    const response = await fetch(`${API_URL}/cookie-consents/all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            consents: [
                { consentType: 'technical', isAccepted: true },
                { consentType: 'analytics', isAccepted: acceptOptionalCookies },
                { consentType: 'marketing', isAccepted: false },
                { consentType: 'personalization', isAccepted: false }
            ]
        })
    })
    if (!response.ok) {
        throw new Error(
            await getErrorMessage(response, 'Не удалось сохранить выбор.')
        )
    }
    return response
}

async function fetchAccountScope(signal) {
    try {
        const response = await fetch(`${API_URL}/users/me`, {
            method: 'GET',
            credentials: 'include',
            signal
        })
        if (response.ok) return 'user'
        if (response.status === 401 || response.status === 404) return 'guest'
        return 'unknown'
    } catch (error) {
        if (error.name === 'AbortError') throw error
        console.warn('Не удалось определить состояние аккаунта:', error)
        return 'unknown'
    }
}

function CookieConsentManager() {
    const location = useLocation()
    const isAuthPath = AUTH_PATHS.has(location.pathname)
    const isNarrowViewport = useIsNarrowViewport()
    const [consentLoaded, setConsentLoaded] = useState(false)
    const [consentKnown, setConsentKnown] = useState(false)
    const [analyticsAccepted, setAnalyticsAccepted] = useState(false)
    const [isOpen, setIsOpen] = useState(readConsentReopenRequest)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')
    const lastTrackedPath = useRef(null)
    const bannerRef = useRef(null)
    const previousFocusRef = useRef(null)
    const saveConsentRef = useRef(null)
    const closeBannerRef = useRef(null)
    const bannerModeRef = useRef('request')

    const activeOverlay = useSyncExternalStore(
        subscribeOverlays,
        getActiveOverlay,
        () => null
    )

    const bannerMode = isOpen ? 'settings' : 'request'
    const wantsBanner = consentLoaded && (!consentKnown || isOpen)
    const showBanner = wantsBanner && activeOverlay === OVERLAY_IDS.cookie

    const loadConsents = useCallback(async signal => {
        const response = await fetch(`${API_URL}/cookie-consents`, {
            credentials: 'include',
            signal
        })
        if (!response.ok) {
            throw new Error(
                await getErrorMessage(response, 'Не удалось проверить выбор cookie.')
            )
        }

        const consents = await response.json()
        if (!Array.isArray(consents)) {
            throw new Error('Сервер вернул некорректные настройки cookie.')
        }
        return consents
    }, [])

    const applyLocalConsent = useCallback((local, allowAnalytics) => {
        setConsentKnown(true)
        setAnalyticsAccepted(Boolean(allowAnalytics) && local.analyticsAccepted === true)
        setError('')
    }, [])

    const resetConsent = useCallback(() => {
        setConsentKnown(false)
        setAnalyticsAccepted(false)
        setError('')
    }, [])

    const applyStoredConsent = useCallback(async signal => {
        const local = readLocalConsent()
        if (!local) {
            resetConsent()
            return false
        }

        const scope = await fetchAccountScope(signal)
        if (scope === 'user') {
            resetConsent()
            return false
        }

        applyLocalConsent(local, scope === 'guest')
        return true
    }, [applyLocalConsent, resetConsent])

    const applyConsents = useCallback(async (consents, signal) => {
        const { known, analyticsAccepted: serverAnalytics } = summarizeConsents(consents)
        if (known) {
            setConsentKnown(true)
            setAnalyticsAccepted(serverAnalytics)
            setError('')
            return
        }

        await applyStoredConsent(signal)
    }, [applyStoredConsent])

    useEffect(() => {
        const controller = new AbortController()
        loadConsents(controller.signal)
            .then(consents => {
                if (controller.signal.aborted) return
                return applyConsents(consents, controller.signal)
            })
            .catch(async loadError => {
                if (loadError.name === 'AbortError') return
                console.error('Ошибка загрузки согласия cookie:', loadError)
                let applied = false
                try {
                    applied = await applyStoredConsent(controller.signal)
                } catch (fallbackError) {
                    if (fallbackError.name === 'AbortError') return
                    console.warn('Не удалось применить сохранённый выбор cookie:', fallbackError)
                }
                if (applied || controller.signal.aborted) return
                setError(loadError.message || 'Не удалось загрузить настройки cookie.')
                setIsOpen(true)
            })
            .finally(() => {
                if (!controller.signal.aborted) setConsentLoaded(true)
            })

        return () => controller.abort()
    }, [applyConsents, applyStoredConsent, loadConsents, location.pathname])

    useEffect(() => {
        const currentPath = `${location.pathname}${location.search}${location.hash}`
        const pageUrl = analyticsPageUrl(location.pathname, location.search)

        if (!consentLoaded) return

        if (!analyticsAccepted) {
            if (consentKnown) disableGoogleAnalytics()
            lastTrackedPath.current = currentPath
            return
        }

        const isFirstInit = !window.__webPlantMetrikaInitialized
            || !window.__webPlantAnalyticsInitialized

        if (!window.__webPlantMetrikaInitialized) {
            initializeMetrika(pageUrl, location.pathname)
        }
        if (!window.__webPlantAnalyticsInitialized) initializeGoogleAnalytics(pageUrl)

        if (isFirstInit || lastTrackedPath.current === null) {
            lastTrackedPath.current = currentPath
            return
        }

        if (lastTrackedPath.current !== currentPath) {
            window.ym(METRIKA_ID, 'hit', pageUrl, {
                title: document.title
            })
            lastTrackedPath.current = currentPath
        }
    }, [
        analyticsAccepted,
        consentKnown,
        consentLoaded,
        location.hash,
        location.pathname,
        location.search
    ])

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        if (!isAuthPath) return undefined

        const root = document.documentElement
        for (const className of METRIKA_MASK_CLASSES) root.classList.add(className)

        return () => {
            for (const className of METRIKA_MASK_CLASSES) root.classList.remove(className)
        }
    }, [isAuthPath])

    useEffect(() => {
        if (!wantsBanner) return undefined
        return requestOverlay(OVERLAY_IDS.cookie, OVERLAY_PRIORITIES.cookie)
    }, [wantsBanner])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const handleOpenRequest = () => setIsOpen(true)
        window.addEventListener(COOKIE_SETTINGS_EVENT, handleOpenRequest)
        return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, handleOpenRequest)
    }, [])

    useEffect(() => {
        bannerModeRef.current = bannerMode
    }, [bannerMode])

    const closeBanner = useCallback(() => {
        setIsOpen(false)
        setError('')
    }, [])

    useEffect(() => {
        closeBannerRef.current = closeBanner
    }, [closeBanner])

    useEffect(() => {
        try {
            window.sessionStorage.removeItem(REVOKE_RETURN_FLAG)
        } catch (flagError) {
            console.warn('Не удалось сбросить флаг повторного показа cookie-баннера:', flagError)
        }
    }, [])

    const saveConsent = useCallback(async acceptOptionalCookies => {
        if (isSaving) return

        setIsSaving(true)
        setError('')
        saveLocalConsent(buildLocalConsent(acceptOptionalCookies))
        try {
            await saveConsentToServer(acceptOptionalCookies)

            const wasAnalyticsAccepted = analyticsAccepted
            setAnalyticsAccepted(acceptOptionalCookies)
            setConsentKnown(true)
            setIsOpen(false)

            if (wasAnalyticsAccepted && !acceptOptionalCookies) {
                disableGoogleAnalytics()
                try {
                    window.sessionStorage.setItem(REVOKE_RETURN_FLAG, '1')
                } catch (flagError) {
                    console.warn('Не удалось сохранить флаг повторного показа cookie-баннера:', flagError)
                }
                window.location.reload()
            }
        } catch (saveError) {
            console.error('Ошибка сохранения согласия cookie:', saveError)
            setError(saveError.message || 'Не удалось сохранить выбор.')
        } finally {
            setIsSaving(false)
        }
    }, [analyticsAccepted, isSaving])

    useEffect(() => {
        saveConsentRef.current = saveConsent
    }, [saveConsent])

    useEffect(() => {
        if (!showBanner || typeof document === 'undefined') return undefined

        const bannerNode = bannerRef.current
        previousFocusRef.current = document.activeElement

        const focusTimer = window.setTimeout(() => {
            if (bannerNode && typeof bannerNode.focus === 'function') {
                bannerNode.focus()
            }
        }, 0)

        const getFocusableElements = () => {
            if (!bannerNode) return []
            return [
                ...bannerNode.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                )
            ].filter(element => !element.disabled)
        }

        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault()
                if (bannerModeRef.current === 'settings') {
                    closeBannerRef.current?.()
                } else {
                    saveConsentRef.current?.(false)
                }
                return
            }
            if (event.key !== 'Tab') return

            const focusable = getFocusableElements()
            if (!focusable.length) return

            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
            window.clearTimeout(focusTimer)
            document.removeEventListener('keydown', handleKeyDown)

            const previousFocus = previousFocusRef.current
            previousFocusRef.current = null
            if (
                previousFocus
                && typeof previousFocus.focus === 'function'
                && document.contains(previousFocus)
            ) {
                try {
                    previousFocus.focus()
                } catch (focusError) {
                    console.warn('Не удалось вернуть фокус после закрытия cookie-баннера:', focusError)
                }
            }
        }
    }, [showBanner])

    useEffect(() => {
        if (!showBanner || !isNarrowViewport || typeof document === 'undefined') {
            return undefined
        }

        const bannerNode = bannerRef.current
        if (!bannerNode) return undefined

        const body = document.body
        const root = document.documentElement
        const previousPadding = body.style.paddingBottom
        const previousScrollPadding = root.style.scrollPaddingBottom

        const updatePadding = () => {
            const height = bannerNode.getBoundingClientRect().height
            body.style.paddingBottom = `${Math.ceil(height) + 16}px`
            root.style.scrollPaddingBottom = `${Math.ceil(height) + 24}px`
        }

        updatePadding()

        let observer = null
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(updatePadding)
            observer.observe(bannerNode)
        }

        return () => {
            if (observer) observer.disconnect()
            body.style.paddingBottom = previousPadding
            root.style.scrollPaddingBottom = previousScrollPadding
        }
    }, [isNarrowViewport, showBanner])

    const description = bannerMode === 'settings'
        ? (analyticsAccepted
            ? 'Аналитика включена: Яндекс.Метрика и Google Analytics собирают обезличенную статистику посещений. Если отозвать согласие, скрипты аналитики перестанут загружаться, а их cookie будут удалены.'
            : 'Аналитика выключена: Яндекс.Метрика и Google Analytics не загружаются и не собирают данные. Вы можете разрешить её в любой момент.')
        : 'Обязательные cookie нужны для работы сайта. С вашего разрешения «Лейка» включает аналитику — Яндекс.Метрику (просмотр веб-сеансов и карты кликов) и Google Analytics (обезличенная статистика посещений). Без разрешения аналитические скрипты не загружаются. Выбор можно изменить позднее.'

    return (
        <>
            {showBanner && (
                <aside
                    ref={bannerRef}
                    className={`cookieConsentBanner${isAuthPath ? ' cookieConsentBanner--auth' : ''}`}
                    role='dialog'
                    aria-modal='true'
                    aria-labelledby='cookieConsentTitle'
                    aria-describedby='cookieConsentDescription'
                    data-consent-mode={bannerMode}
                    tabIndex={-1}
                >
                    <div className='cookieConsentHeader'>
                        <h2 className='cookieConsentTitle' id='cookieConsentTitle'>
                            Настройки cookie
                        </h2>
                        <button
                            type='button'
                            className='cookieConsentClose'
                            aria-label={bannerMode === 'settings'
                                ? 'Закрыть настройки cookie'
                                : 'Закрыть и оставить только необходимые cookie'}
                            title={bannerMode === 'settings'
                                ? 'Закрыть настройки cookie'
                                : 'Оставить только необходимые cookie'}
                            disabled={isSaving}
                            onClick={() => {
                                if (bannerMode === 'settings') closeBanner()
                                else saveConsent(false)
                            }}
                        >
                            ×
                        </button>
                    </div>
                    <div className='cookieConsentCopy'>
                        <p id='cookieConsentDescription'>
                            {description} Подробнее — в{' '}
                            <a
                                href={privacyPolicyDocument}
                                target='_blank'
                                rel='noreferrer'
                            >
                                Политике обработки персональных данных
                            </a>.
                        </p>
                    </div>
                    {error && <p className='cookieConsentError' role='alert'>{error}</p>}
                    {error && (
                        <button
                            type='button'
                            className='cookieConsentSecondary'
                            disabled={isSaving}
                            onClick={() => {
                                setConsentLoaded(false)
                                setError('')
                                loadConsents()
                                    .then(applyConsents)
                                    .catch(loadError => {
                                        console.error('Ошибка повторной загрузки согласия cookie:', loadError)
                                        setError(loadError.message || 'Не удалось проверить выбор cookie.')
                                    })
                                    .finally(() => setConsentLoaded(true))
                            }}
                        >
                            Повторить проверку
                        </button>
                    )}
                    <div className='cookieConsentActions'>
                        {bannerMode === 'settings' && analyticsAccepted && (
                            <>
                                <button
                                    type='button'
                                    className='cookieConsentPrimary'
                                    disabled={isSaving}
                                    onClick={() => saveConsent(false)}
                                >
                                    {isSaving ? 'Сохраняем…' : 'Отозвать согласие на аналитику'}
                                </button>
                                <button
                                    type='button'
                                    className='cookieConsentSecondary'
                                    disabled={isSaving}
                                    onClick={closeBanner}
                                >
                                    Закрыть
                                </button>
                            </>
                        )}
                        {bannerMode === 'settings' && !analyticsAccepted && (
                            <>
                                <button
                                    type='button'
                                    className='cookieConsentPrimary'
                                    disabled={isSaving}
                                    onClick={() => saveConsent(true)}
                                >
                                    {isSaving ? 'Сохраняем…' : 'Разрешить аналитику'}
                                </button>
                                <button
                                    type='button'
                                    className='cookieConsentSecondary'
                                    disabled={isSaving}
                                    onClick={closeBanner}
                                >
                                    Закрыть
                                </button>
                            </>
                        )}
                        {bannerMode === 'request' && (
                            <>
                                <button
                                    type='button'
                                    className='cookieConsentPrimary'
                                    disabled={isSaving}
                                    onClick={() => saveConsent(true)}
                                >
                                    {isSaving ? 'Сохраняем…' : 'Разрешить аналитику'}
                                </button>
                                <button
                                    type='button'
                                    className='cookieConsentSecondary'
                                    disabled={isSaving}
                                    onClick={() => saveConsent(false)}
                                >
                                    Только обязательные
                                </button>
                            </>
                        )}
                    </div>
                </aside>
            )}
        </>
    )
}

export default CookieConsentManager
