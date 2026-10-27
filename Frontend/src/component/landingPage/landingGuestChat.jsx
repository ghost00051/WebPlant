import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isApiError, sendGuestChatMessage } from '../../utils/api.js'
import {
    GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS,
    appendGuestChatMessage,
    countGuestChatAnswers,
    readGuestChatHistory,
    saveGuestChatHistory
} from '../../utils/guestChat.js'
import { trackEvent } from '../../utils/productEvents.js'
import './landingGuestChat.css'

const MAX_QUESTION_LENGTH = 1000
const GREETING =
    'Здравствуйте! Я Алиса, помощник «Лейки». Спросите про полив, свет или почему желтеют листья — отвечу без регистрации.'

const SUGGESTIONS = [
    'Как часто поливать монстеру?',
    'Почему желтеют листья у фикуса?',
    'Сколько света нужно сансевиерии?'
]

function describeChatError(error) {
    const status = Number(error?.status) || 0

    if (error?.code === 'timeout') {
        return {
            kind: 'unavailable',
            message:
                'Алиса не успела ответить. Проверьте связь и попробуйте ещё раз — ваш вопрос не потерялся.'
        }
    }

    if (error?.code === 'network') {
        return {
            kind: 'unavailable',
            message:
                'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз — или создайте аккаунт, и мы сохраним вопросы.'
        }
    }

    if (status === 401) {
        return {
            kind: 'auth',
            message:
                'Гостевой чат не открылся. Войдите или создайте аккаунт — там Алиса ответит на ваши вопросы.'
        }
    }

    if (status === 429) {
        return {
            kind: 'limit',
            message:
                error?.message ||
                'На сегодня лимит вопросов без регистрации исчерпан. Создайте аккаунт, чтобы продолжить.'
        }
    }

    if (status === 503) {
        return {
            kind: 'unavailable',
            message:
                error?.message ||
                'Алиса временно недоступна. Попробуйте чуть позже — или создайте аккаунт, и мы сохраним ваши вопросы.'
        }
    }

    if (isApiError(error) && error.message) {
        return { kind: 'error', message: error.message }
    }

    return {
        kind: 'error',
        message:
            'Не получилось получить ответ. Проверьте подключение и попробуйте ещё раз.'
    }
}

