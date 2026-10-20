import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './component/ErrorBoundary/ErrorBoundary.jsx';
import { registerServiceWorker } from './utils/pushNotifications.js';
import { startVisitTracking } from './utils/visits.js';
import './utils/pwaInstall.js';


if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        registerServiceWorker()
            .catch((err) => console.error('❌ Ошибка SW:', err))
    })
}

function cleanupPrerenderedSkeleton (rootElement, attempt = 0) {
    if (rootElement.dataset.skeleton !== 'true') return

    const skeletonStillVisible = rootElement.querySelector('.ctpSkeleton')

    if (skeletonStillVisible && attempt < 180) {
        window.requestAnimationFrame(() =>
            cleanupPrerenderedSkeleton(rootElement, attempt + 1)
        )
        return
    }

    delete rootElement.dataset.skeleton
    document.getElementById('app-private-skeleton')?.remove()
}

const rootElement = document.getElementById('root')

if (!rootElement) {
    throw new Error('Не найден контейнер приложения #root')
}

const app = (
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
)

if (rootElement.dataset.prerendered === 'true') {
    hydrateRoot(rootElement, app)
} else {
    createRoot(rootElement).render(app)

    if (rootElement.dataset.skeleton === 'true') {
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() =>
                cleanupPrerenderedSkeleton(rootElement)
            )
        } else {
            delete rootElement.dataset.skeleton
        }
    }
}

startVisitTracking()
