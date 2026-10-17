import { useState, useRef, useEffect } from 'react'
import './chat.css'
import './dark-theme.css'
import './adaptiv.css'
import IconLeaf from '../../assets/IconLeaf.svg'
import IconMenu from '../../assets/IconMenu.svg'
import IconSend from '../../assets/IconSend.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { API_URL } from '../../utils/api.js'

const CHAT_TIMEOUT_MS = 30000
const HISTORY_LIMIT = 50

const GREETING = 'Привет! Я ИИ-помощник — помогу уследить за поливом и уходом за растениями. Напиши «Что полить?», «Покажи график» или «Сколько у меня растений?» — всё покажу.'

function Chat() {

    const [messages, setMessages] = useState([
        {
            id: 'greeting',
            role: 'assistant',
            text: GREETING,
            createdAt: new Date().toISOString(),
        },
    ])
    const [input, setInput] = useState('')
    const [isTyping, setIsTyping] = useState(false)
    const [sessionId, setSessionId] = useState(null)

    const listRef = useRef(null)
    const inputRef = useRef(null)
    const bottomRef = useRef(null)

    useEffect(() => {
        const vv = window.visualViewport
        let keyboardOpen = false

        const update = () => {
            const viewportTop = vv?.offsetTop ?? 0
            const viewportHeight = vv?.height ?? window.innerHeight
            const keyboardHeight = Math.max(
                0,
                window.innerHeight - viewportHeight
            )

            document.documentElement.style.setProperty('--visual-viewport-top', `${viewportTop}px`)
            document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`)

            const inputFocused = document.activeElement === inputRef.current
            const isKeyboardOpen = inputFocused || (keyboardOpen && keyboardHeight > 100)
            if (isKeyboardOpen) {
                document.body.classList.add('keyboard-open')
                if (!keyboardOpen && listRef.current) {
                    listRef.current.scrollTop = listRef.current.scrollHeight
                }
            } else {
                document.body.classList.remove('keyboard-open')
            }

            keyboardOpen = isKeyboardOpen
        }

        vv?.addEventListener('resize', update)
        vv?.addEventListener('scroll', update)
        window.addEventListener('resize', update)
        window.addEventListener('focusin', update)
        window.addEventListener('focusout', update)

        update()

        return () => {
            vv?.removeEventListener('resize', update)
            vv?.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
            window.removeEventListener('focusin', update)
            window.removeEventListener('focusout', update)
            document.documentElement.style.removeProperty('--visual-viewport-top')
            document.documentElement.style.removeProperty('--visual-viewport-height')
            document.body.classList.remove('keyboard-open')
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), 15000)

        const loadHistory = async () => {
            try {
                const res = await fetch(`${API_URL}/chat/history?limit=${HISTORY_LIMIT}`, {
                    credentials: 'include',
                    signal: controller.signal
                })
                if (!res.ok) return

                const data = await res.json()
                if (cancelled) return

                if (data?.sessionId) setSessionId(data.sessionId)

                const items = Array.isArray(data?.items) ? data.items : []
                if (!items.length) return

                setMessages([
                    {
                        id: 'greeting',
                        role: 'assistant',
                        text: GREETING,
                        createdAt: new Date().toISOString(),
                    },
                    ...items.map(item => ({
                        id: `h-${item.id}`,
                        role: item.role === 'user' ? 'user' : 'assistant',
                        text: item.text,
                        createdAt: item.createdAt,
                    })),
                ])
            } catch (error) {
                if (error?.name !== 'AbortError') console.error('Chat history error:', error)
            } finally {
                window.clearTimeout(timer)
            }
        }

        loadHistory()

        return () => {
            cancelled = true
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [])

    const sendMessage = async (rawText) => {
        const text = (rawText ?? input).trim()
        if (!text || isTyping) return

        const userMsg = {
            id: `u-${Date.now()}`,
            role: 'user',
            text,
            createdAt: new Date().toISOString(),
        }

        setMessages((prev) => [...prev, userMsg])
        setInput('')
        setIsTyping(true)

        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)

        try {
            const res = await fetch(`${API_URL}/chat/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                signal: controller.signal,
                body: JSON.stringify({ message: text, sessionId: sessionId || undefined })
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.message || `HTTP ${res.status}`)
            }

            const data = await res.json()
            if (data?.sessionId) setSessionId(data.sessionId)

            setMessages((prev) => [
                ...prev,
                {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    text: data.text,
                    createdAt: new Date().toISOString(),
                },
            ])
        } catch (e) {
            const timedOut = e?.name === 'AbortError'
            console.error('Chat error:', e)
            setMessages((prev) => [
                ...prev,
                {
                    id: `e-${Date.now()}`,
                    role: 'assistant',
                    text: timedOut
                        ? '⏳ Алиса не успела ответить. Попробуйте ещё раз — я на связи.'
                        : (e?.message && e.message !== 'Failed to fetch'
                            ? `⚠️ ${e.message}`
                            : '⚠️ Что-то пошло не так. Попробуй ещё раз.'),
                    createdAt: new Date().toISOString(),
                },
            ])
        } finally {
            window.clearTimeout(timer)
            setIsTyping(false)
        }
    }

    const clearHistory = async () => {
        if (isTyping) return

        if (!sessionId) {
            setMessages((prev) => prev.filter((message) => message.id === 'greeting'))
            return
        }
        if (!window.confirm('Очистить историю чата?')) return

        try {
            const res = await fetch(`${API_URL}/chat/history`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ sessionId })
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.message || `HTTP ${res.status}`)
            }

            setSessionId(null)
            setMessages([
                {
                    id: 'greeting',
                    role: 'assistant',
                    text: GREETING,
                    createdAt: new Date().toISOString(),
                },
            ])
        } catch (error) {
            console.error('Clear chat error:', error)
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    return (
        <div className='chatWindow'>
            <div className='chatHeader'>
                <div className='chatHeaderLeft'>
                    <div className='chatAvatar'>
                        <img src={IconLeaf} alt="" />
                    </div>
                    <div>
                        <p className='chatHeaderTitle'>ИИ-помощник Лейка</p>
                        <p className='chatHeaderSubtitle'>Онлайн • помогу с поливом и уходом</p>
                    </div>
                </div>
                <button
                    className='chatMenuBtn'
                    type='button'
                    aria-label='Очистить историю'
                    title='Очистить историю'
                    onClick={clearHistory}
                >
                    <ThemedIcon src={IconMenu} alt="" />
                </button>
            </div>
            <div className='chatMessages' ref={listRef}>
                {messages.map((m) => (
                    <div
                        key={m.id}
                        className={`chatRow ${m.role === 'user' ? 'chatRowUser' : ''}`}
                    >
                        <div className={`chatBubble ${m.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAi'}`}>
                            <p className='chatBubbleText'>{m.text}</p>
                            {m.advice && (
                                <div className='chatAiAdviceBox'>
                                    <span className='chatAiAdviceLabel'>Совет ИИ</span>
                                    <p className='chatAiAdviceText'>{m.advice}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className='chatRow'>
                        <div className='chatBubble chatBubbleAi chatBubbleTyping'>
                            <span className='chatDot' />
                            <span className='chatDot' />
                            <span className='chatDot' />
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div className='chatInputArea'>
                <div className='chatInputWrapper'>
                    <input type="file" />
                    <textarea
                        ref={inputRef}
                        className='chatInputField'
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder='Спросите про полив или уход'
                        rows={1}
                        disabled={isTyping}
                    />
                    <button
                        type='button'
                        className='chatActionBtn'
                        onClick={() => sendMessage()}
                        disabled={isTyping || !input.trim()}
                        aria-label='Отправить'
                    >
                        <img src={IconSend} alt="" />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default Chat