function LandingGuestChat() {
    const [messages, setMessages] = useState(() => [
        { id: 'greeting', role: 'assistant', text: GREETING }
    ])
    const [input, setInput] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [error, setError] = useState(null)
    const [answerCount, setAnswerCount] = useState(0)
    const [lastQuestion, setLastQuestion] = useState('')
    const storedRef = useRef({ version: 1, sessionId: null, messages: [] })
    const sessionIdRef = useRef(null)
    const idRef = useRef(0)
    const hydratedRef = useRef(false)
    const requestRef = useRef(null)
    const logRef = useRef(null)

    useEffect(() => {
        if (hydratedRef.current) return
        hydratedRef.current = true

        const stored = readGuestChatHistory()
        if (!stored.messages.length) return

        storedRef.current = stored
        sessionIdRef.current = stored.sessionId
        setMessages(previous => [
            ...previous,
            ...stored.messages.map(message => ({
                id: `stored-${++idRef.current}`,
                role: message.role,
                text: message.text
            }))
        ])
        setAnswerCount(countGuestChatAnswers(stored))
    }, [])

    useEffect(() => {
        return () => {
            requestRef.current?.abort()
        }
    }, [])

    useEffect(() => {
        const log = logRef.current
        if (!log) return
        log.scrollTop = log.scrollHeight
    }, [messages, isSending])

    const requestAnswer = async question => {
        setIsSending(true)
        setError(null)
        setLastQuestion(question)

        const controller = new AbortController()
        requestRef.current = controller

        try {
            const answer = await sendGuestChatMessage({
                message: question,
                sessionId: sessionIdRef.current,
                signal: controller.signal
            })

            if (answer.sessionId) sessionIdRef.current = answer.sessionId

            setMessages(previous => [
                ...previous,
                {
                    id: `answer-${++idRef.current}`,
                    role: 'assistant',
                    text: answer.text
                }
            ])

            let history = appendGuestChatMessage(storedRef.current, {
                role: 'user',
                text: question
            })
            history = appendGuestChatMessage(history, {
                role: 'assistant',
                text: answer.text
            })
            history.sessionId = sessionIdRef.current
            storedRef.current = history
            saveGuestChatHistory(history)
            setAnswerCount(countGuestChatAnswers(history))
            setLastQuestion('')
            trackEvent('chat_message', { hasPhoto: false, isGuest: true })
        } catch (requestError) {
            if (requestError?.name === 'AbortError' || requestError?.code === 'aborted') {
                return
            }
            setError(describeChatError(requestError))
        } finally {
            requestRef.current = null
            setIsSending(false)
        }
    }

    const sendMessage = rawQuestion => {
        const question = (rawQuestion ?? input).trim()
        if (!question || isSending) return

        if (question.length > MAX_QUESTION_LENGTH) {
            setError({
                kind: 'validation',
                message: 'Вопрос слишком длинный: до 1000 символов. Сократите его.'
            })
            return
        }

        setInput('')
        setError(null)
        setMessages(previous => [
            ...previous,
            { id: `question-${++idRef.current}`, role: 'user', text: question }
        ])
        void requestAnswer(question)
    }

    const handleSubmit = event => {
        event.preventDefault()
        sendMessage()
    }

    const retryLastQuestion = () => {
        if (!lastQuestion || isSending) return
        void requestAnswer(lastQuestion)
    }

    const showSuggestions = messages.length === 1 && !isSending
    const showSaveCta = answerCount >= GUEST_CHAT_SAVE_PROMPT_AFTER_ANSWERS

    return (
        <section className='landingGuestChat' aria-labelledby='landingGuestChatTitle'>
            <div className='landingGuestChatIntro'>
                <p className='landingEyebrow'>Попробуйте до регистрации</p>
                <h2 id='landingGuestChatTitle'>Спросите о своих растениях</h2>
                <p className='landingGuestChatLead'>
                    Опишите, что происходит с растением, или спросите, как часто его
                    поливать. ИИ-помощник «Лейки» ответит сразу — без аккаунта.
                </p>
                <ul className='landingGuestChatFacts'>
                    <li>Достаточно вопроса словами — фото не обязательно.</li>
                    <li>Гостю доступно до 40 вопросов в день.</li>
                    <li>После трёх ответов предложим сохранить переписку в аккаунте.</li>
                </ul>
            </div>

            <div
                className='landingChatPanel'
                role='group'
                aria-label='Гостевой чат с ИИ-помощником «Лейки»'
            >
                <div className='landingChatHeader'>
                    <span className='landingChatAvatar' aria-hidden='true'>
                        ✦
                    </span>
                    <span className='landingChatHeaderText'>
                        <strong>Алиса</strong>
                        <small>Помощник «Лейки» · онлайн</small>
                    </span>
                    <span className='landingChatCounter'>
                        {answerCount > 0 ? `Ответов: ${answerCount}` : 'Без регистрации'}
                    </span>
                </div>

                <div
                    className='landingChatLog'
                    role='log'
                    aria-live='polite'
                    aria-relevant='additions'
                    aria-busy={isSending}
                    aria-label='Переписка с Алисой'
                    ref={logRef}
                >
                    {messages.map(message => (
                        <p
                            key={message.id}
                            className={`landingChatMessage landingChatMessage-${message.role}`}
                        >
                            {message.text}
                        </p>
                    ))}
                    {isSending && (
                        <p className='landingChatMessage landingChatMessage-assistant landingChatTyping'>
                            <span aria-hidden='true'>Алиса печатает…</span>
                            <span className='landingChatDots' aria-hidden='true'>
                                <i />
                                <i />
                                <i />
                            </span>
                        </p>
                    )}
                </div>

                {showSuggestions && (
                    <div
                        className='landingChatSuggestions'
                        role='group'
                        aria-label='Примеры вопросов'
                    >
                        {SUGGESTIONS.map(suggestion => (
                            <button
                                key={suggestion}
                                type='button'
                                className='landingChatSuggestion'
                                onClick={() => sendMessage(suggestion)}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                )}

                {error && (
                    <div className='landingChatError' role='alert'>
                        <p>{error.message}</p>
                        <div className='landingChatErrorActions'>
                            {lastQuestion && error.kind !== 'validation' && (
                                <button
                                    type='button'
                                    className='landingChatRetry'
                                    onClick={retryLastQuestion}
                                    disabled={isSending}
                                >
                                    Повторить вопрос
                                </button>
                            )}
                            <Link className='landingChatRegisterLink' to='/register'>
                                Создать аккаунт и сохранить вопросы
                            </Link>
                        </div>
                    </div>
                )}

                <form className='landingChatForm' onSubmit={handleSubmit}>
                    <label className='landingChatInputLabel' htmlFor='landing-guest-chat-input'>
                        Ваш вопрос о растении
                    </label>
                    <div className='landingChatFormRow'>
                        <input
                            id='landing-guest-chat-input'
                            className='landingChatInput'
                            type='text'
                            name='guest-chat-question'
                            placeholder='Например: почему желтеют листья у фикуса?'
                            autoComplete='off'
                            maxLength={MAX_QUESTION_LENGTH}
                            value={input}
                            disabled={isSending}
                            onChange={event => setInput(event.target.value)}
                        />
                        <button
                            type='submit'
                            className='landingChatSend'
                            disabled={isSending || !input.trim()}
                        >
                            {isSending ? 'Ждём ответ…' : 'Спросить'}
                        </button>
                    </div>
                </form>

                {showSaveCta && (
                    <div className='landingChatSave'>
                        <p>
                            <strong>Сохраните вопросы и продолжите.</strong> Переписка и
                            рекомендации перенесутся в новый аккаунт — начинать заново не
                            придётся.
                        </p>
                        <Link className='landingChatSaveAction' to='/register'>
                            Сохранить и продолжить
                        </Link>
                    </div>
                )}

                <p className='landingChatPolicy'>
                    Ответы ИИ — ориентир по уходу, а не диагноз. Регистрация бесплатная,{' '}
                    <Link to='/register'>начать можно за минуту</Link>.
                </p>
            </div>
        </section>
    )
}

export default LandingGuestChat
