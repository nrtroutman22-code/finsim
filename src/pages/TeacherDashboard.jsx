import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

export default function TeacherDashboard() {
  const { session, profile, loading: authLoading, signOut } = useAuth()
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!session) return
    loadSections()
  }, [session])

  async function loadSections() {
    try {
      const { data, error: sErr } = await supabase
        .from('sections')
        .select('id, name, class_code, unlocked_week, is_active, created_at')
        .order('created_at', { ascending: false })
      if (sErr) throw new Error(sErr.message)

      const withCounts = await Promise.all(
        (data || []).map(async (sec) => {
          const { count } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('section_id', sec.id)
            .eq('status', 'approved')
          return { ...sec, studentCount: count || 0 }
        })
      )
      setSections(withCounts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateWeek(sectionId, newWeek) {
    const clamped = Math.max(0, Math.min(36, newWeek))
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, unlocked_week: clamped } : s
    ))
    const { error } = await supabase
      .from('sections')
      .update({ unlocked_week: clamped })
      .eq('id', sectionId)
    if (error) {
      setError(error.message)
      loadSections()
    }
  }

  if (authLoading || loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading...</p>
      </div>
    )
  }

  if (!session) return <Navigate to="/" />
  if (profile?.role !== 'teacher') return <Navigate to="/dashboard" />

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="dash-header-left">
          <div>
            <h1 className="dash-name">Teacher Dashboard</h1>
            <p className="dash-subtitle">{profile?.display_name || session.user.email}</p>
          </div>
        </div>
        <div className="dash-header-right">
          <button className="btn btn-secondary dash-signout" onClick={signOut} type="button">Sign out</button>
        </div>
      </header>

      {error && (
        <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      {sections.length === 0 ? (
        <section className="dash-section" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--gray-400)' }}>No sections yet. Create one in the Supabase dashboard to get started.</p>
        </section>
      ) : (
        sections.map(sec => (
          <section key={sec.id} className="dash-section" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 className="dash-section-title" style={{ marginBottom: '0.25rem' }}>{sec.name}</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>
                  Code: <strong style={{ color: 'var(--gray-700)', letterSpacing: '0.05em' }}>{sec.class_code}</strong>
                  {' '} · {sec.studentCount} student{sec.studentCount !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="week-control">
              <div className="week-control-label">
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Week Unlock</span>
                <span className="dash-week-badge" style={{ fontSize: '0.85rem' }}>
                  Week {sec.unlocked_week} of 36
                </span>
              </div>
              <div className="week-control-bar">
                <div className="week-control-fill" style={{ width: `${(sec.unlocked_week / 36) * 100}%` }} />
              </div>
              <div className="week-control-actions">
                <button
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                  onClick={() => updateWeek(sec.id, sec.unlocked_week - 1)}
                  disabled={sec.unlocked_week <= 0}
                  type="button"
                >
                  - 1 Week
                </button>
                <button
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                  onClick={() => updateWeek(sec.id, sec.unlocked_week + 1)}
                  disabled={sec.unlocked_week >= 36}
                  type="button"
                >
                  + 1 Week
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                  onClick={() => updateWeek(sec.id, 36)}
                  disabled={sec.unlocked_week >= 36}
                  type="button"
                >
                  Unlock All
                </button>
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
