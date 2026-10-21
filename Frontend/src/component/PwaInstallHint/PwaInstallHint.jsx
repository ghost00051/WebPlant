import { useEffect, useState, useSyncExternalStore } from 'react'
import { isIOS, isStandalone } from '../../utils/pushNotifications.js'
import {
    clearInstallPrompt,
    getInstallState,
    subscribeToInstallState
} from '../../utils/pwaInstall.js'
import {
    OVERLAY_IDS,
    OVERLAY_PRIORITIES,
    getActiveOverlay,
    requestOverlay,
    subscribeOverlays
} from '../../utils/overlayQueue.js'
import './PwaInstallHint.css'
import './dark-theme.css'

const DISMISSED_UNTIL_KEY = 'pwa_install_hint_dismissed_until'
const DISMISS_DURATION = 30 * 24 * 60 * 60 * 1000
const REVEAL_MIN_SCROLL_PX = 280
const REVEAL_VIEWPORT_SHARE = 0.35
const dismissedListeners = new Set()
let dismissedInSession = false

function subscribeToDismissal(listener) {
    dismissedListeners.add(listener)
    return () => dismissedListeners.delete(listener)
}

function subscribeToNoDeviceChanges() {
    return () => {}
}

function emitDismissal() {
    for (const listener of dismissedListeners) listener()
}

function wasDismissed() {
    if (dismissedInSession) return true
    try {
        return Number(localStorage.getItem(DISMISSED_UNTIL_KEY) || 0) > Date.now()
    } catch (error) {
        console.warn('Не удалось прочитать состояние установки приложения:', error)
        return false
    }
}

function revealThreshold() {
    if (typeof window === 'undefined') return REVEAL_MIN_SCROLL_PX
    return Math.max(
        REVEAL_MIN_SCROLL_PX,
        Math.round(window.innerHeight * REVEAL_VIEWPORT_SHARE)
    )
}

function isRevealScrollReached(target) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false

    const element = target && target.nodeType === 1
        ? target
        : (document.scrollingElement || document.documentElement)
    if (!element) return false

    const isRoot = element === document.scrollingElement
        || element === document.documentElement
        || element === document.body
    const scrollTop = isRoot ? (window.scrollY || element.scrollTop || 0) : (element.scrollTop || 0)
    if (scrollTop <= 0) return false

    const maxScroll = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0))
    if (maxScroll <= 40) return false

    const effectiveThreshold = Math.min(revealThreshold(), Math.round(maxScroll * 0.5))
    return scrollTop >= effectiveThreshold
}

function PwaInstallHint() {
    const installState = useSyncExternalStore(
        subscribeToInstallState,
        getInstallState,
        getInstallState
    )
    const dismissed = useSyncExternalStore(
        subscribeToDismissal,
        wasDismissed,
        () => false
    )
    const needsIOSInstructions = useSyncExternalStore(
        subscribeToNoDeviceChanges,
        () => isIOS() && !isStandalone(),
        () => false
    )
    const [showInstructions, setShowInstructions] = useState(false)
    const [installing, setInstalling] = useState(false)
    const [revealed, setRevealed] = useState(false)

    const activeOverlay = useSyncExternalStore(
        subscribeOverlays,
        getActiveOverlay,
        () => null
    )

    useEffect(() => {
        if (wasDismissed()) {
            dismissedInSession = true
            emitDismissal()
        }
    }, [])

    useEffect(() => {
        if (typeof document === 'undefined') return undefined

        const check = target => {
            if (isRevealScrollReached(target)) setRevealed(true)
        }

        check(document.scrollingElement)

        const onScroll = event => check(event.target)
        document.addEventListener('scroll', onScroll, { capture: true, passive: true })

        return () => document.removeEventListener('scroll', onScroll, { capture: true })
    }, [])

    const eligible = !isStandalone()
        && !installState.installed
        && !dismissed
        && (needsIOSInstructions || Boolean(installState.deferredPrompt))

    useEffect(() => {
        if (!eligible || !revealed) return undefined
        return requestOverlay(OVERLAY_IDS.pwa, OVERLAY_PRIORITIES.pwa)
    }, [eligible, revealed])

    const visible = eligible && revealed && activeOverlay === OVERLAY_IDS.pwa

    if (!visible) return null

    const dismiss = () => {
        try {
            localStorage.setItem(
                DISMISSED_UNTIL_KEY,
                String(Date.now() + DISMISS_DURATION)
            )
        } catch (error) {
            console.warn('Не удалось сохранить состояние установки приложения:', error)
        }
        dismissedInSession = true
        emitDismissal()
    }

    const install = async () => {
        const promptEvent = installState.deferredPrompt
        if (!promptEvent || installing) return

        setInstalling(true)
        try {
            await promptEvent.prompt()
            const { outcome } = await promptEvent.userChoice
            clearInstallPrompt()
            if (outcome === 'accepted') {
                dismiss()
            }
        } catch (error) {
            console.error('Не удалось открыть установку приложения:', error)
        } finally {
            setInstalling(false)
        }
    }

    return (
        <aside
            className='pwaInstallHint'
            aria-label='Установка приложения'
            data-overlay='pwa'
        >
            <span className='pwaInstallHintIcon' aria-hidden='true'>↗</span>
            <div className='pwaInstallHintContent'>
                <p className='pwaInstallHintTitle'>
                    {needsIOSInstructions
                        ? 'Добавьте «Лейку» на экран «Домой»'
                        : 'Установите «Лейку» на устройство'}
                </p>
                <p className='pwaInstallHintDescription'>
                    {needsIOSInstructions
                        ? 'Открывайте приложение одним касанием и держите уход под рукой.'
                        : 'Быстрый доступ к растениям и напоминаниям прямо с экрана устройства.'}
                </p>
                {showInstructions && needsIOSInstructions && (
                    <p className='pwaInstallHintInstructions'>
                        В Safari нажмите «Поделиться», затем «На экран Домой».
                        После установки откройте «Лейку» с нового значка.
                    </p>
                )}
                {needsIOSInstructions && (
                    <button
                        className='pwaInstallHintAction'
                        type='button'
                        onClick={() => setShowInstructions(value => !value)}
                    >
                        {showInstructions ? 'Скрыть инструкцию' : 'Как добавить'}
                    </button>
                )}
                {!needsIOSInstructions && (
                    <button
                        className='pwaInstallHintAction'
                        type='button'
                        onClick={install}
                        disabled={installing}
                    >
                        {installing ? 'Открываем…' : 'Установить'}
                    </button>
                )}
            </div>
            <button
                className='pwaInstallHintDismiss'
                type='button'
                aria-label='Скрыть подсказку установки'
                onClick={dismiss}
            >
                ×
            </button>
        </aside>
    )
}

export default PwaInstallHint
