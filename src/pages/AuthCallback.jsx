import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Signing you in...')

  useEffect(() => {
    async function handleCallback() {
      let session = null

      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      if (accessToken && refreshToken) {
        setStatus('Processing tokens...')
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          setStatus(`Error: ${error.message}`)
          setTimeout(() => navigate('/', { replace: true }), 2000)
          return
        }
        session = data.session
      }

      if (!session) {
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) {
          setStatus('Exchanging code...')
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            setStatus(`Error: ${error.message}`)
            setTimeout(() => navigate('/', { replace: true }), 2000)
            return
          }
          session = data.session
        }
      }

      if (!session) {
        const { data } = await supabase.auth.getSession()
        session = data.session
      }

      if (!session) {
        setStatus('Could not sign in. Redirecting...')
        setTimeout(() => navigate('/', { replace: true }), 1500)
        return
      }

      setStatus('Signed in! Redirecting...')

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (profile && !profile.role) {
        await supabase
          .from('profiles')
          .update({ role: 'student' })
          .eq('id', session.user.id)
        profile.role = 'student'
      }

      let destination = '/join'
      if (profile?.role === 'teacher') {
        destination = '/teacher'
      } else {
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('id, status')
          .eq('student_id', session.user.id)
          .in('status', ['approved', 'pending'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (enrollment?.status === 'approved') {
          const { data: character } = await supabase
            .from('characters')
            .select('id')
            .eq('enrollment_id', enrollment.id)
            .limit(1)
            .single()
          destination = character ? '/dashboard' : '/create-character'
        }
      }

      navigate(destination, { replace: true })
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="page-center">
      <p style={{ color: 'var(--gray-400)' }}>{status}</p>
    </div>
  )
}
