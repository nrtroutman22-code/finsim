import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Navigate } from 'react-router-dom'

export default function Login() {
  const { session, profile, studentStatus, loading } = useAuth()
  const [mode, setMode] = useState('signin')
  const [role, setRole] = useState('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading...</p>
      </div>
    )
  }

  if (session && profile) {
    if (profile.role === 'teacher') return <Navigate to="/teacher" />
    if (studentStatus === 'needs-enrollment') return <Navigate to="/join" />
    if (studentStatus === 'needs-character') return <Navigate to="/create-character" />
    if (studentStatus === 'ready') return <Navigate to="/dashboard" />
  }

  async function handleOAuth(provider) {
    setError(null)
    localStorage.setItem('finsim_pending_role', role)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) setError(error.message)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSubmitting(true)

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role,
            display_name: displayName || email.split('@')[0],
          },
        },
      })
      if (error) {
        setError(error.message)
      } else {
        setMessage('Check your email for a confirmation link.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) setError(error.message)
    }

    setSubmitting(false)
  }

  return (
    <div className="page-center">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>💰 FinSim</h1>
          <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>Personal Finance Simulation</p>
        </div>

        <div className="role-toggle">
          <button
            className={role === 'student' ? 'active' : ''}
            onClick={() => setRole('student')}
            type="button"
          >
            🎓 Student
          </button>
          <button
            className={role === 'teacher' ? 'active' : ''}
            onClick={() => setRole('teacher')}
            type="button"
          >
            📋 Teacher
          </button>
        </div>

        <button className="btn btn-oauth" onClick={() => handleOAuth('google')} type="button">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <button className="btn btn-oauth" onClick={() => handleOAuth('azure')} type="button">
          <svg width="18" height="18" viewBox="0 0 23 23">
            <path fill="#f25022" d="M1 1h10v10H1z"/>
            <path fill="#00a4ef" d="M1 12h10v10H1z"/>
            <path fill="#7fba00" d="M12 1h10v10H12z"/>
            <path fill="#ffb900" d="M12 12h10v10H12z"/>
          </svg>
          Continue with Microsoft
        </button>

        <div className="divider">or</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {mode === 'signup' && (
            <input
              className="input"
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {error && <div className="error-msg">{error}</div>}
        {message && <div className="success-msg">{message}</div>}

        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
          {mode === 'signin' ? (
            <>
              Don't have an account?{' '}
              <button className="text-link" onClick={() => { setMode('signup'); setError(null); setMessage(null) }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button className="text-link" onClick={() => { setMode('signin'); setError(null); setMessage(null) }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
