import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('Auth callback error:', error.message)
          navigate('/', { replace: true })
          return
        }
      }

      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        navigate('/', { replace: true })
        return
      }

      const pendingRole = localStorage.getItem('finsim_pending_role')
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (pendingRole && profile && profile.role !== pendingRole) {
        await supabase
          .from('profiles')
          .update({ role: pendingRole })
          .eq('id', session.user.id)
        profile.role = pendingRole
      }
      localStorage.removeItem('finsim_pending_role')

      if (profile?.role === 'teacher') {
        navigate('/teacher', { replace: true })
      } else {
        navigate('/dashboard', { replace: true })
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="page-center">
      <p style={{ color: 'var(--gray-400)' }}>Signing you in...</p>
    </div>
  )
}
