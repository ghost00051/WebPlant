import './aiTicker.css'
import './dark-theme.css'

const DEFAULT_MESSAGES = [
    'ИИ может работать со сбоями — проверяйте важные советы',
    'Рекомендации помощника носят справочный характер'
]

function AiTicker({ messages = DEFAULT_MESSAGES }) {
    const items = messages.length ? messages : DEFAULT_MESSAGES

    return (
        <div className='aiTicker' role='status' aria-live='polite'>
            <div className='aiTickerViewport'>
                <div className='aiTickerTrack'>
                    {[0, 1].map(groupIndex => (
                        <div
                            className='aiTickerGroup'
                            key={groupIndex}
                            aria-hidden={groupIndex === 1 ? 'true' : undefined}
                        >
                            {items.map((message, index) => (
                                <span className='aiTickerItem' key={`${groupIndex}-${index}`}>
                                    <span className='aiTickerIcon' aria-hidden='true'>
                                        ⚠
                                    </span>
                                    {message}
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default AiTicker
