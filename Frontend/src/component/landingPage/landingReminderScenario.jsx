import { useState } from 'react'
import { Link } from 'react-router-dom'
import './landingReminderScenario.css'

function pluralizePlants(count) {
    const value = Math.abs(Number(count)) || 0
    const mod100 = value % 100
    const mod10 = value % 10
    if (mod100 >= 11 && mod100 <= 14) return 'растений'
    if (mod10 === 1) return 'растение'
    if (mod10 >= 2 && mod10 <= 4) return 'растения'
    return 'растений'
}

function LandingReminderScenario({ dueLeft }) {
    const [remindersOn, setRemindersOn] = useState(false)
    const remaining = Math.max(0, Number(dueLeft) || 0)

    return (
        <div className='landingReminderScenario'>
            <div className='landingReminderHeading'>
                <span className='landingReminderIcon' aria-hidden='true'>
                    ☀
                </span>
                <p className='landingReminderTitle'>Сегодня полить нечего</p>
            </div>
            <p className='landingReminderText' aria-live='polite'>
                {remaining > 0
                    ? `В демо-саде ещё ждут полива: ${remaining} ${pluralizePlants(remaining)}. Отметьте полив справа — и день опустеет: «Лейка» сразу пересчитает следующий.`
                    : 'Все растения в демо политы. В приложении «Лейка» в такой день покажет, когда следующий полив, и напомнит заранее.'}
            </p>
            {remindersOn ? (
                <p className='landingReminderStatus' role='status'>
                    Напоминание включено в демо: следующий полив — завтра в 09:00.
                    С аккаунтом оно придёт push-уведомлением или в Telegram/MAX.{' '}
                    <Link to='/register'>Создать аккаунт</Link>
                </p>
            ) : (
                <button
                    type='button'
                    className='landingReminderButton'
                    onClick={() => setRemindersOn(true)}
                >
                    Включить напоминания
                </button>
            )}
        </div>
    )
}

export default LandingReminderScenario
