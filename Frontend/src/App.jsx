import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigationType,
  useParams
} from 'react-router-dom'
import LandingPage from './component/landingPage/landingPage.jsx'
import PlantsIndexPage from './component/PlantsGuide/PlantsIndexPage.jsx'
import PlantsDetailPage from './component/PlantsGuide/PlantsDetailPage.jsx'
import CareIndexPage from './component/CareGuide/CareIndexPage.jsx'
import CareDetailPage from './component/CareGuide/CareDetailPage.jsx'
import ContentPage from './component/ContentPage/ContentPage.jsx'
import NotFoundPage from './component/ContentPage/NotFound.jsx'
import SeoMetadata from './component/SeoMetadata/SeoMetadata.jsx'
import RouteFallback from './component/RouteFallback/RouteFallback.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { clearAppBadge } from './utils/appBadge.js'
import { startAppBadgeSync } from './utils/appBadgeSync.js'
import './styles/dark-theme.css'
import './styles/skip-link.css'

const Registration = lazy(() =>
  import('./component/registration/registration.jsx')
)
const Home = lazy(() => import('./component/home/home.jsx'))
const EditProfile = lazy(() =>
  import('./component/editProfile/editProfile.jsx')
)
const MyPlant = lazy(() => import('./component/myPlant/myPlant.jsx'))
const AddPlantPage = lazy(() =>
  import('./component/addPlants/AddPlantPage.jsx')
)
const Notification = lazy(() =>
  import('./component/notifications/notifications.jsx')
)
const ResetPassword = lazy(() =>
  import('./component/resetPassword/resetPassword.jsx')
)
const CookieConsentManager = lazy(() =>
  import('./component/CookieConsentManager/CookieConsentManager.jsx')
)
const SharedGardenPage = lazy(() =>
  import('./component/sharedGarden/SharedGardenPage.jsx')
)

const SCROLL_STATES_KEY = 'webplant-scroll-states'
const MAX_SCROLL_STATES = 40
const SCROLL_RESTORE_TIMEOUT_MS = 2400
const SCROLL_CAPTURE_SUPPRESS_MS = 200
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

let scrollStates = null
let persistTimer = null

function readScrollStates () {
  if (scrollStates) return scrollStates
  scrollStates = new Map()
  try {
    const raw = window.sessionStorage.getItem(SCROLL_STATES_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue
        scrollStates.set(key, {
          path: typeof value.path === 'string' ? value.path : '',
          windowTop: Math.max(0, Math.round(Number(value.windowTop) || 0)),
          containers: value.containers && typeof value.containers === 'object'
            ? { ...value.containers }
            : {}
        })
      }
    }
  } catch {
    scrollStates = new Map()
  }
  return scrollStates
}

function persistScrollStates () {
  if (!scrollStates) return
  try {
    const entries = [...scrollStates.entries()].slice(-MAX_SCROLL_STATES)
    scrollStates = new Map(entries)
    window.sessionStorage.setItem(SCROLL_STATES_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch (error) {
    console.warn('Не удалось сохранить позиции прокрутки:', error)
  }
}

function scheduleScrollStatePersist () {
  if (persistTimer) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistScrollStates()
  }, 300)
}

function getScrollState (key, create) {
  if (!key) return null
  const states = readScrollStates()
  let state = states.get(key)
  if (!state && create) {
    state = { path: '', windowTop: 0, containers: {} }
    states.set(key, state)
  }
  return state || null
}

function scrollContainerKey (element) {
  if (!element || element.nodeType !== 1) return null
  if (element.id) return `#${element.id}`
  if (typeof element.className !== 'string') return null
  const classes = element.className.trim().split(/\s+/).filter(Boolean)
  if (!classes.length) return null
  return `${element.tagName.toLowerCase()}.${classes.join('.')}`
}

function findScrollContainer (key) {
  if (!key) return null
  try {
    if (key.startsWith('#')) return document.getElementById(key.slice(1))
    return document.querySelector(key)
  } catch {
    return null
  }
}

function documentScrollTop () {
  const scrolling = document.scrollingElement || document.documentElement
  return Math.max(0, Math.round((scrolling && scrolling.scrollTop) || window.scrollY || 0))
}

