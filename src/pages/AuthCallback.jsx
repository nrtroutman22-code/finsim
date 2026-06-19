import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Signing you in...')

  useEffect(() => {
    async function handleCallback() {
      console.log('[AuthCallback] URL:', window.location.href)
      console.log('[AuthCallback] search:', window.location.search)
      console.log('[AuthCallback] hash:', window.location.hash ? `present (${window.location.hash.length} chars)` : 'empty')

      const code = new URLSearchParams(window.location.search).get('code')
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get('access_token')

      console.log('[AuthCallback] PKCE code:', code ? 'found' : 'none')
      console.log('[AuthCallback] hash access_token:', accessToken ? 'found' : 'none')

      // PKCE flow: exchange the code for a session
      if (code) {
        console.log('[AuthCallback] Exchanging PKCE code...')
        setStatus('Exchanging code...')
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[AuthCallback] Code exchange failed:', error.message)
          setStatus(`Error: ${error.message}`)
          setTimeout(() => navigate('/', { replace: true }), 2000)
          return
        }
        console.log('[AuthCallback] Code exchange succeeded:', !!data.session)
      }

      // Implicit flow: hash fragment is auto-processed by the client,
      // but it's async — we need to wait for it
      if (!code && accessToken) {
        console.log('[AuthCallback] Implicit flow — waiting for client to process hash...')
        setStatus('Processing tokens...')
      }

      // Poll for session — handles the async gap in both flows
      let session = null
      for (let attempt = 1; attempt <= 15; attempt++) {
        const { data, error } = await supabase.auth.getSession()
        console.log(`[AuthCallback] getSession attempt ${attempt}:`, data.session ? 'found' : 'null', error?.message || '')
        if (data.session) {
          session = data.session
          break
        }
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      if (!session) {
        console.error('[AuthCallback] No session after all attempts')
        setStatus('Could not sign in. Redirecting...')
        setTimeout(() => navigate('/', { replace: true }), 1500)
        return
      }

      console.log('[AuthCallback] Session user:', session.user.id, session.user.email)
      setStatus('Signed in! Redirecting...')

      // Sync pending role from localStorage (set before OAuth redirect)
      const pendingRole = localStorage.getItem('finsim_pending_role')
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      console.log('[AuthCallback] Profile:', profile, 'Error:', profileError?.message)
      console.log('[AuthCallback] Pending role:', pendingRole)

      if (pendingRole && profile && profile.role !== pendingRole) {
        console.log('[AuthCallback] Updating role to:', pendingRole)
        await supabase
          .from('profiles')
          .update({ role: pendingRole })
          .eq('id', session.user.id)
        profile.role = pendingRole
      }
      localStorage.removeItem('finsim_pending_role')

      const destination = profile?.role === 'teacher' ? '/teacher' : '/dashboard'
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
