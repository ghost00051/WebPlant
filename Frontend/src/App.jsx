import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams
} from 'react-router-dom'
import LandingPage from './component/landingPage/landingPage.jsx'
import PlantsIndexPage from './component/PlantsGuide/PlantsIndexPage.jsx'
import PlantsDetailPage from './component/PlantsGuide/PlantsDetailPage.jsx'
import CareIndexPage from './component/CareGuide/CareIndexPage.jsx'
import CareDetailPage from './component/CareGuide/CareDetailPage.jsx'
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
          <Route path='*' element={<Navigate to='/' replace />} />
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