function captureScrollState (state, event) {
  if (!state) return
  const target = event.target
  const isDocumentTarget = !target || target === document || target === window ||
    target === document.documentElement || target === document.body ||
    target === document.scrollingElement
  if (isDocumentTarget) {
    state.windowTop = documentScrollTop()
    return
  }
  if (target.nodeType !== 1) return
  const key = scrollContainerKey(target)
  if (!key) return
  const top = Math.max(0, Math.round(target.scrollTop || 0))
  if (top > 0) state.containers[key] = top
  else delete state.containers[key]
}

function restoreScrollState (state) {
  const deadline = performance.now() + SCROLL_RESTORE_TIMEOUT_MS
  let cancelled = false
  const cancel = () => {
    cancelled = true
    document.removeEventListener('wheel', cancel, true)
    document.removeEventListener('touchstart', cancel, true)
    document.removeEventListener('keydown', cancel, true)
  }
  document.addEventListener('wheel', cancel, true)
  document.addEventListener('touchstart', cancel, true)
  document.addEventListener('keydown', cancel, true)

  const targetWindowTop = state ? Math.max(0, Math.round(Number(state.windowTop) || 0)) : 0
  const containers = state && state.containers ? Object.entries(state.containers) : []

  const apply = () => {
    if (cancelled) return
    let pending = false
    const scrolling = document.scrollingElement || document.documentElement
    const maxWindowTop = Math.max(0, (scrolling ? scrolling.scrollHeight : 0) - window.innerHeight)
    if (maxWindowTop < targetWindowTop) pending = true
    const desiredWindowTop = Math.min(targetWindowTop, maxWindowTop)
    if (documentScrollTop() !== desiredWindowTop) window.scrollTo(0, desiredWindowTop)

    for (const [key, rawTop] of containers) {
      const element = findScrollContainer(key)
      if (!element) {
        pending = true
        continue
      }
      const top = Math.max(0, Math.round(Number(rawTop) || 0))
      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
      if (maxTop < top) pending = true
      const desiredTop = Math.min(top, maxTop)
      if (Math.round(element.scrollTop) !== desiredTop) element.scrollTop = desiredTop
    }

    if (pending && performance.now() < deadline) {
      window.requestAnimationFrame(apply)
    } else {
      cancel()
    }
  }

  window.requestAnimationFrame(apply)
}

function ScrollManager () {
  const location = useLocation()
  const navigationType = useNavigationType()
  const activeKeyRef = useRef(location.key || location.pathname)
  const activePathRef = useRef(location.pathname)
  const suppressUntilRef = useRef(0)

  useEffect(() => {
    const handleScroll = event => {
      if (performance.now() < suppressUntilRef.current) return
      const state = getScrollState(activeKeyRef.current, true)
      const created = state && state.path !== activePathRef.current
      captureScrollState(state, event)
      if (created) state.path = activePathRef.current
      scheduleScrollStatePersist()
    }

    const flush = () => persistScrollStates()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('scroll', handleScroll, { capture: true })
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    const key = location.key || `${location.pathname}${location.search}`
    const previousKey = activeKeyRef.current
    const previousPath = activePathRef.current
    activeKeyRef.current = key
    activePathRef.current = location.pathname

    if (location.hash && previousPath === location.pathname) return

    suppressUntilRef.current = performance.now() + SCROLL_CAPTURE_SUPPRESS_MS

    if (navigationType === 'POP') {
      const saved = getScrollState(key, false)
      if (saved && saved.path && saved.path !== location.pathname) {
        saved.windowTop = 0
        saved.containers = {}
      }
      restoreScrollState(saved)
      return
    }

    if (previousKey) {
      const previousState = getScrollState(previousKey, true)
      if (previousState) previousState.path = previousPath
    }
    const state = getScrollState(key, true)
    if (state) {
      state.path = location.pathname
      state.windowTop = 0
      state.containers = {}
    }
    if (!location.hash && documentScrollTop() !== 0) window.scrollTo(0, 0)
    scheduleScrollStatePersist()
  }, [location.hash, location.key, location.pathname, location.search, navigationType])

  useEffect(() => () => {
    if (persistTimer) {
      window.clearTimeout(persistTimer)
      persistTimer = null
    }
    persistScrollStates()
  }, [])

  return null
}

