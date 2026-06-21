import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function ProtectedRoute({ allow, children }) {
  const { session, profile, studentStatus, loading } = useAuth()

  if (loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading...</p>
      </div>
    )
  }

  if (!session) return <Navigate to="/" replace />

  const role = profile?.role

  if (role === 'teacher') {
    if (allow === 'teacher') return children
    return <Navigate to="/teacher" replace />
  }

  if (role === 'student') {
    switch (studentStatus) {
      case 'needs-enrollment':
        return allow === 'join' ? children : <Navigate to="/join" replace />
      case 'needs-character':
        return allow === 'create-character' ? children : <Navigate to="/create-character" replace />
      case 'ready':
        return allow === 'dashboard' ? children : <Navigate to="/dashboard" replace />
      default:
        return <Navigate to="/join" replace />
    }
  }

  return <Navigate to="/" replace />
}
