import { useState, useRef, useEffect } from 'react'
import './chat.css'
import './adaptiv.css'
import IconLeaf from '../../assets/IconLeaf.svg'
import IconMenu from '../../assets/IconMenu.svg'
import IconSend from '../../assets/IconSend.svg'
import IconMic from '../../assets/IconMic.svg'
import { API_URL } from '../../utils/api.js'

const GREETING = 'Привет! Я Алиса 💚 Помогу с поливом и уходом за растениями. Спроси: «Что полить?», «Покажи график» или «Сколько у меня растений?»'

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

        try {
            const res = await fetch(`${API_URL}/chat/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ message: text })
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.message || `HTTP ${res.status}`)
            }

            const data = await res.json()

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
            console.error('Chat error:', e)
            setMessages((prev) => [
                ...prev,
                {
                    id: `e-${Date.now()}`,
                    role: 'assistant',
                    text: '⚠️ Что-то пошло не так. Попробуй ещё раз.',
                    createdAt: new Date().toISOString(),
                },
            ])
        } finally {
            setIsTyping(false)
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
                        <p className='chatHeaderSubtitle'>Онлайн • знает 12 ваших растений</p>
                    </div>
                </div>
                <button className='chatMenuBtn' aria-label='Меню'>
                    <img src={IconMenu} alt="" />
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

            {/* Подсказки над вводом
            <div className='chatSuggestionsWrapper'>
                <div className='chatSuggestions'>
                    {SUGGESTIONS.map((s) => (
                        <button
                            key={s}
                            type='button'
                            className='chatSuggestion'
                            onClick={() => sendMessage(s)}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div> */}

            <div className='chatInputArea'>
                <div className='chatInputWrapper'>
                    {/* <button className='chatAttachBtn' aria-label='Прикрепить файл'>
                        <IconPaperclip />
                    </button> */}
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
                        aria-label={input.trim() ? 'Отправить' : 'Голосовой ввод'}
                    >
                        <img src={IconMic} alt="" />
                    </button>
                    <button
                        type='button'
                        className='chatActionBtn'
                        onClick={() => sendMessage()}
                        disabled={isTyping || !input.trim()}
                        aria-label={input.trim() ? 'Отправить' : 'Голосовой ввод'}
                    >
                        <img src={IconSend} alt="" />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default Chat