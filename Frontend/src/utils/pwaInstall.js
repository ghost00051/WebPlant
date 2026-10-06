let installState = { deferredPrompt: null, installed: false }
const listeners = new Set()

function emitChange() {
    for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault()
        installState = { deferredPrompt: event, installed: false }
        emitChange()
    })

    window.addEventListener('appinstalled', () => {
        installState = { deferredPrompt: null, installed: true }
        emitChange()
    })
}

export function getInstallState() {
    return installState
}

export function subscribeToInstallState(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function clearInstallPrompt() {
    installState = { ...installState, deferredPrompt: null }
    emitChange()
}
