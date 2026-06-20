import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { triggerTeacherLifeEvent } from '../lib/simulationEngine'

export default function TeacherDashboard() {
  const { session, profile, loading: authLoading, signOut } = useAuth()
  const [sections, setSections] = useState([])
  const [allEvents, setAllEvents] = useState([])
  const [recentTriggers, setRecentTriggers] = useState([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [triggerWeek, setTriggerWeek] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!session) return
    loadAll()
  }, [session])

  async function loadAll() {
    try {
      const { data: secs, error: sErr } = await supabase
        .from('sections')
        .select('id, name, class_code, unlocked_week, is_active, created_at')
        .order('created_at', { ascending: false })
      if (sErr) throw new Error(sErr.message)

      const withCounts = await Promise.all(
        (secs || []).map(async (sec) => {
          const { count } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('section_id', sec.id)
            .eq('status', 'approved')
          return { ...sec, studentCount: count || 0 }
        })
      )
      setSections(withCounts)

      const { data: events } = await supabase
        .from('life_events')
        .select('id, title, is_positive, category')
        .order('title')
      setAllEvents(events || [])

      await loadRecentTriggers(withCounts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadRecentTriggers(secs) {
    const sectionIds = (secs || sections).map(s => s.id)
    if (sectionIds.length === 0) return
    const { data } = await supabase
      .from('section_life_events')
      .select('id, section_id, life_event_id, week, triggered_at, life_events(title)')
      .in('section_id', sectionIds)
      .order('triggered_at', { ascending: false })
      .limit(10)
    setRecentTriggers(data || [])
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
      loadAll()
    }
  }

  async function handlePushEvent() {
    if (!selectedEvent || !selectedSection || !triggerWeek) return
    setPushing(true)
    setPushMsg(null)
    try {
      const sectionIds = selectedSection === 'all'
        ? sections.map(s => s.id)
        : [selectedSection]

      for (const secId of sectionIds) {
        await triggerTeacherLifeEvent(secId, selectedEvent, Number(triggerWeek))
      }
      const eventName = allEvents.find(e => e.id === selectedEvent)?.title || 'Event'
      setPushMsg(`"${eventName}" pushed to ${sectionIds.length === 1 ? '1 section' : sectionIds.length + ' sections'} for week ${triggerWeek}`)
      await loadRecentTriggers()
      setSelectedEvent('')
      setTriggerWeek('')
    } catch (err) {
      setPushMsg('Error: ' + err.message)
    } finally {
      setPushing(false)
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

      {/* ── Sections ── */}
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

      {/* ── Trigger Life Event ── */}
      <section className="dash-section" style={{ marginTop: '1rem' }}>
        <h2 className="dash-section-title">⚡ Trigger Life Event</h2>

        <div className="event-trigger-form">
          <div className="event-trigger-row">
            <label className="event-trigger-label">Event</label>
            <select
              className="input"
              value={selectedEvent}
              onChange={e => setSelectedEvent(e.target.value)}
            >
              <option value="">Select a life event...</option>
              {allEvents.map(evt => (
                <option key={evt.id} value={evt.id}>
                  {evt.is_positive ? '🟢' : '🔴'} {evt.title} ({evt.category})
                </option>
              ))}
            </select>
          </div>

          <div className="event-trigger-row">
            <label className="event-trigger-label">Section</label>
            <select
              className="input"
              value={selectedSection}
              onChange={e => setSelectedSection(e.target.value)}
            >
              <option value="">Select a section...</option>
              <option value="all">All sections</option>
              {sections.map(sec => (
                <option key={sec.id} value={sec.id}>{sec.name}</option>
              ))}
            </select>
          </div>

          <div className="event-trigger-row">
            <label className="event-trigger-label">Week #</label>
            <input
              className="input"
              type="number"
              min="1"
              max="36"
              placeholder="Week number"
              value={triggerWeek}
              onChange={e => setTriggerWeek(e.target.value)}
              style={{ maxWidth: 120 }}
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0.6rem 1.5rem', alignSelf: 'flex-start' }}
            onClick={handlePushEvent}
            disabled={pushing || !selectedEvent || !selectedSection || !triggerWeek}
            type="button"
          >
            {pushing ? 'Pushing...' : 'Push to Students'}
          </button>
        </div>

        {pushMsg && (
          <div className={pushMsg.startsWith('Error') ? 'error-msg' : 'success-msg'} style={{ marginTop: '0.75rem' }}>
            {pushMsg}
          </div>
        )}

        {recentTriggers.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
              Recent triggers
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {recentTriggers.map(t => {
                const secName = sections.find(s => s.id === t.section_id)?.name || 'Unknown'
                return (
                  <div key={t.id} style={{ fontSize: '0.85rem', color: 'var(--gray-500)', display: 'flex', justifyContent: 'space-between' }}>
                    <span><strong>{t.life_events?.title}</strong> → {secName} (Week {t.week})</span>
                    <span style={{ color: 'var(--gray-400)' }}>
                      {new Date(t.triggered_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
