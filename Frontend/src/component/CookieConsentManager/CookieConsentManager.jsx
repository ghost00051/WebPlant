import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { API_URL } from '../../utils/api.js'
import {
    buildLocalConsent,
    readLocalConsent,
    saveLocalConsent,
    summarizeConsents
} from '../../utils/cookieConsent.js'
import './CookieConsentManager.css'
import './dark-theme.css'

const METRIKA_ID = 113420950

async function getErrorMessage(response, fallback) {
    try {
        const body = await response.json()
        return typeof body.message === 'string' ? body.message : fallback
    } catch {
        return fallback
    }
}

function initializeMetrika() {
    if (window.__webPlantMetrikaInitialized) return

    window.dataLayer = window.dataLayer || []
    window.ym = window.ym || function (...args) {
        (window.ym.a = window.ym.a || []).push(args)
    }
    window.ym.l = window.ym.l || Date.now()

    const source = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`
    if (![...document.scripts].some(script => script.src === source)) {
        const script = document.createElement('script')
        script.async = true
        script.src = source
        script.onerror = () => {
            console.error('Не удалось загрузить скрипт Яндекс.Метрики')
        }
        document.head.appendChild(script)
    }

    window.ym(METRIKA_ID, 'init', {
        ssr: true,
        webvisor: true,
        clickmap: true,
        ecommerce: 'dataLayer',
        referrer: document.referrer,
        url: location.href,
        accurateTrackBounce: true,
        trackLinks: true
    })
    window.__webPlantMetrikaInitialized = true
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
    const isHomePage = location.pathname === '/home'
    const [consentLoaded, setConsentLoaded] = useState(false)
    const [consentKnown, setConsentKnown] = useState(false)
    const [analyticsAccepted, setAnalyticsAccepted] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')
    const lastTrackedPath = useRef(null)

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

    // Сервер не знает выбора: согласие привязано к личности (user_id или
    // guest_token). Локальный выбор применяем только гостю — у гостя личность
    // совпадает с устройством. Для аккаунта это может быть чужой выбор,
    // сделанный на том же устройстве, поэтому там решает сервер.
    // Запись на сервере здесь заново не создаём: она привязалась бы к текущему
    // guest_token, а при следующем входе её унаследовал бы другой аккаунт.
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
                // Если выбор уже сохранён на устройстве, недоступность API
                // не повод показывать окно заново.
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
        // location.pathname: после входа в аккаунт согласие может быть
        // уже сохранено за пользователем, поэтому состояние перечитываем.
    }, [applyConsents, applyStoredConsent, loadConsents, location.pathname])

    useEffect(() => {
        const currentPath = `${location.pathname}${location.search}${location.hash}`
        if (!consentLoaded || !analyticsAccepted) {
            lastTrackedPath.current = currentPath
            return
        }

        if (!window.__webPlantMetrikaInitialized) {
            initializeMetrika()
            lastTrackedPath.current = currentPath
            return
        }

        if (lastTrackedPath.current !== currentPath) {
            window.ym(
                METRIKA_ID,
                'hit',
                `${window.location.origin}${location.pathname}${location.search}${location.hash}`,
                {
                    title: document.title
                }
            )
            lastTrackedPath.current = currentPath
        }
    }, [
        analyticsAccepted,
        consentLoaded,
        location.hash,
        location.pathname,
        location.search
    ])

    const saveConsent = async acceptOptionalCookies => {
        if (isSaving) return

        setIsSaving(true)
        setError('')
        // Выбор запоминаем на устройстве до запроса: даже если сервер
        // недоступен, окно не вернётся при следующем входе.
        saveLocalConsent(buildLocalConsent(acceptOptionalCookies))
        try {
            await saveConsentToServer(acceptOptionalCookies)

            const wasAnalyticsAccepted = analyticsAccepted
            setAnalyticsAccepted(acceptOptionalCookies)
            setConsentKnown(true)
            setIsOpen(false)

            if (wasAnalyticsAccepted && !acceptOptionalCookies) {
                window.location.reload()
            }
        } catch (saveError) {
            console.error('Ошибка сохранения согласия cookie:', saveError)
            setError(saveError.message || 'Не удалось сохранить выбор.')
        } finally {
            setIsSaving(false)
        }
    }

    const showBanner = consentLoaded && (!consentKnown || isOpen)

    return (
        <>
            {consentLoaded && consentKnown && !isOpen && !isHomePage && (
                <button
                    className='cookieSettingsTrigger'
                    type='button'
                    onClick={() => setIsOpen(true)}
                >
                    Настройки cookie
                </button>
            )}
            {showBanner && (
                <aside
                    className='cookieConsentBanner'
                    aria-label='Настройки файлов cookie'
                    aria-live='polite'
                >
                    <div className='cookieConsentCopy'>
                        <p className='cookieConsentTitle'>Настройки cookie</p>
                        <p>
                            Обязательные cookie нужны для работы сайта. С вашего
                            разрешения Яндекс.Метрика будет собирать данные об
                            использовании «Лейки», включая просмотр веб-сеансов и
                            карты кликов, чтобы улучшать сервис.
                            Выбор можно изменить позднее.
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
                        {consentKnown && (
                            <button
                                type='button'
                                className='cookieConsentClose'
                                aria-label='Закрыть настройки cookie'
                                onClick={() => setIsOpen(false)}
                            >
                                ×
                            </button>
                        )}
                    </div>
                </aside>
            )}
        </>
    )
}

export default CookieConsentManager
