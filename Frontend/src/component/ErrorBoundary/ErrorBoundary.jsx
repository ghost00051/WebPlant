import { Component } from 'react'

function buildErrorDetail(error, errorInfo) {
    const isError = error instanceof Error

    return {
        context: 'error-boundary',
        message: isError ? error.message : String(error),
        stack: isError && error.stack ? error.stack : '',
        componentStack: errorInfo?.componentStack || '',
        route: typeof window !== 'undefined' ? window.location.pathname : '',
        timestamp: new Date().toISOString(),
    }
}

function reportUiError(error, errorInfo) {
    const detail = buildErrorDetail(error, errorInfo)

    try {
        const reporter = typeof window !== 'undefined'
            ? window.__webplantErrorReporter
            : undefined
        if (typeof reporter === 'function') {
            reporter({ error, info: errorInfo, detail })
        }
    } catch (reporterError) {
        console.warn('Репортер ошибок недоступен:', reporterError)
    }

    console.error('Необработанная ошибка интерфейса:', error, errorInfo, detail)
}

class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error, errorInfo) {
        reportUiError(error, errorInfo)
    }

    handleReload = () => {
        window.location.reload()
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    role='alert'
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        minHeight: '100vh',
                        padding: '24px',
                        textAlign: 'center'
                    }}
                >
                    <h1>Что-то пошло не так</h1>
                    <p>Произошла непредвиденная ошибка. Перезагрузите страницу, чтобы продолжить.</p>
                    <button type='button' onClick={this.handleReload}>
                        Перезагрузить страницу
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
