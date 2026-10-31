import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../utils/api.js'
import { describeAiRequestError, fetchWithTimeout } from '../../utils/aiRequest.js'
import './wateringAdvice.css'
import './dark-theme.css'

const DAY_WORD_FORMS = ['день', 'дня', 'дней']

function plural(count, forms) {
    const value = Math.abs(Number(count))
    if (!Number.isFinite(value)) return forms[2]
    const mod10 = value % 10
    const mod100 = value % 100
    if (mod10 === 1 && mod100 !== 11) return forms[0]
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
    return forms[2]
}

function currentIntervalLabel(intervalDays) {
    const value = Number(intervalDays)
    if (!Number.isInteger(value) || value < 1) return ''
    if (value === 1) return 'раз в день'
    return `раз в ${value} ${plural(value, DAY_WORD_FORMS)}`
}

function WateringAdviceDialog({
    open,
    plantName = '',
    species = '',
    location = '',
    currentIntervalDays = null,
    onClose,
    onApply,
    onAnswersChange
}) {
    const [wateringAnswers, setWateringAnswers] = useState([])
    const [wateringMessages, setWateringMessages] = useState([])
    const [wateringAnswer, setWateringAnswer] = useState('')
    const [wateringRecommendation, setWateringRecommendation] = useState(null)
    const [wateringMaxQuestions, setWateringMaxQuestions] = useState(6)
    const [isAskingWateringAdvice, setIsAskingWateringAdvice] = useState(false)
    const [wateringAdviceError, setWateringAdviceError] = useState('')

    const wateringDialogSessionRef = useRef(0)
    const wateringMessagesEndRef = useRef(null)
    const wasOpenRef = useRef(false)
    const onCloseRef = useRef(onClose)
    const onApplyRef = useRef(onApply)
    const onAnswersChangeRef = useRef(onAnswersChange)

    useEffect(() => {
        onCloseRef.current = onClose
    }, [onClose])

    useEffect(() => {
        onApplyRef.current = onApply
    }, [onApply])

    useEffect(() => {
        onAnswersChangeRef.current = onAnswersChange
    }, [onAnswersChange])

    const closeWateringAdvice = useCallback(() => {
        wateringDialogSessionRef.current++
        setIsAskingWateringAdvice(false)
        onCloseRef.current?.()
    }, [])

    const requestWateringAdvice = useCallback(async (answers, sessionId, mode = 'auto') => {
        const plantNameValue = plantName.trim()
        const speciesValue = species.trim()
        const locationValue = location.trim()
        const payload = {
            name: plantNameValue,
            species: speciesValue,
            answers,
            mode
        }
        if (locationValue) payload.location = locationValue

        setIsAskingWateringAdvice(true)
        setWateringAdviceError('')
        try {
            const response = await fetchWithTimeout(`${API_URL}/plants/watering-advice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data.message || 'Не удалось получить рекомендацию')
            }
            if (wateringDialogSessionRef.current !== sessionId) return

            if (Number.isInteger(data.maxQuestions) && data.maxQuestions > 0) {
                setWateringMaxQuestions(data.maxQuestions)
            }

            if (data.type === 'question' && typeof data.question === 'string') {
                setWateringMessages(messages => [...messages, {
                    role: 'assistant',
                    text: data.question,
                    options: Array.isArray(data.options)
                        ? data.options.filter(option => typeof option === 'string' && option.trim()).slice(0, 4)
                        : []
                }])
            } else if (
                data.type === 'recommendation' &&
                Number.isInteger(data.intervalDays) &&
                data.intervalDays >= 1 &&
                data.intervalDays <= 365 &&
                typeof data.reason === 'string'
            ) {
                setWateringRecommendation(data)
            } else {
                throw new Error('ИИ прислал некорректную рекомендацию. Попробуйте ещё раз.')
            }
        } catch (error) {
            if (wateringDialogSessionRef.current !== sessionId) return
            console.error('Ошибка рекомендации частоты полива:', error)
            setWateringAdviceError(describeAiRequestError(error, 'Не удалось получить рекомендацию'))
        } finally {
            if (wateringDialogSessionRef.current === sessionId) {
                setIsAskingWateringAdvice(false)
            }
        }
    }, [plantName, species, location])

    useEffect(() => {
        if (!open) {
            wasOpenRef.current = false
            return
        }
        if (wasOpenRef.current) return
        wasOpenRef.current = true

        const sessionId = wateringDialogSessionRef.current + 1
        wateringDialogSessionRef.current = sessionId
        setWateringAnswers([])
        setWateringMessages([])
        setWateringAnswer('')
        setWateringRecommendation(null)
        setWateringAdviceError('')
        onAnswersChangeRef.current?.([])
        requestWateringAdvice([], sessionId)
    }, [open, requestWateringAdvice])

    useEffect(() => {
        if (!open) return
        wateringMessagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }, [open, isAskingWateringAdvice, wateringMessages, wateringRecommendation])

    const sendWateringAnswer = (rawAnswer, mode = 'auto') => {
        const answer = String(rawAnswer || '').trim()
        const lastQuestion = [...wateringMessages].reverse().find(
            message => message.role === 'assistant'
        )?.text
        const skip = mode === 'recommendation' && !answer
        if (!lastQuestion || isAskingWateringAdvice) return
        if (!answer && !skip) return

        const answerText = answer || 'Пропустить вопрос'
        const nextAnswers = [...wateringAnswers, {
            question: lastQuestion,
            answer: answerText
        }]
        const sessionId = wateringDialogSessionRef.current
        setWateringAnswers(nextAnswers)
        setWateringMessages(messages => [
            ...messages.map(message => ({ ...message, options: [] })),
            { role: 'user', text: answerText }
        ])
        setWateringAnswer('')
        setWateringAdviceError('')
        setWateringRecommendation(null)
        onAnswersChangeRef.current?.(nextAnswers)
        requestWateringAdvice(nextAnswers, sessionId, mode)
    }

    const submitWateringAnswer = event => {
        event.preventDefault()
        sendWateringAnswer(wateringAnswer)
    }

    const skipWateringQuestions = () => {
        sendWateringAnswer('', 'recommendation')
    }

    const refineWateringAdvice = () => {
        if (wateringAnswers.length >= wateringMaxQuestions || isAskingWateringAdvice) return
        setWateringRecommendation(null)
        setWateringAdviceError('')
        requestWateringAdvice(wateringAnswers, wateringDialogSessionRef.current, 'question')
    }

    const applyWateringRecommendation = () => {
        if (!wateringRecommendation) return
        onApplyRef.current?.(wateringRecommendation.intervalDays)
        closeWateringAdvice()
    }

    if (!open) return null

    const lastWateringMessage = wateringMessages[wateringMessages.length - 1]
    const currentQuestionOptions = lastWateringMessage?.role === 'assistant'
        ? (lastWateringMessage.options || [])
        : []
    const speciesLabel = species.trim()
    const locationLabel = location.trim()
    const intervalLabel = currentIntervalLabel(currentIntervalDays)

    return (
        <div
            className='wateringAdviceOverlay'
            onMouseDown={event => {
                if (event.target === event.currentTarget && !isAskingWateringAdvice) {
                    closeWateringAdvice()
                }
            }}
        >
            <section
                className='wateringAdviceDialog'
                role='dialog'
                aria-modal='true'
                aria-labelledby='wateringAdviceTitle'
                aria-describedby='wateringAdviceDescription'
            >
                <header className='wateringAdviceHeader'>
                    <div>
                        <h2 id='wateringAdviceTitle'>Подберём график полива</h2>
                        <p id='wateringAdviceDescription'>
                            Ответьте на несколько вопросов. Рекомендация будет ориентировочной.
                            {intervalLabel && ` Сейчас: ${intervalLabel}.`}
                        </p>
                    </div>
                    <button
                        type='button'
                        className='wateringAdviceClose'
                        onClick={closeWateringAdvice}
                        aria-label='Закрыть диалог'
                    >
                        ×
                    </button>
                </header>
                <div className='wateringAdviceMessages' aria-live='polite'>
                    <p className='wateringAdvicePlant'>
                        Растение: <strong>{plantName.trim()}</strong>
                        {speciesLabel && ` · ${speciesLabel}`}
                        {locationLabel && ` · ${locationLabel}`}
                    </p>
                    <div className='wateringAdviceMessage assistant'>
                        {intervalLabel
                            ? 'Пересмотрю интервал с учётом условий растения. Это не заменяет проверку влажности грунта.'
                            : 'Подберу стартовый интервал с учётом условий. Это не заменяет проверку влажности грунта.'}
                    </div>
                    {wateringMessages.map((message, index) => (
                        <div
                            key={`${message.role}-${index}`}
                            className={`wateringAdviceMessage ${message.role}`}
                        >
                            {message.text}
                        </div>
                    ))}
                    {isAskingWateringAdvice && (
                        <div className='wateringAdviceMessage assistant' role='status'>
                            Подбираю следующий вопрос…
                        </div>
                    )}
                    {wateringRecommendation && (
                        <div className='wateringRecommendation' role='status'>
                            <p className='wateringRecommendationInterval'>
                                Ориентир: раз в {wateringRecommendation.intervalDays} дн.
                            </p>
                            <p>{wateringRecommendation.reason}</p>
                            <p className='wateringRecommendationConfidence'>
                                Уверенность: {
                                    wateringRecommendation.confidence === 'high'
                                        ? 'высокая — условий достаточно для точного ориентира'
                                        : wateringRecommendation.confidence === 'medium'
                                            ? 'средняя — условия типичные, но уточнены не все'
                                            : 'низкая — данных мало, ориентир самый осторожный'
                                }. Проверяйте, просох ли грунт, и корректируйте график.
                            </p>
                            <div className='wateringRecommendationActions'>
                                <button
                                    type='button'
                                    className='wateringRecommendationApply'
                                    onClick={applyWateringRecommendation}
                                >
                                    Применить интервал
                                </button>
                                {wateringAnswers.length < 4 && (
                                    <button
                                        type='button'
                                        className='wateringRecommendationRefine'
                                        onClick={refineWateringAdvice}
                                        disabled={isAskingWateringAdvice}
                                    >
                                        Уточнить условия
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    <div ref={wateringMessagesEndRef} />
                </div>
                {wateringAdviceError && (
                    <div className='wateringAdviceError' role='alert'>
                        <p>{wateringAdviceError}</p>
                        <button
                            type='button'
                            onClick={() => requestWateringAdvice(wateringAnswers, wateringDialogSessionRef.current, 'auto')}
                            disabled={isAskingWateringAdvice}
                        >
                            Попробовать ещё раз
                        </button>
                    </div>
                )}
                {!wateringRecommendation && currentQuestionOptions.length > 0 && (
                    <div className='wateringAdviceOptions' role='group' aria-label='Варианты ответа'>
                        {currentQuestionOptions.map(option => (
                            <button
                                key={option}
                                type='button'
                                onClick={() => sendWateringAnswer(option)}
                                disabled={isAskingWateringAdvice}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                )}
                {!wateringRecommendation && (
                    <form className='wateringAdviceReply' onSubmit={submitWateringAnswer}>
                        <label htmlFor='wateringAdviceAnswer'>
                            {wateringAnswers.length >= wateringMaxQuestions
                                ? 'Получаем рекомендацию'
                                : 'Ваш ответ или свой вариант'}
                        </label>
                        <textarea
                            id='wateringAdviceAnswer'
                            value={wateringAnswer}
                            onChange={event => setWateringAnswer(event.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder='Например: стоит на южном окне, грунт просыхает за 4 дня'
                            disabled={
                                isAskingWateringAdvice ||
                                Boolean(wateringAdviceError) ||
                                wateringAnswers.length >= wateringMaxQuestions ||
                                !wateringMessages.some(message => message.role === 'assistant')
                            }
                        />
                        <div className='wateringAdviceFooter'>
                            <span>
                                {wateringAnswers.length}/{wateringMaxQuestions} уточнений
                                {wateringAnswers.length >= 3 && ' — дальше уже будет рекомендация'}
                            </span>
                            <div className='wateringAdviceFooterButtons'>
                                <button
                                    type='button'
                                    className='wateringAdviceSkip'
                                    onClick={skipWateringQuestions}
                                    disabled={
                                        isAskingWateringAdvice ||
                                        Boolean(wateringAdviceError) ||
                                        wateringAnswers.length >= wateringMaxQuestions ||
                                        !wateringMessages.some(message => message.role === 'assistant')
                                    }
                                >
                                    Хватит вопросов
                                </button>
                                <button
                                    type='submit'
                                    disabled={
                                        !wateringAnswer.trim() ||
                                        isAskingWateringAdvice ||
                                        Boolean(wateringAdviceError) ||
                                        wateringAnswers.length >= wateringMaxQuestions
                                    }
                                >
                                    Ответить
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </section>
        </div>
    )
}

export default WateringAdviceDialog
