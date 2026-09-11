import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { registerServiceWorker } from './utils/pushNotifications.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        registerServiceWorker()
            .then((reg) => console.log('✅ SW зарегистрирован:', reg.scope))
            .catch((err) => console.error('❌ Ошибка SW:', err))
    })
}

createRoot(document.getElementById('root')).render(<App />);