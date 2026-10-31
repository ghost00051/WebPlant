import { useEffect, useRef, useState } from 'react'
import {
    flushWateringQueue,
    getPendingWateringCount,
    subscribeToPendingWatering
} from '../../utils/offlineQueue.js'
import './OfflineBanner.css'

function readOnlineState () {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
        return true
    }
    return navigator.onLine
}

function pluralizeWateringMarks (count) {
    const value = Math.abs(Math.trunc(Number(count))) || 0
    const lastDigit = value % 10
    const lastTwoDigits = value % 100

    if (lastDigit === 1 && lastTwoDigits !== 11) {
        return `${value} отметка полива ждёт отправки`
    }
    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
        return `${value} отметки полива ждут отправки`
    }
    return `${value} отметок полива ждут отправки`
}

function buildMessage ({ online, pending, sending }) {
    if (sending && pending > 0) return 'Отправляем отметки полива…'

    if (!online && pending > 0) {
        return `Нет сети — ${pluralizeWateringMarks(pending)}`
    }
    if (!online) return 'Нет сети — показываем сохранённые данные'
    if (pending > 0) return pluralizeWateringMarks(pending)

    return null
}

function OfflineBanner () {
    const [online, setOnline] = useState(readOnlineState)
    const [pending, setPending] = useState(0)
    const [sending, setSending] = useState(false)
    const sendingRef = useRef(false)

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        let active = true

        const unsubscribe = subscribeToPendingWatering(count => {
            if (!active) return
            setPending(Number.isFinite(count) && count > 0 ? count : 0)
        })

        getPendingWateringCount()
            .then(count => {
                if (!active) return
                setPending(Number.isFinite(count) && count > 0 ? count : 0)
            })
            .catch(() => {})

        const flush = () => {
            if (sendingRef.current) return
            sendingRef.current = true
            setSending(true)
            flushWateringQueue()
                .catch(() => {})
                .finally(() => {
                    sendingRef.current = false
                    if (active) setSending(false)
                })
        }

        const handleOnline = () => {
            setOnline(true)
            flush()
        }
        const handleOffline = () => setOnline(false)

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        const initialFlushTimer = window.setTimeout(flush, 0)

        return () => {
            active = false
            window.clearTimeout(initialFlushTimer)
            unsubscribe()
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    const message = buildMessage({ online, pending, sending })

    if (!message) return null

    return (
        <div
            className='offlineBanner'
            role='status'
            aria-live='polite'
            data-state={online ? 'pending' : 'offline'}
        >
            <span className='offlineBannerDot' aria-hidden='true' />
            <span className='offlineBannerText'>{message}</span>
        </div>
    )
}

export default OfflineBanner
