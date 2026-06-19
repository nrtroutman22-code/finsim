import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import Login from './pages/Login'
import JoinClass from './pages/JoinClass'
import Dashboard from './pages/Dashboard'
import TeacherDashboard from './pages/TeacherDashboard'
import CreateCharacter from './pages/CreateCharacter'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/join" element={<JoinClass />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/teacher" element={<TeacherDashboard />} />
          <Route path="/create-character" element={<CreateCharacter />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
