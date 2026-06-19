import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Signing you in...')

  useEffect(() => {
    async function handleCallback() {
      console.log('[AuthCallback] URL:', window.location.href)

      let session = null

      // --- Implicit flow: tokens in hash fragment ---
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      if (accessToken && refreshToken) {
        console.log('[AuthCallback] Implicit flow — setting session from hash tokens')
        setStatus('Processing tokens...')
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          console.error('[AuthCallback] setSession failed:', error.message)
          setStatus(`Error: ${error.message}`)
          setTimeout(() => navigate('/', { replace: true }), 2000)
          return
        }
        session = data.session
        console.log('[AuthCallback] setSession succeeded:', !!session)
      }

      // --- PKCE flow: code in query string ---
      if (!session) {
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) {
          console.log('[AuthCallback] PKCE flow — exchanging code')
          setStatus('Exchanging code...')
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            console.error('[AuthCallback] Code exchange failed:', error.message)
            setStatus(`Error: ${error.message}`)
            setTimeout(() => navigate('/', { replace: true }), 2000)
            return
          }
          session = data.session
          console.log('[AuthCallback] Code exchange succeeded:', !!session)
        }
      }

      // --- Fallback: check if client already has a session ---
      if (!session) {
        console.log('[AuthCallback] No tokens found, checking existing session...')
        const { data } = await supabase.auth.getSession()
        session = data.session
      }

      if (!session) {
        console.error('[AuthCallback] No session established')
        setStatus('Could not sign in. Redirecting...')
        setTimeout(() => navigate('/', { replace: true }), 1500)
        return
      }

      console.log('[AuthCallback] Signed in as:', session.user.email)
      setStatus('Signed in! Redirecting...')

      // Sync pending role
      const pendingRole = localStorage.getItem('finsim_pending_role')
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      console.log('[AuthCallback] Profile role:', profile?.role, '| Pending role:', pendingRole)

      if (pendingRole && profile && profile.role !== pendingRole) {
        await supabase
          .from('profiles')
          .update({ role: pendingRole })
          .eq('id', session.user.id)
        profile.role = pendingRole
      }
      localStorage.removeItem('finsim_pending_role')

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

      console.log('[AuthCallback] Navigating to:', destination)
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
