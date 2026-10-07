import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom'
import LandingPage from './component/landingPage/landingPage.jsx'
import SeoMetadata from './component/SeoMetadata/SeoMetadata.jsx'
import RouteFallback from './component/RouteFallback/RouteFallback.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import './styles/dark-theme.css'

const Registration = lazy(() => import('./component/registration/registration.jsx'))
const Home = lazy(() => import('./component/home/home.jsx'))
const EditProfile = lazy(() => import('./component/editProfile/editProfile.jsx'))
const MyPlant = lazy(() => import('./component/myPlant/myPlant.jsx'))
const AddPlantPage = lazy(() => import('./component/addPlants/AddPlantPage.jsx'))
const CookieConsentManager = lazy(
  () => import('./component/CookieConsentManager/CookieConsentManager.jsx')
)
const PlantsIndexPage = lazy(() => import('./component/PlantsGuide/PlantsIndexPage.jsx'))
const PlantsDetailPage = lazy(() => import('./component/PlantsGuide/PlantsDetailPage.jsx'))
const CareIndexPage = lazy(() => import('./component/CareGuide/CareIndexPage.jsx'))
const CareDetailPage = lazy(() => import('./component/CareGuide/CareDetailPage.jsx'))

function SuspenseRoute({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

function PlantsDetailRoute() {
  const { slug } = useParams()
  return <PlantsDetailPage slug={slug} />
}

function CareDetailRoute() {
  const { slug } = useParams()
  return <CareDetailPage slug={slug} />
}

function App() {
  return (
    <Router>
      <ThemeProvider>
        <SeoMetadata />
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
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
        <Suspense fallback={null}>
          <CookieConsentManager />
        </Suspense>
      </ThemeProvider>
    </Router>
  )
}

export default App
