import { Component } from 'react'

class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error, errorInfo) {
        console.error('Необработанная ошибка интерфейса:', error, errorInfo)
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
