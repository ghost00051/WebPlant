import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Registration from './component/registration/registration.jsx'
import Home from './component/home/home.jsx'

function App () {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Registration />} />
        <Route path='/home' element={<Home />} />
      </Routes>
    </Router>
  )
}

export default App
