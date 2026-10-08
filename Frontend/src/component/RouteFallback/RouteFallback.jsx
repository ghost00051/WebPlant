import './RouteFallback.css'

function RouteFallback() {
    return (
        <div className='routeFallback' role='status' aria-live='polite'>
            <span className='routeFallbackSpinner' aria-hidden='true' />
            <p className='routeFallbackText'>Загружаем раздел…</p>
        </div>
    )
}

export default RouteFallback
