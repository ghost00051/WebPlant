import { useEffect, useRef } from 'react'
import { PLANT_COUNT_PRESETS } from '../../utils/registrationOnboarding.js'
import './registrationOnboarding.css'

function answersLabel(count) {
    const value = Math.abs(Number(count)) || 0
    const mod100 = value % 100
    const mod10 = value % 10
    if (mod100 >= 11 && mod100 <= 14) return `${value} ответов`
    if (mod10 === 1 && mod100 !== 11) return `${value} ответ`
    if (mod10 >= 2 && mod10 <= 4) return `${value} ответа`
    return `${value} ответов`
}

function plantsLabel(count) {
    const value = Math.abs(Number(count)) || 0
    const mod100 = value % 100
    const mod10 = value % 10
    if (mod100 >= 11 && mod100 <= 14) return `${value} растений`
    if (mod10 === 1) return `${value} растение`
    if (mod10 >= 2 && mod10 <= 4) return `${value} растения`
    return `${value} растений`
}

function RegistrationOnboarding({
    carriedChatAnswers = 0,
    guestChatLinked = false,
    wantedPlantsCount = 0,
    onFinish
}) {
    const dialogRef = useRef(null)
    const carried = Number(carriedChatAnswers) > 0 ? Number(carriedChatAnswers) : 0
    const wanted = Number(wantedPlantsCount) > 0 ? Number(wantedPlantsCount) : 0
    const chatLinked = guestChatLinked === true

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return undefined

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        const preset = dialog.querySelector('.registrationOnboardingPreset')
        if (preset) preset.focus()

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [])

    const handleKeyDown = event => {
        if (event.key === 'Escape') {
            event.stopPropagation()
            onFinish({ skip: true })
            return
        }

        if (event.key !== 'Tab') return

        const dialog = dialogRef.current
        if (!dialog) return

        const focusable = Array.from(
            dialog.querySelectorAll('button:not([disabled])')
        )
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

    return (
        <div className='registrationOnboardingOverlay'>
            <section
                className='registrationOnboardingCard'
                role='dialog'
                aria-modal='true'
                aria-labelledby='registrationOnboardingTitle'
                aria-describedby='registrationOnboardingDescription'
                ref={dialogRef}
                onKeyDown={handleKeyDown}
            >
                <p className='registrationOnboardingEyebrow'>Аккаунт создан</p>
                <h2 id='registrationOnboardingTitle'>Сколько у вас растений?</h2>
                <p id='registrationOnboardingDescription'>
                    Подскажем, с чего начать: интервал полива, напоминания и первые
                    шаги в «Лейке» — под размер вашего сада.
                </p>

                {carried > 0 && (
                    <p className='registrationOnboardingCarry' role='status'>
                        <span aria-hidden='true'>✦</span>
                        <span>
                            {chatLinked
                                ? (
                                    <>
                                        <strong>Ваши вопросы и диагноз уже в аккаунте.</strong>{' '}
                                        Перенесли {answersLabel(carried)} из демо-чата Алисы.
                                    </>
                                    )
                                : (
                                    <>
                                        <strong>Вопросы и диагноз сохранены на этом устройстве.</strong>{' '}
                                        {answersLabel(carried)} из демо-чата Алисы остаются в
                                        памяти браузера — перенесём их в аккаунт, когда сервер
                                        подтвердит перенос.
                                    </>
                                    )}
                        </span>
                    </p>
                )}

                {wanted > 0 && (
                    <p className='registrationOnboardingGarden' role='status'>
                        <span aria-hidden='true'>✦</span>
                        <span>
                            <strong>Растения из общего сада ждут.</strong> Перенесём{' '}
                            {plantsLabel(wanted)} — нажмите «Добавить», и мы откроем
                            добавление с уже отмеченными растениями.
                        </span>
                    </p>
                )}

                <div
                    className='registrationOnboardingPresets'
                    role='group'
                    aria-label='Количество растений'
                >
                    {PLANT_COUNT_PRESETS.map(preset => (
                        <button
                            type='button'
                            key={preset.id}
                            className='registrationOnboardingPreset'
                            onClick={() => onFinish({ preset: preset.id })}
                        >
                            <span className='registrationOnboardingPresetLabel'>
                                {preset.label}
                            </span>
                            <span className='registrationOnboardingPresetHint'>
                                {preset.description}
                            </span>
                        </button>
                    ))}
                </div>

                <div className='registrationOnboardingActions'>
                    {wanted > 0 && (
                        <button
                            type='button'
                            className='registrationOnboardingChat'
                            onClick={() => onFinish({ transferWanted: true })}
                        >
                            Добавить {plantsLabel(wanted)} из общего сада
                        </button>
                    )}
                    {carried > 0 && (
                        <button
                            type='button'
                            className='registrationOnboardingChat'
                            onClick={() => onFinish({ openChat: true })}
                        >
                            Открыть чат с Алисой
                        </button>
                    )}
                    <button
                        type='button'
                        className='registrationOnboardingSkip'
                        onClick={() => onFinish({ skip: true })}
                    >
                        Пропустить
                    </button>
                </div>
            </section>
        </div>
    )
}

export default RegistrationOnboarding
