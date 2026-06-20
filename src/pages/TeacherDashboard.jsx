import { useState, useEffect, useCallback, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { triggerTeacherLifeEvent } from '../lib/simulationEngine'

const NAV = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'roster', label: 'Roster', icon: '👥' },
  { id: 'gradebook', label: 'Gradebook', icon: '📝' },
  { id: 'sim', label: 'Sim Controls', icon: '⚙️' },
  { id: 'display', label: 'Class Display', icon: '📺' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'demo', label: 'Student View', icon: '👁️' },
]

const PATH_CATEGORIES = {
  'retail-food': 'Work', trades: 'Work', 'office-admin': 'Work',
  military: 'Work', 'gig-freelance': 'Work', healthcare: 'Work',
  'cc-parttime': 'CC', 'cc-fulltime': 'CC',
  'uni-oncampus': 'Uni', 'uni-offcampus': 'Uni',
}
const PATH_COLORS = { Work: '#3b82f6', CC: '#8b5cf6', Uni: '#f59e0b' }

function money(n) {
  const v = Number(n) || 0
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function letterGrade(s) {
  if (s >= 90) return 'A'
  if (s >= 80) return 'B'
  if (s >= 70) return 'C'
  if (s >= 60) return 'D'
  return 'F'
}

function gradeColor(s) {
  if (s >= 80) return '#16a34a'
  if (s >= 60) return '#eab308'
  return '#dc2626'
}

function daysSince(d) {
  if (!d) return 999
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function statusBadge(student) {
  const days = daysSince(student.lastActive)
  if (days >= 3 || student.netWorthDecline) return { label: 'At-risk', color: '#dc2626', bg: '#fef2f2' }
  if (student.weeksBehind > 0) return { label: 'Behind', color: '#f59e0b', bg: '#fffbeb' }
  return { label: 'On track', color: '#16a34a', bg: '#f0fdf4' }
}

// ─── Overview ───────────────────────────────────────────

function OverviewPage({ students, onSelectStudent }) {
  const total = students.length
  const avgNW = total ? Math.round(students.reduce((s, st) => s + st.netWorth, 0) / total) : 0
  const avgCredit = total ? Math.round(students.reduce((s, st) => s + st.creditScore, 0) / total) : 0
  const decisionsThisWeek = students.filter(s => s.madeDecisionThisWeek).length
  const atRisk = students.filter(s => statusBadge(s).label === 'At-risk')

  return (
    <div>
      <div className="td-stats">
        <div className="stat-card"><p className="stat-label">Total Students</p><p className="stat-value">{total}</p></div>
        <div className="stat-card"><p className="stat-label">Avg Net Worth</p><p className="stat-value">{money(avgNW)}</p></div>
        <div className="stat-card"><p className="stat-label">Decisions This Week</p><p className="stat-value">{decisionsThisWeek}/{total}</p></div>
        <div className="stat-card"><p className="stat-label">Avg Credit Score</p><p className="stat-value">{avgCredit}</p></div>
      </div>

      {atRisk.length > 0 && (
        <div className="td-alert">
          ⚠️ <strong>{atRisk.length} student{atRisk.length > 1 ? 's' : ''} at risk</strong> — inactive 3+ days or declining net worth.
        </div>
      )}

      <div className="td-table-wrap">
        <table className="td-table">
          <thead>
            <tr>
              <th>Student</th><th>Path</th><th>Net Worth</th>
              <th>Budget</th><th>Debt</th><th>Savings</th><th>Overall</th>
            </tr>
          </thead>
          <tbody>
            {students.map(st => {
              const cat = PATH_CATEGORIES[st.lifePathId] || '—'
              return (
                <tr key={st.id} className="td-row-click" onClick={() => onSelectStudent(st)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>
                      <span>{st.name}</span>
                    </div>
                  </td>
                  <td><span className="td-path-tag" style={{ background: PATH_COLORS[cat] || '#9ca3af' }}>{cat}</span></td>
                  <td>{money(st.netWorth)}</td>
                  <td style={{ color: gradeColor(st.budgetGrade) }}>{letterGrade(st.budgetGrade)}</td>
                  <td style={{ color: gradeColor(st.debtGrade) }}>{letterGrade(st.debtGrade)}</td>
                  <td style={{ color: gradeColor(st.savingsGrade) }}>{letterGrade(st.savingsGrade)}</td>
                  <td style={{ color: gradeColor(st.overallGrade), fontWeight: 700 }}>{letterGrade(st.overallGrade)}</td>
                </tr>
              )
            })}
            {students.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--gray-400)' }}>No students in this section yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Roster ─────────────────────────────────────────────

function RosterPage({ students, sections, currentSectionId, onReload }) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [moveModal, setMoveModal] = useState(null)
  const [deactModal, setDeactModal] = useState(null)
  const [removeModal, setRemoveModal] = useState(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [deactReason, setDeactReason] = useState('Medical leave')
  const [processing, setProcessing] = useState(false)

  const active = students.filter(s => s.enrollStatus === 'approved')
  const deactivated = students.filter(s => s.enrollStatus === 'denied')
  const list = (tab === 'active' ? active : deactivated).filter(
    s => s.name.toLowerCase().includes(search.toLowerCase())
  )

  async function doMove() {
    if (!moveModal || !moveTarget) return
    setProcessing(true)
    await supabase.from('enrollments').update({ section_id: moveTarget }).eq('id', moveModal.enrollmentId)
    setMoveModal(null)
    setProcessing(false)
    onReload()
  }
  async function doDeactivate() {
    if (!deactModal) return
    setProcessing(true)
    await supabase.from('enrollments').update({ status: 'denied', deactivation_reason: deactReason }).eq('id', deactModal.enrollmentId)
    setDeactModal(null)
    setProcessing(false)
    onReload()
  }
  async function doReactivate(st) {
    await supabase.from('enrollments').update({ status: 'approved', deactivation_reason: null }).eq('id', st.enrollmentId)
    onReload()
  }
  async function doRemove() {
    if (!removeModal) return
    setProcessing(true)
    await supabase.from('enrollments').delete().eq('id', removeModal.enrollmentId)
    setRemoveModal(null)
    setProcessing(false)
    onReload()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="role-toggle" style={{ width: 'auto' }}>
          <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Active ({active.length})</button>
          <button className={tab === 'deactivated' ? 'active' : ''} onClick={() => setTab('deactivated')}>Deactivated ({deactivated.length})</button>
        </div>
        <input className="input" placeholder="Search students..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Path</th><th>Progress</th><th>Last Active</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map(st => {
              const badge = statusBadge(st)
              return (
                <tr key={st.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                  <td><span className="td-path-tag" style={{ background: PATH_COLORS[PATH_CATEGORIES[st.lifePathId]] || '#9ca3af' }}>{PATH_CATEGORIES[st.lifePathId] || '—'}</span></td>
                  <td>
                    <div className="td-progress-bar"><div className="td-progress-fill" style={{ width: `${(st.currentWeek / 36) * 100}%` }} /></div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>W{st.currentWeek}/36</span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--gray-500)' }}>{st.lastActive ? `${daysSince(st.lastActive)}d ago` : '—'}</td>
                  <td><span className="td-status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span></td>
                  <td>
                    {tab === 'active' ? (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="td-action-btn" onClick={() => { setMoveModal(st); setMoveTarget('') }}>Move</button>
                        <button className="td-action-btn" onClick={() => setDeactModal(st)}>Deactivate</button>
                        <button className="td-action-btn td-action-danger" onClick={() => setRemoveModal(st)}>Remove</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="td-action-btn" onClick={() => doReactivate(st)}>Reactivate</button>
                        <button className="td-action-btn td-action-danger" onClick={() => setRemoveModal(st)}>Remove</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--gray-400)' }}>No students found.</td></tr>}
          </tbody>
        </table>
      </div>

      {moveModal && (
        <div className="td-modal-overlay" onClick={() => setMoveModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Move {moveModal.name}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>Transfer to another section:</p>
            <select className="input" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
              <option value="">Select section...</option>
              {sections.filter(s => s.id !== currentSectionId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setMoveModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doMove} disabled={!moveTarget || processing}>{processing ? 'Moving...' : 'Move Student'}</button>
            </div>
          </div>
        </div>
      )}

      {deactModal && (
        <div className="td-modal-overlay" onClick={() => setDeactModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Deactivate {deactModal.name}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>Student data will be preserved. Select a reason:</p>
            <select className="input" value={deactReason} onChange={e => setDeactReason(e.target.value)}>
              {['Medical leave', 'Extended absence', 'Suspension', 'Schedule conflict', 'Other'].map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeactModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doDeactivate} disabled={processing}>{processing ? 'Saving...' : 'Deactivate'}</button>
            </div>
          </div>
        </div>
      )}

      {removeModal && (
        <div className="td-modal-overlay" onClick={() => setRemoveModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#dc2626' }}>Remove {removeModal.name}?</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>This will permanently delete the student's enrollment, character, and all simulation data. This cannot be undone.</p>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setRemoveModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#dc2626' }} onClick={doRemove} disabled={processing}>{processing ? 'Removing...' : 'Permanently Remove'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Gradebook ──────────────────────────────────────────

function GradebookPage({ students, sectionId, onReload }) {
  const [weights, setWeights] = useState({ sim: 40, participation: 30, reflection: 20, presentation: 10 })
  const [manualGrades, setManualGrades] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(`finsim_weights_${sectionId}`)
    if (stored) setWeights(JSON.parse(stored))
  }, [sectionId])

  const weightTotal = weights.sim + weights.participation + weights.reflection + weights.presentation

  function updateManual(studentId, field, value) {
    setManualGrades(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], [field]: Number(value) || 0 },
    }))
  }

  function calcOverall(st) {
    const manual = manualGrades[st.id] || {}
    const reflection = manual.reflection ?? 0
    const presentation = manual.presentation ?? 0
    return Math.round(
      (st.simScore * weights.sim + st.participationScore * weights.participation +
        reflection * weights.reflection + presentation * weights.presentation) / 100
    )
  }

  function saveWeights() {
    localStorage.setItem(`finsim_weights_${sectionId}`, JSON.stringify(weights))
    setSaving(true)
    setTimeout(() => setSaving(false), 1000)
  }

  function exportCSV() {
    const header = 'Student,Sim Score,Participation,Reflection,Presentation,Overall'
    const rows = students.map(st => {
      const m = manualGrades[st.id] || {}
      return `"${st.name}",${st.simScore},${st.participationScore},${m.reflection || 0},${m.presentation || 0},${calcOverall(st)}`
    })
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gradebook.csv'
    a.click()
  }

  return (
    <div>
      <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginBottom: '1rem' }} onClick={exportCSV}>Export CSV</button>

      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Sim ({weights.sim}%)</th><th>Participation ({weights.participation}%)</th><th>Reflection ({weights.reflection}%)</th><th>Presentation ({weights.presentation}%)</th><th>Overall</th></tr></thead>
          <tbody>
            {students.filter(s => s.enrollStatus === 'approved').map(st => {
              const m = manualGrades[st.id] || {}
              const ov = calcOverall(st)
              return (
                <tr key={st.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                  <td style={{ color: gradeColor(st.simScore) }}>{st.simScore}</td>
                  <td style={{ color: gradeColor(st.participationScore) }}>{st.participationScore}</td>
                  <td><input className="td-grade-input" type="number" min="0" max="100" value={m.reflection ?? ''} onChange={e => updateManual(st.id, 'reflection', e.target.value)} placeholder="—" /></td>
                  <td><input className="td-grade-input" type="number" min="0" max="100" value={m.presentation ?? ''} onChange={e => updateManual(st.id, 'presentation', e.target.value)} placeholder="—" /></td>
                  <td style={{ fontWeight: 700, color: gradeColor(ov) }}>{letterGrade(ov)} ({ov})</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="td-weights-panel">
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>Grade Weights</h3>
        <div className="td-weights-grid">
          {[
            ['sim', 'Sim Performance'], ['participation', 'Weekly Participation'],
            ['reflection', 'Written Reflections'], ['presentation', 'Presentations'],
          ].map(([key, label]) => (
            <div key={key} className="td-weight-item">
              <label>{label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input className="td-grade-input" type="number" min="0" max="100" value={weights[key]} onChange={e => setWeights(w => ({ ...w, [key]: Number(e.target.value) || 0 }))} />
                <span style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>%</span>
              </div>
            </div>
          ))}
        </div>
        {weightTotal !== 100 && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>Weights must total 100% (currently {weightTotal}%)</p>}
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.5rem' }} onClick={saveWeights} disabled={weightTotal !== 100}>
          {saving ? 'Saved!' : 'Save Weights'}
        </button>
      </div>
    </div>
  )
}

// ─── Sim Controls ───────────────────────────────────────

const FEATURES = [
  { id: 'banking', label: 'Banking & Cash Flow' },
  { id: 'budget_tracker', label: 'Budget Tracker' },
  { id: 'tax_sim', label: 'Tax Simulator' },
  { id: 'credit_tracker', label: 'Credit Score Tracker' },
  { id: 'debt_manager', label: 'Debt Manager' },
  { id: 'investing', label: 'Investment Portfolio' },
  { id: 'insurance', label: 'Insurance Module' },
]

function SimControlsPage({ sections, allEvents, recentTriggers, onUpdateWeek, onReloadTriggers }) {
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [triggerWeek, setTriggerWeek] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)
  const [featureState, setFeatureState] = useState({})

  useEffect(() => {
    const state = {}
    sections.forEach(s => {
      state[s.id] = s.unlocked_categories || []
    })
    setFeatureState(state)
  }, [sections])

  async function handlePushEvent() {
    if (!selectedEvent || !selectedSection || !triggerWeek) return
    setPushing(true)
    setPushMsg(null)
    try {
      const ids = selectedSection === 'all' ? sections.map(s => s.id) : [selectedSection]
      for (const id of ids) await triggerTeacherLifeEvent(id, selectedEvent, Number(triggerWeek))
      const name = allEvents.find(e => e.id === selectedEvent)?.title || 'Event'
      setPushMsg(`"${name}" pushed to ${ids.length} section${ids.length > 1 ? 's' : ''} for week ${triggerWeek}`)
      onReloadTriggers()
      setSelectedEvent('')
      setTriggerWeek('')
    } catch (err) { setPushMsg('Error: ' + err.message) }
    finally { setPushing(false) }
  }

  async function toggleFeature(sectionId, featureId) {
    const current = featureState[sectionId] || []
    const next = current.includes(featureId) ? current.filter(f => f !== featureId) : [...current, featureId]
    setFeatureState(prev => ({ ...prev, [sectionId]: next }))
    await supabase.from('sections').update({ unlocked_categories: next }).eq('id', sectionId)
  }

  return (
    <div>
      {sections.map(sec => (
        <div key={sec.id} className="td-card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{sec.name}</h3>

          <div className="week-control" style={{ marginBottom: '1rem' }}>
            <div className="week-control-label">
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Week Unlock</span>
              <span className="dash-week-badge" style={{ fontSize: '0.85rem' }}>Week {sec.unlocked_week} of 36</span>
            </div>
            <div className="week-control-bar"><div className="week-control-fill" style={{ width: `${(sec.unlocked_week / 36) * 100}%` }} /></div>
            <div className="week-control-actions">
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, sec.unlocked_week - 1)} disabled={sec.unlocked_week <= 0}>- 1 Week</button>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, sec.unlocked_week + 1)} disabled={sec.unlocked_week >= 36}>+ 1 Week</button>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, 36)} disabled={sec.unlocked_week >= 36}>Unlock All</button>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Feature Unlocks</p>
          <div className="td-feature-grid">
            {FEATURES.map(f => {
              const on = (featureState[sec.id] || []).includes(f.id)
              return (
                <div key={f.id} className="td-feature-row">
                  <span style={{ fontSize: '0.85rem' }}>{f.label}</span>
                  <button className={`td-toggle ${on ? 'on' : ''}`} onClick={() => toggleFeature(sec.id, f.id)} type="button">
                    <div className="td-toggle-thumb" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="td-card">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>⚡ Trigger Life Event</h3>
        <div className="event-trigger-form">
          <div className="event-trigger-row">
            <label className="event-trigger-label">Event</label>
            <select className="input" value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>
              <option value="">Select...</option>
              {allEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.is_positive ? '🟢' : '🔴'} {ev.title}</option>)}
            </select>
          </div>
          <div className="event-trigger-row">
            <label className="event-trigger-label">Section</label>
            <select className="input" value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
              <option value="">Select...</option><option value="all">All sections</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="event-trigger-row">
            <label className="event-trigger-label">Week</label>
            <input className="input" type="number" min="1" max="36" placeholder="#" value={triggerWeek} onChange={e => setTriggerWeek(e.target.value)} style={{ maxWidth: 100 }} />
          </div>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.5rem 1.25rem', alignSelf: 'flex-start' }} onClick={handlePushEvent} disabled={pushing || !selectedEvent || !selectedSection || !triggerWeek}>{pushing ? 'Pushing...' : 'Push to Students'}</button>
        </div>
        {pushMsg && <div className={pushMsg.startsWith('Error') ? 'error-msg' : 'success-msg'} style={{ marginTop: '0.75rem' }}>{pushMsg}</div>}
        {recentTriggers.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Recent</p>
            {recentTriggers.map(t => {
              const secName = sections.find(s => s.id === t.section_id)?.name || ''
              return <div key={t.id} style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.2rem' }}><strong>{t.life_events?.title}</strong> → {secName} (W{t.week})</div>
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Class Display ──────────────────────────────────────

function ClassDisplayPage({ students, onReload }) {
  const [shareModal, setShareModal] = useState(null)

  async function toggleShare(st, anonymous) {
    await supabase.from('enrollments').update({ dashboard_shared: true }).eq('id', st.enrollmentId)
    setShareModal(null)
    onReload()
  }

  async function stopSharing(st) {
    await supabase.from('enrollments').update({ dashboard_shared: false }).eq('id', st.enrollmentId)
    onReload()
  }

  return (
    <div>
      <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', marginBottom: '1rem' }}>Share individual student dashboards for class discussion or presentation.</p>
      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {students.filter(s => s.enrollStatus === 'approved').map(st => (
              <tr key={st.id}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                <td>{st.dashboardShared ? <span className="td-status-badge" style={{ color: '#16a34a', background: '#f0fdf4' }}>Sharing</span> : <span style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>Not sharing</span>}</td>
                <td>
                  {st.dashboardShared ? (
                    <button className="td-action-btn" onClick={() => stopSharing(st)}>Stop Sharing</button>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="td-action-btn" onClick={() => setShareModal({ student: st, type: 'named' })}>Named</button>
                      <button className="td-action-btn" onClick={() => setShareModal({ student: st, type: 'anon' })}>Anonymous</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shareModal && (
        <div className="td-modal-overlay" onClick={() => setShareModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Share Dashboard — {shareModal.type === 'named' ? 'Named' : 'Anonymous'}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.75rem 0' }}>
              {shareModal.type === 'named'
                ? `"${shareModal.student.name}"'s dashboard will be visible with their name and avatar.`
                : `"${shareModal.student.name}"'s dashboard will be shown anonymously as "Student".`}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>Visible data: net worth, credit score, budget breakdown, and financial grades.</p>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShareModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => toggleShare(shareModal.student, shareModal.type === 'anon')}>Start Sharing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reports ────────────────────────────────────────────

function ReportsPage({ students, sectionName }) {
  function exportProgressCSV() {
    const header = 'Student,Week,Net Worth,Credit Score,Cash,Debt,Status'
    const rows = students.map(st => {
      const b = statusBadge(st)
      return `"${st.name}",${st.currentWeek},${st.netWorth},${st.creditScore},${st.cash},${st.debt},"${b.label}"`
    })
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${sectionName || 'class'}_progress.csv`
    a.click()
  }

  const reports = [
    { title: 'Class Progress Report', desc: 'Student standings, weeks completed, and net worth.', action: 'Export CSV', onClick: exportProgressCSV },
    { title: 'Gradebook Export', desc: 'Export all grades for your LMS.', action: 'Export CSV', onClick: exportProgressCSV },
    { title: 'Net Worth Over Time', desc: 'Chart comparing all students\' net worth trajectories.', action: 'View Chart', onClick: () => {} },
    { title: 'At-Risk Students', desc: 'Students with declining finances or inactivity.', action: 'View List', onClick: () => {} },
    { title: 'Path Comparison', desc: 'Compare outcomes by life path choice.', action: 'View Report', onClick: () => {} },
    { title: 'Decision History Log', desc: 'All student decisions across all weeks.', action: 'View Log', onClick: () => {} },
  ]

  return (
    <div className="td-report-grid">
      {reports.map(r => (
        <div key={r.title} className="td-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem' }}>{r.title}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>{r.desc}</p>
          </div>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.75rem', alignSelf: 'flex-start' }} onClick={r.onClick}>{r.action}</button>
        </div>
      ))}
    </div>
  )
}

// ─── Student View (Demo) ────────────────────────────────

const DEMO_PATHS = [
  { id: 'retail-food', name: 'Retail / Food Service', emoji: '🛒', income: 2000, debt: 0 },
  { id: 'trades', name: 'Trades Apprentice', emoji: '🔧', income: 2650, debt: 0 },
  { id: 'office-admin', name: 'Office / Admin', emoji: '💼', income: 2400, debt: 0 },
  { id: 'military', name: 'Military Enlistment', emoji: '🪖', income: 2300, debt: 0 },
  { id: 'gig-freelance', name: 'Gig / Freelance', emoji: '📱', income: 2100, debt: 0 },
  { id: 'healthcare', name: 'Healthcare Support', emoji: '🏥', income: 2500, debt: 0 },
  { id: 'cc-parttime', name: 'CC + Part-Time', emoji: '📚', income: 1200, debt: 4500 },
  { id: 'cc-fulltime', name: 'CC + Full-Time', emoji: '⚡', income: 2000, debt: 4500 },
  { id: 'uni-oncampus', name: 'University On Campus', emoji: '🎓', income: 1000, debt: 11000 },
  { id: 'uni-offcampus', name: 'University Off Campus', emoji: '🏠', income: 1000, debt: 11000 },
]
const DEMO_WEEKS = [1, 7, 14, 22, 30, 36]

function DemoPage() {
  const [selectedPath, setSelectedPath] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(14)
  const [active, setActive] = useState(false)

  if (active && selectedPath) {
    const weeks = selectedWeek
    const income = selectedPath.income
    const debt = Math.max(0, selectedPath.debt - (weeks * 50))
    const savings = weeks * Math.round(income * 0.1)
    const cash = income - Math.round(income * 0.7) + savings
    const nw = cash + savings - debt
    const credit = Math.min(850, 650 + weeks * 3)

    return (
      <div>
        <div className="td-demo-banner">
          <span>👁️ Demo Mode — {selectedPath.name}, Week {selectedWeek}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setActive(false)}>Switch Path</button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem', background: '#7c3aed', color: 'white' }} onClick={() => { setActive(false); setSelectedPath(null) }}>Exit Demo</button>
          </div>
        </div>
        <div className="td-stats" style={{ marginTop: '1rem' }}>
          <div className="stat-card"><p className="stat-label">Net Worth</p><p className="stat-value">{money(nw)}</p></div>
          <div className="stat-card"><p className="stat-label">Monthly Income</p><p className="stat-value">{money(income)}</p></div>
          <div className="stat-card"><p className="stat-label">Savings</p><p className="stat-value">{money(savings)}</p></div>
          <div className="stat-card"><p className="stat-label">Debt</p><p className="stat-value" style={{ color: debt > 0 ? '#dc2626' : 'inherit' }}>{debt > 0 ? money(debt) : 'None'}</p></div>
          <div className="stat-card"><p className="stat-label">Credit Score</p><p className="stat-value">{credit}</p></div>
          <div className="stat-card"><p className="stat-label">Cash on Hand</p><p className="stat-value">{money(cash)}</p></div>
        </div>
        <p style={{ color: 'var(--gray-400)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>This is a simulated preview. No data is saved.</p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', marginBottom: '1rem' }}>Preview the student experience. Select a life path and week to see a simulated dashboard.</p>

      <div className="td-demo-paths">
        {DEMO_PATHS.map(p => (
          <button key={p.id} className={`option-card ${selectedPath?.id === p.id ? 'selected' : ''}`} onClick={() => setSelectedPath(p)} type="button">
            <div style={{ fontWeight: 600 }}>{p.emoji} {p.name}</div>
            <div className="option-meta">{money(p.income)}/mo · {p.debt > 0 ? money(p.debt) + ' debt' : 'No debt'}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem', marginBottom: '1rem' }}>
        {DEMO_WEEKS.map(w => (
          <button key={w} className={`td-action-btn ${selectedWeek === w ? 'td-action-active' : ''}`} onClick={() => setSelectedWeek(w)} style={{ padding: '0.4rem 0.75rem' }}>Week {w}</button>
        ))}
      </div>

      <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.5rem' }} onClick={() => setActive(true)} disabled={!selectedPath}>Launch Demo</button>
    </div>
  )
}

// ─── Main Teacher Dashboard ─────────────────────────────

export default function TeacherDashboard() {
  const { session, profile, loading: authLoading, signOut } = useAuth()
  const [page, setPage] = useState('overview')
  const [sections, setSections] = useState([])
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [students, setStudents] = useState([])
  const [allEvents, setAllEvents] = useState([])
  const [recentTriggers, setRecentTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeSection = sections.find(s => s.id === activeSectionId)

  const loadSections = useCallback(async () => {
    const { data, error: sErr } = await supabase
      .from('sections')
      .select('id, name, class_code, unlocked_week, unlocked_categories, is_active, created_at')
      .order('created_at', { ascending: false })
    if (sErr) throw new Error(sErr.message)

    const withCounts = await Promise.all(
      (data || []).map(async (sec) => {
        const { count } = await supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', sec.id)
          .in('status', ['approved', 'denied'])
        return { ...sec, studentCount: count || 0 }
      })
    )
    setSections(withCounts)
    if (!activeSectionId && withCounts.length > 0) setActiveSectionId(withCounts[0].id)
    return withCounts
  }, [activeSectionId])

  const loadStudents = useCallback(async (sectionId) => {
    if (!sectionId) return
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('id, student_id, status, deactivation_reason, dashboard_shared, updated_at')
      .eq('section_id', sectionId)
      .in('status', ['approved', 'denied'])

    if (!enrollments || enrollments.length === 0) { setStudents([]); return }

    const charResults = await Promise.all(
      enrollments.map(async (e) => {
        const { data: char } = await supabase
          .from('characters')
          .select('id, name, emoji, background_color, life_path_id, current_week')
          .eq('enrollment_id', e.id)
          .single()
        if (!char) return null

        const { data: latest } = await supabase
          .from('financial_states')
          .select('net_worth, cash, savings, debt, credit_score, monthly_income, monthly_expenses')
          .eq('character_id', char.id)
          .order('week', { ascending: false })
          .limit(1)
          .single()

        const { data: allStates } = await supabase
          .from('financial_states')
          .select('net_worth, week')
          .eq('character_id', char.id)
          .order('week', { ascending: false })
          .limit(4)

        const { count: decisionCount } = await supabase
          .from('student_decisions')
          .select('id', { count: 'exact', head: true })
          .eq('character_id', char.id)

        const { data: lastDecision } = await supabase
          .from('student_decisions')
          .select('created_at')
          .eq('character_id', char.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const income = Number(latest?.monthly_income) || 1
        const expenses = Number(latest?.monthly_expenses) || 0
        const savings = Number(latest?.savings) || 0
        const debt = Number(latest?.debt) || 0
        const savingsRate = ((income - expenses) / income) * 100
        const budgetGrade = Math.min(100, Math.max(0, 50 + savingsRate * 2.5))
        const debtGrade = debt === 0 ? 95 : Math.max(0, 100 - (debt / income) * 8)
        const savingsGrade = Math.min(100, (savings / income) * 25)
        const participationScore = char.current_week > 0 ? Math.min(100, Math.round(((decisionCount || 0) / char.current_week) * 100)) : 100
        const nwValues = (allStates || []).map(s => Number(s.net_worth))
        const netWorthDecline = nwValues.length >= 3 && nwValues[0] < nwValues[1] && nwValues[1] < nwValues[2]
        const simScore = Math.min(100, Math.round((budgetGrade * 0.4 + debtGrade * 0.3 + savingsGrade * 0.3)))

        return {
          id: char.id,
          enrollmentId: e.id,
          enrollStatus: e.status,
          deactivationReason: e.deactivation_reason,
          dashboardShared: e.dashboard_shared,
          name: char.name,
          emoji: char.emoji,
          bgColor: char.background_color,
          lifePathId: char.life_path_id,
          currentWeek: char.current_week,
          netWorth: Number(latest?.net_worth) || 0,
          cash: Number(latest?.cash) || 0,
          debt,
          creditScore: latest?.credit_score || 650,
          budgetGrade: Math.round(budgetGrade),
          debtGrade: Math.round(debtGrade),
          savingsGrade: Math.round(savingsGrade),
          overallGrade: Math.round((budgetGrade + debtGrade + savingsGrade) / 3),
          simScore,
          participationScore,
          lastActive: lastDecision?.created_at || e.updated_at,
          madeDecisionThisWeek: (decisionCount || 0) >= char.current_week,
          netWorthDecline,
          weeksBehind: Math.max(0, (activeSection?.unlocked_week || 0) - char.current_week - 1),
        }
      })
    )
    setStudents(charResults.filter(Boolean))
  }, [activeSection])

  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from('life_events').select('id, title, is_positive, category').order('title')
    setAllEvents(data || [])
  }, [])

  const loadTriggers = useCallback(async () => {
    const sectionIds = sections.map(s => s.id)
    if (sectionIds.length === 0) return
    const { data } = await supabase
      .from('section_life_events')
      .select('id, section_id, life_event_id, week, triggered_at, life_events(title)')
      .in('section_id', sectionIds)
      .order('triggered_at', { ascending: false })
      .limit(10)
    setRecentTriggers(data || [])
  }, [sections])

  useEffect(() => {
    if (!session) return
    async function init() {
      try {
        const secs = await loadSections()
        await loadEvents()
        if (secs.length > 0) await loadStudents(secs[0].id)
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }
    init()
  }, [session])

  useEffect(() => {
    if (activeSectionId) loadStudents(activeSectionId)
  }, [activeSectionId, loadStudents])

  useEffect(() => {
    if (sections.length > 0) loadTriggers()
  }, [sections, loadTriggers])

  async function handleUpdateWeek(sectionId, newWeek) {
    const clamped = Math.max(0, Math.min(36, newWeek))
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, unlocked_week: clamped } : s))
    await supabase.from('sections').update({ unlocked_week: clamped }).eq('id', sectionId)
  }

  async function reload() {
    await loadSections()
    if (activeSectionId) await loadStudents(activeSectionId)
  }

  if (authLoading || loading) return <div className="page-center"><p style={{ color: 'var(--gray-400)' }}>Loading...</p></div>
  if (!session) return <Navigate to="/" />
  if (profile?.role !== 'teacher') return <Navigate to="/dashboard" />

  const pageTitle = NAV.find(n => n.id === page)?.label || ''

  return (
    <div className="td-layout">
      {/* Mobile hamburger */}
      <button className="td-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} type="button">☰</button>

      {/* Sidebar */}
      <aside className={`td-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="td-sidebar-top">
          <div className="td-logo">💰 FinSim</div>
          <div className="td-logo-sub">Teacher Portal</div>
        </div>

        <nav className="td-nav">
          {NAV.map(n => (
            <button key={n.id} className={`td-nav-item ${page === n.id ? 'active' : ''}`} onClick={() => { setPage(n.id); setSidebarOpen(false) }} type="button">
              <span className="td-nav-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>

        <div className="td-sidebar-sections">
          <p className="td-sidebar-label">Sections</p>
          {sections.map(s => (
            <button key={s.id} className={`td-section-pill ${activeSectionId === s.id ? 'active' : ''}`} onClick={() => setActiveSectionId(s.id)} type="button">
              <span>{s.name}</span>
              <span className="td-section-count">{s.studentCount}</span>
            </button>
          ))}
        </div>

        <div className="td-sidebar-footer">
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{profile?.display_name || 'Teacher'}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
          <button className="td-signout-link" onClick={signOut} type="button">Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <main className="td-main">
        <header className="td-topbar">
          <div>
            <h1 className="td-page-title">{pageTitle}</h1>
            {activeSection && <p className="td-page-sub">{activeSection.name} · {activeSection.class_code}</p>}
          </div>
        </header>

        {error && <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div className="td-content">
          {page === 'overview' && <OverviewPage students={students} onSelectStudent={() => {}} />}
          {page === 'roster' && <RosterPage students={students} sections={sections} currentSectionId={activeSectionId} onReload={reload} />}
          {page === 'gradebook' && <GradebookPage students={students} sectionId={activeSectionId} onReload={reload} />}
          {page === 'sim' && <SimControlsPage sections={sections} allEvents={allEvents} recentTriggers={recentTriggers} onUpdateWeek={handleUpdateWeek} onReloadTriggers={loadTriggers} />}
          {page === 'display' && <ClassDisplayPage students={students} onReload={reload} />}
          {page === 'reports' && <ReportsPage students={students} sectionName={activeSection?.name} />}
          {page === 'demo' && <DemoPage />}
        </div>
      </main>
    </div>
  )
}
