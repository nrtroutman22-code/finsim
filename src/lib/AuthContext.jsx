import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [studentStatus, setStudentStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)

        if (session) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          setProfile(data)

          if (data?.role === 'student') {
            const { data: enrollment } = await supabase
              .from('enrollments')
              .select('id, status')
              .eq('student_id', session.user.id)
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
        } else {
          setProfile(null)
          setStudentStatus(null)
        }

        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
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
