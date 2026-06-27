import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useLocalStorageState } from './lib/useLocalStorageState'
import { LS_KEYS } from './lib/keys'
import Layout from './pages/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import FundPicker from './pages/FundPicker'
import FundDetail from './pages/FundDetail'
import Simulation from './pages/Simulation'
import Diagnosis from './pages/Diagnosis'
import Watch from './pages/Watch'
import MyPage from './pages/MyPage'
import HoldingDetail from './pages/HoldingDetail'
import './App.css'

function App() {
  const [currentUser, setCurrentUser] = useLocalStorageState(LS_KEYS.currentUser, null)

  if (!currentUser) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={(u) => setCurrentUser(u)} />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout user={currentUser} onLogout={() => setCurrentUser(null)} />}>
          <Route path="/home" element={<Home user={currentUser} />} />
          <Route path="/pick" element={<FundPicker />} />
          <Route path="/funds/:fundId" element={<FundDetail />} />
          <Route path="/simulate" element={<Simulation />} />
          <Route path="/diagnose" element={<Diagnosis />} />
          <Route path="/watch" element={<Watch />} />
          <Route path="/me" element={<MyPage user={currentUser} onUpdateUser={setCurrentUser} />} />
          <Route path="/me/holding/:fundId" element={<HoldingDetail />} />
          <Route path="/login" element={<Navigate to="/home" replace />} />
          <Route path="/register" element={<Navigate to="/home" replace />} />
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
