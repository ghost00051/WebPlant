import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Registration from './component/registration/registration.jsx'
import LandingPage from './component/landingPage/landingPage.jsx'
import Home from './component/home/home.jsx'
import EditProfile from './component/editProfile/editProfile.jsx'
import MyPlant from './component/myPlant/myPlant.jsx'
import AddPlantPage from './component/addPlants/AddPlantPage.jsx'
import CookieConsentManager from './component/CookieConsentManager/CookieConsentManager.jsx'
import SeoMetadata from './component/SeoMetadata/SeoMetadata.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import './styles/dark-theme.css'

function App() {
  return (
    <Router>
      <ThemeProvider>
        <SeoMetadata />
        <Routes>
          <Route path='/' element={<LandingPage />} />
          <Route path='/login' element={<Registration key='login' initialMode='login' />} />
          <Route path='/register' element={<Registration key='register' initialMode='register' />} />
          <Route path='/home' element={<Home />} />
          <Route path='/add-plant' element={<AddPlantPage />} />
          <Route path='/edit-profile' element={<EditProfile />} />
          <Route path='/my-plants' element={<MyPlant/>}/>
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
        <CookieConsentManager />
      </ThemeProvider>
    </Router>
  )
}

export default App