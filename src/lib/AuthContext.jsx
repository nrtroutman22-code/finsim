import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [studentStatus, setStudentStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    setProfile(data)

    if (data?.role === 'student') {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, status')
        .eq('student_id', userId)
        .in('status', ['approved', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!enrollment || enrollment.status === 'pending') {
        setStudentStatus('needs-enrollment')
      } else {
        const { data: character } = await supabase
          .from('characters')
          .select('id')
          .eq('enrollment_id', enrollment.id)
          .limit(1)
          .single()
        setStudentStatus(character ? 'ready' : 'needs-character')
      }
    } else {
      setStudentStatus(null)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      setSession(initial)
      if (initial) {
        loadProfile(initial.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession)

        if (newSession) {
          loadProfile(newSession.user.id).finally(() => setLoading(false))
        } else {
          setProfile(null)
          setStudentStatus(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [loadProfile])

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setStudentStatus(null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, studentStatus, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
