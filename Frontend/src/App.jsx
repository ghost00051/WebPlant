import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Registration from './component/registration/registration.jsx'
import Home from './component/home/home.jsx'
import EditProfile from './component/editProfile/editProfile.jsx'
import MyPlant from './component/myPlant/myPlant.jsx'
import AddPlantPage from './component/addPlants/AddPlantPage.jsx'

function App() {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Registration />} />
        <Route path='/home' element={<Home />} />
        <Route path='/add-plant' element={<AddPlantPage />} />
        <Route path='/edit-profile' element={<EditProfile />} />
        <Route path='/my-plants' element={<MyPlant/>}/>
      </Routes>
    </Router>
  )
}

export default App