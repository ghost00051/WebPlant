import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import Registration from './component/registration/registration.jsx'
import Home from './component/home/home.jsx'

function App () {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Registration />} />
        <Route path='/home' element={<Home />} />
        <Route path='/' element={<Navigate to='/home' replace />} />÷{' '}
      </Routes>
    </Router>
  )
}

export default App
