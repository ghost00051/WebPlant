import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';
import { registerServiceWorker } from './utils/pushNotifications.js';
import './utils/pwaInstall.js';


if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        registerServiceWorker()
            .then((reg) => console.log('✅ SW зарегистрирован:', reg.scope))
            .catch((err) => console.error('❌ Ошибка SW:', err))
    })
}

const rootElement = document.getElementById('root')
if (rootElement.dataset.prerendered === 'true') {
    hydrateRoot(rootElement, <App />)
} else {
    createRoot(rootElement).render(<App />)
}