function SuspenseRoute ({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

function PlantsDetailRoute () {
  const { slug } = useParams()
  return <PlantsDetailPage slug={slug} />
}

function CareDetailRoute () {
  const { slug } = useParams()
  return <CareDetailPage slug={slug} />
}

function NotFoundRoute () {
  const { pathname } = useLocation()

  useEffect(() => {
    const canonical = document.head.querySelector('link[rel="canonical"]')
    if (canonical) canonical.remove()
  }, [pathname])

  return (
    <SuspenseRoute>
      <ContentPage>
        <NotFoundPage
          backPath='/'
          backLabel='На главную'
          message='Такой страницы нет — возможно, ссылка устарела или в адресе ошибка.'
        />
      </ContentPage>
    </SuspenseRoute>
  )
}

const PRIVATE_APP_ROUTES = new Set([
  '/home',
  '/notifications',
  '/add-plant',
  '/edit-profile',
  '/my-plants'
])

function isPrivateAppRoute (pathname) {
  if (typeof pathname !== 'string' || !pathname) return false
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PRIVATE_APP_ROUTES.has(normalized)
}

const subscribeToNothing = () => () => {}

function useIsHydrated () {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
}

function DeferredCookieConsent () {
  const isHydrated = useIsHydrated()

  if (!isHydrated) return null

  return (
    <Suspense fallback={null}>
      <CookieConsentManager />
    </Suspense>
  )
}

function AppContent () {
  const location = useLocation()
  const privateRoute = isPrivateAppRoute(location.pathname)

  useEffect(() => {
    if (!privateRoute) {
      clearAppBadge()
      return undefined
    }

    return startAppBadgeSync()
  }, [privateRoute])

  return (
    <ThemeProvider>

      <ScrollManager />
      <a className='skipLink' href='#main-content'>Перейти к содержимому</a>
      <SeoMetadata />
      <div id='main-content' className='appMain' tabIndex={-1}>
        <Routes>
          <Route path='/' element={<LandingPage />} />
          <Route
            path='/login'
            element={
              <SuspenseRoute>
                <Registration key='login' initialMode='login' />
              </SuspenseRoute>
            }
          />
          <Route
            path='/register'
            element={
              <SuspenseRoute>
                <Registration key='register' initialMode='register' />
              </SuspenseRoute>
            }
          />
          <Route
            path='/notifications'
            element={
              <SuspenseRoute>
                <Notification />
              </SuspenseRoute>
            }
          />
          <Route
            path='/home'
            element={
              <SuspenseRoute>
                <Home />
              </SuspenseRoute>
            }
          />
          <Route
            path='/add-plant'
            element={
              <SuspenseRoute>
                <AddPlantPage />
              </SuspenseRoute>
            }
          />
          <Route
            path='/edit-profile'
            element={
              <SuspenseRoute>
                <EditProfile />
              </SuspenseRoute>
            }
          />
          <Route
            path='/my-plants'
            element={
              <SuspenseRoute>
                <MyPlant />
              </SuspenseRoute>
            }
          />
          <Route
            path='/plants'
            element={
              <SuspenseRoute>
                <PlantsIndexPage />
              </SuspenseRoute>
            }
          />
          <Route
            path='/plants/:slug'
            element={
              <SuspenseRoute>
                <PlantsDetailRoute />
              </SuspenseRoute>
            }
          />
          <Route
            path='/care'
            element={
              <SuspenseRoute>
                <CareIndexPage />
              </SuspenseRoute>
            }
          />
          <Route
            path='/care/:slug'
            element={
              <SuspenseRoute>
                <CareDetailRoute />
              </SuspenseRoute>
            }
          />
          <Route
            path='/garden/:token'
            element={
              <SuspenseRoute>
                <SharedGardenPage />
              </SuspenseRoute>
            }
          />
          <Route path='*' element={<NotFoundRoute />} />
          <Route
            path='/reset-password'
            element={
              <SuspenseRoute>
                <ResetPassword />
              </SuspenseRoute>
            }
          />
        </Routes>
      </div>
      <DeferredCookieConsent />
    </ThemeProvider>
  )
}

function App () {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}

export { AppContent }
export default App
