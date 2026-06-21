import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import JoinClass from './pages/JoinClass'
import Dashboard from './pages/Dashboard'
import TeacherDashboard from './pages/TeacherDashboard'
import CreateCharacter from './pages/CreateCharacter'
import AuthCallback from './pages/AuthCallback'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/join" element={<ProtectedRoute allow="join"><JoinClass /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute allow="dashboard"><Dashboard /></ProtectedRoute>} />
          <Route path="/teacher" element={<ProtectedRoute allow="teacher"><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/create-character" element={<ProtectedRoute allow="create-character"><CreateCharacter /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
