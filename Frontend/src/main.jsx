import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './component/ErrorBoundary/ErrorBoundary.jsx';
import { registerServiceWorker } from './utils/pushNotifications.js';
import { startVisitTracking } from './utils/visits.js';
import './utils/pwaInstall.js';


if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        registerServiceWorker()
            .then((reg) => console.log('✅ SW зарегистрирован:', reg.scope))
            .catch((err) => console.error('❌ Ошибка SW:', err))
    })
}

const rootElement = document.getElementById('root')
const app = (
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
)
if (rootElement.dataset.prerendered === 'true') {
    hydrateRoot(rootElement, app)
} else {
    createRoot(rootElement).render(app)
}

startVisitTracking()
